#!/usr/bin/env python3
"""Update TeamSpeak 6 Client (aarch64-darwin) from the official downloads page."""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parents[2]
DOWNLOADS_URL = "https://www.teamspeak.com/en/downloads/"
DMG_URL_RE = re.compile(
    r"https://files\.teamspeak-services\.com/pre_releases/client/"
    r"([^/\"']+)/teamspeak-client-arm\.dmg"
)
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
)
# Match package.nix curlOptsList so CI can re-fetch past Cloudflare.
CURL_OPTS = [
    "--http1.1",
    "-L",
    "-A",
    USER_AGENT,
    "-e",
    DOWNLOADS_URL,
]


def run(command: list[str], *, capture: bool = False) -> str:
    result = subprocess.run(command, check=True, text=True, capture_output=capture)
    return result.stdout if capture else ""


def latest_release() -> tuple[str, str]:
    request = urllib.request.Request(
        DOWNLOADS_URL,
        headers={"User-Agent": USER_AGENT},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        page = response.read().decode("utf-8", errors="replace")

    match = DMG_URL_RE.search(page)
    if match is None:
        raise RuntimeError("Could not find teamspeak-client-arm.dmg on the downloads page")
    version = match.group(1)
    return version, match.group(0)


def prefetch_sri_hash(url: str) -> str:
    with tempfile.NamedTemporaryFile(prefix="teamspeak6-client-", suffix=".dmg", delete=False) as tmp:
        path = tmp.name
    try:
        run(["curl", *CURL_OPTS, "-o", path, url])
        return run(
            ["nix", "hash", "file", "--type", "sha256", "--sri", path],
            capture=True,
        ).strip()
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def replace_once(text: str, pattern: str, replacement: str, error: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.MULTILINE)
    if count != 1:
        raise RuntimeError(error)
    return updated


def current_version(package_text: str) -> str:
    match = re.search(r'^  version = "([^"]+)";', package_text, flags=re.MULTILINE)
    if match is None:
        raise RuntimeError("Failed to read current teamspeak6-client version")
    return match.group(1)


def update_package(version: str, url: str) -> None:
    package_path = ROOT / "packages/teamspeak6-client/package.nix"
    text = package_path.read_text()
    if current_version(text) == version:
        print(f"teamspeak6-client is already at {version}")
        return

    text = replace_once(
        text,
        r'^  version = "[^"]+";',
        f'  version = "{version}";',
        "Failed to update teamspeak6-client version",
    )
    text = replace_once(
        text,
        r'(hash = ")[^"]+(";)',
        rf"\g<1>{prefetch_sri_hash(url)}\2",
        "Failed to update teamspeak6-client hash",
    )
    package_path.write_text(text)


def main() -> None:
    argparse.ArgumentParser(description=__doc__).parse_args()
    version, url = latest_release()
    update_package(version, url)


if __name__ == "__main__":
    try:
        main()
    except (
        OSError,
        RuntimeError,
        subprocess.CalledProcessError,
        urllib.error.URLError,
    ) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1) from error

#!/usr/bin/env python3
"""Update UU Remote (aarch64-darwin) from NetEase's release redirect."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parents[2]
LIVECHECK_URL = "https://api.nrd.nie.163.com/api/v1/release/dl/4?channel=gwqd"
PKG_URL_RE = re.compile(r"uuyc[._-]v?(\d+(?:\.\d+)+)\.pkg", re.IGNORECASE)
USER_AGENT = "9bingyin-nur-packages-updater"


def run(command: list[str], *, capture: bool = False) -> str:
    result = subprocess.run(command, check=True, text=True, capture_output=capture)
    return result.stdout if capture else ""


def latest_release() -> tuple[str, str]:
    # Match Homebrew livecheck: only inspect the redirect Location header.
    headers = run(
        [
            "curl",
            "-sI",
            "-A",
            USER_AGENT,
            LIVECHECK_URL,
        ],
        capture=True,
    )
    location = ""
    for line in headers.splitlines():
        if line.lower().startswith("location:"):
            location = line.split(":", 1)[1].strip()
            break
    if not location:
        raise RuntimeError("UU Remote livecheck returned no Location header")

    match = PKG_URL_RE.search(location)
    if match is None:
        raise RuntimeError(f"Could not parse UU Remote version from {location!r}")
    version = match.group(1)
    # Drop signed query parameters; the CDN accepts the plain artifact URL.
    pkg_url = f"https://a56.gdl.netease.com/uuyc_{version}.pkg"
    return version, pkg_url


def prefetch_sri_hash(url: str) -> str:
    payload: object = json.loads(
        run(["nix", "store", "prefetch-file", "--json", url], capture=True)
    )
    if not isinstance(payload, dict):
        raise RuntimeError(
            f"nix store prefetch-file returned an invalid payload for {url}"
        )
    hash_value = payload.get("hash")
    if not isinstance(hash_value, str):
        raise RuntimeError(f"nix store prefetch-file returned no hash for {url}")
    return hash_value


def replace_once(text: str, pattern: str, replacement: str, error: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.MULTILINE)
    if count != 1:
        raise RuntimeError(error)
    return updated


def current_version(package_text: str) -> str:
    match = re.search(r'^  version = "([^"]+)";', package_text, flags=re.MULTILINE)
    if match is None:
        raise RuntimeError("Failed to read current uuremote version")
    return match.group(1)


def update_package(version: str, url: str) -> None:
    package_path = ROOT / "packages/uuremote/package.nix"
    text = package_path.read_text()
    if current_version(text) == version:
        print(f"uuremote is already at {version}")
        return

    text = replace_once(
        text,
        r'^  version = "[^"]+";',
        f'  version = "{version}";',
        "Failed to update uuremote version",
    )
    text = replace_once(
        text,
        r'(hash = ")[^"]+(";)',
        rf"\g<1>{prefetch_sri_hash(url)}\2",
        "Failed to update uuremote hash",
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

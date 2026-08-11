#!/usr/bin/env python3
"""Update Zed (aarch64-darwin) from the official stable release API."""

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
RELEASE_URL = (
    "https://cloud.zed.dev/releases/stable/latest/asset"
    "?asset=zed&os=macos&arch=aarch64"
)
USER_AGENT = "9bingyin-nur-packages-updater"


def run(command: list[str], *, capture: bool = False) -> str:
    result = subprocess.run(command, check=True, text=True, capture_output=capture)
    return result.stdout if capture else ""


def latest_release() -> tuple[str, str]:
    request = urllib.request.Request(
        RELEASE_URL,
        headers={"User-Agent": USER_AGENT},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        release: object = json.load(response)

    if not isinstance(release, dict):
        raise RuntimeError("Zed release API returned an invalid payload")

    version = release.get("version")
    url = release.get("url")
    if not isinstance(version, str) or not re.fullmatch(
        r"[0-9]+(?:\.[0-9]+)+", version
    ):
        raise RuntimeError("Zed release API returned an invalid version")

    expected_url = (
        "https://github.com/zed-industries/zed/releases/download/"
        f"v{version}/Zed-aarch64.dmg"
    )
    if url != expected_url:
        raise RuntimeError(f"Zed release API returned an unexpected URL: {url!r}")

    return version, expected_url


def prefetch_sri_hash(url: str) -> str:
    payload: object = json.loads(
        run(["nix", "store", "prefetch-file", "--json", url], capture=True)
    )
    if not isinstance(payload, dict):
        raise RuntimeError(f"nix store prefetch-file returned an invalid payload for {url}")

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
        raise RuntimeError("Failed to read the current Zed version")
    return match.group(1)


def update_package(version: str, url: str) -> None:
    package_path = ROOT / "packages/zed-editor-bin/package.nix"
    text = package_path.read_text()
    if current_version(text) == version:
        print(f"zed-editor-bin is already at {version}")
        return

    text = replace_once(
        text,
        r'^  version = "[^"]+";',
        f'  version = "{version}";',
        "Failed to update the Zed version",
    )
    text = replace_once(
        text,
        r'(hash = ")[^"]+(";)',
        rf"\g<1>{prefetch_sri_hash(url)}\2",
        "Failed to update the Zed hash",
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

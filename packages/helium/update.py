#!/usr/bin/env python3
"""Update Helium (aarch64-darwin) from the official GitHub release."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import quote, unquote, urlparse

ROOT = Path(__file__).parents[2]
LATEST_RELEASE_URL = "https://github.com/imputnet/helium-macos/releases/latest"
USER_AGENT = "9bingyin-nur-packages-updater"


def run(command: list[str], *, capture: bool = False) -> str:
    result = subprocess.run(command, check=True, text=True, capture_output=capture)
    return result.stdout if capture else ""


def latest_release() -> tuple[str, str]:
    request = urllib.request.Request(
        LATEST_RELEASE_URL,
        headers={"User-Agent": USER_AGENT},
        method="HEAD",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        final_url = response.geturl()

    path = urlparse(final_url).path
    prefix = "/imputnet/helium-macos/releases/tag/"
    if not path.startswith(prefix):
        raise RuntimeError(f"Unexpected Helium release URL: {final_url}")
    version = unquote(path.removeprefix(prefix)).strip("/")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.+_-]*", version):
        raise RuntimeError(f"Invalid Helium release tag: {version}")

    encoded_version = quote(version, safe=".+_-")
    asset_name = f"helium_{version}_arm64-macos.dmg"
    return (
        version,
        "https://github.com/imputnet/helium-macos/releases/download/"
        f"{encoded_version}/{quote(asset_name)}",
    )


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
        raise RuntimeError("Failed to read current Helium version")
    return match.group(1)


def update_package(version: str, url: str) -> None:
    package_path = ROOT / "packages/helium/package.nix"
    text = package_path.read_text()
    if current_version(text) == version:
        print(f"helium is already at {version}")
        return

    text = replace_once(
        text,
        r'^  version = "[^"]+";',
        f'  version = "{version}";',
        "Failed to update Helium version",
    )
    text = replace_once(
        text,
        r'(hash = ")[^"]+(";)',
        rf"\g<1>{prefetch_sri_hash(url)}\2",
        "Failed to update Helium hash",
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

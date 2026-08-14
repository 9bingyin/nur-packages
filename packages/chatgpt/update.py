#!/usr/bin/env python3
"""Update ChatGPT (aarch64-darwin) from OpenAI's official Sparkle appcast."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from xml.etree import ElementTree

ROOT = Path(__file__).parents[2]
APPCAST_BASE_URL = "https://persistent.oaistatic.com/codex-app-prod"
APPCAST_URL = f"{APPCAST_BASE_URL}/appcast.xml"
SPARKLE_NAMESPACE = "http://www.andymatuschak.org/xml-namespaces/sparkle"
ARCH = "arm64"


def run(command: list[str], *, capture: bool = False) -> str:
    result = subprocess.run(command, check=True, text=True, capture_output=capture)
    return result.stdout if capture else ""


def latest_release() -> tuple[str, str]:
    request = urllib.request.Request(
        APPCAST_URL,
        headers={"User-Agent": "9bingyin-nur-packages-updater"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        root = ElementTree.fromstring(response.read())

    item = root.find("./channel/item")
    if item is None:
        raise RuntimeError("ChatGPT appcast has no release item")
    version = item.findtext(f"{{{SPARKLE_NAMESPACE}}}shortVersionString")
    enclosure = item.find("enclosure")
    url = enclosure.get("url") if enclosure is not None else None
    if not isinstance(version, str) or not re.fullmatch(
        r"[0-9]+(?:\.[0-9]+)+", version
    ):
        raise RuntimeError("ChatGPT appcast has an invalid version")
    expected_url = f"{APPCAST_BASE_URL}/ChatGPT-darwin-{ARCH}-{version}.zip"
    if url != expected_url:
        raise RuntimeError(f"ChatGPT appcast has an unexpected download URL: {url!r}")
    return version, expected_url


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


def update_package(version: str, url: str) -> None:
    package_path = ROOT / "packages/chatgpt/package.nix"
    text = package_path.read_text()
    text = replace_once(
        text,
        r'^  version = "[^"]+";',
        f'  version = "{version}";',
        "Failed to update ChatGPT version",
    )
    text = replace_once(
        text,
        r'(hash = ")[^"]+(";)',
        rf"\g<1>{prefetch_sri_hash(url)}\2",
        "Failed to update ChatGPT hash",
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
        ElementTree.ParseError,
    ) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1) from error

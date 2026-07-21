#!/usr/bin/env python3
"""Update ChatGPT from OpenAI's official Sparkle appcasts."""

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
SPARKLE_NAMESPACE = "http://www.andymatuschak.org/xml-namespaces/sparkle"
APPCASTS = {
    "arm64": f"{APPCAST_BASE_URL}/appcast.xml",
    "x64": f"{APPCAST_BASE_URL}/appcast-x64.xml",
}


def run(command: list[str], *, capture: bool = False) -> str:
    result = subprocess.run(command, check=True, text=True, capture_output=capture)
    return result.stdout if capture else ""


def release_from_appcast(arch: str, appcast_url: str) -> tuple[str, str]:
    request = urllib.request.Request(
        appcast_url,
        headers={"User-Agent": "9bingyin-nur-packages-updater"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        root = ElementTree.fromstring(response.read())

    item = root.find("./channel/item")
    if item is None:
        raise RuntimeError(f"{arch} appcast has no release item")
    version = item.findtext(f"{{{SPARKLE_NAMESPACE}}}shortVersionString")
    enclosure = item.find("enclosure")
    url = enclosure.get("url") if enclosure is not None else None
    if not isinstance(version, str) or not re.fullmatch(r"[0-9]+(?:\.[0-9]+)+", version):
        raise RuntimeError(f"{arch} appcast has an invalid version")
    expected_url = f"{APPCAST_BASE_URL}/ChatGPT-darwin-{arch}-{version}.zip"
    if url != expected_url:
        raise RuntimeError(f"{arch} appcast has an unexpected download URL: {url!r}")
    return version, url


def latest_release() -> tuple[str, dict[str, str]]:
    releases = {
        arch: release_from_appcast(arch, appcast_url)
        for arch, appcast_url in APPCASTS.items()
    }
    versions = {version for version, _url in releases.values()}
    if len(versions) != 1:
        raise RuntimeError(f"Appcasts report different versions: {sorted(versions)}")
    return versions.pop(), {arch: url for arch, (_version, url) in releases.items()}


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


def update_package(version: str, urls: dict[str, str]) -> None:
    package_path = ROOT / "packages/chatgpt/package.nix"
    text = package_path.read_text()
    text = replace_once(
        text,
        r'^  version = "[^"]+";',
        f'  version = "{version}";',
        "Failed to update ChatGPT version",
    )
    for arch, url in urls.items():
        text = replace_once(
            text,
            rf'(arch = "{arch}";\n\s+hash = ")[^"]+(";)',
            rf"\g<1>{prefetch_sri_hash(url)}\2",
            f"Failed to update ChatGPT {arch} hash",
        )
    package_path.write_text(text)


def main() -> None:
    argparse.ArgumentParser(description=__doc__).parse_args()
    version, urls = latest_release()
    update_package(version, urls)


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

#!/usr/bin/env nix
#! nix shell --inputs-from ../../.# nixpkgs#python3 --command python3
"""Update Longbridge after both native release artifacts are available."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from collections.abc import Sequence
from pathlib import Path
from typing import TypeGuard, cast

ROOT = Path(__file__).parents[2]
GITHUB_HEADERS = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "9bingyin-nur-packages-updater",
}

if github_token := os.environ.get("GITHUB_TOKEN"):
    GITHUB_HEADERS["Authorization"] = f"Bearer {github_token}"


def is_string_mapping(value: object) -> TypeGuard[dict[str, object]]:
    return isinstance(value, dict) and all(
        isinstance(key, str) for key in cast(dict[object, object], value)
    )


def is_object_list(value: object) -> TypeGuard[list[object]]:
    return isinstance(value, list)


def run(command: Sequence[str], *, capture: bool = False) -> str:
    result = subprocess.run(command, check=True, text=True, capture_output=capture)
    return result.stdout if capture else ""


def latest_version() -> str:
    request = urllib.request.Request(
        "https://api.github.com/repos/longbridge/longbridge-desktop-website/"
        "contents/docs/release-notes",
        headers=GITHUB_HEADERS,
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload: object = json.load(response)
    if not is_object_list(payload):
        raise RuntimeError("Longbridge release notes API returned an unexpected payload")

    versions: set[str] = set()
    for raw_entry in payload:
        if not is_string_mapping(raw_entry):
            continue
        if raw_entry.get("type") != "file":
            continue
        name = raw_entry.get("name")
        if not isinstance(name, str):
            continue
        if match := re.fullmatch(r"v([0-9]+\.[0-9]+\.[0-9]+)\.md", name):
            versions.add(match.group(1))

    suffixes = ("linux-x86_64.deb", "macos-aarch64.dmg")
    for version in sorted(
        versions,
        key=lambda candidate: tuple(map(int, candidate.split("."))),
        reverse=True,
    ):
        base_url = (
            "https://assets.lbkrs.com/github/release/longbridge-desktop/stable/"
            f"longbridge-v{version}"
        )
        for suffix in suffixes:
            try:
                request = urllib.request.Request(
                    f"{base_url}-{suffix}", headers=GITHUB_HEADERS, method="HEAD"
                )
                with urllib.request.urlopen(request, timeout=30) as response:
                    if response.status != 200:
                        break
            except urllib.error.URLError:
                break
        else:
            return version
    raise RuntimeError("No Longbridge release has both Linux and macOS artifacts")


def prefetch_sri_hash(url: str) -> str:
    payload: object = json.loads(
        run(["nix", "store", "prefetch-file", "--json", url], capture=True)
    )
    if not is_string_mapping(payload):
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


def parse_args() -> None:
    argparse.ArgumentParser(description=__doc__).parse_args()


def main() -> None:
    parse_args()
    version = latest_version()
    base_url = (
        "https://assets.lbkrs.com/github/release/longbridge-desktop/stable/"
        f"longbridge-v{version}"
    )
    package_path = ROOT / "packages/longbridge/package.nix"
    text = package_path.read_text()
    text = replace_once(
        text,
        r'^  version = "[^"]+";',
        f'  version = "{version}";',
        "Failed to update Longbridge version",
    )
    for suffix in ("linux-x86_64.deb", "macos-aarch64.dmg"):
        text = replace_once(
            text,
            rf'(suffix = "{re.escape(suffix)}";\n\s+hash = ")[^"]+(";)',
            rf"\g<1>{prefetch_sri_hash(f'{base_url}-{suffix}')}\2",
            f"Failed to update Longbridge hash for {suffix}",
        )
    package_path.write_text(text)


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1) from error

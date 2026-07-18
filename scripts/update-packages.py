#!/usr/bin/env nix
#! nix shell --inputs-from .# nixpkgs#python3 --command python3
"""Update a package definition in this repository.

Package-specific update logic lives here; packages without special handling are
updated through nix-update. This script only changes files and deliberately
leaves GitHub Actions outputs to the workflow layer.
"""

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

SYSTEM = os.environ.get("NIX_UPDATE_SYSTEM", "x86_64-linux")
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
    """Run a command and optionally return its standard output."""
    result = subprocess.run(
        command,
        check=True,
        text=True,
        capture_output=capture,
    )
    return result.stdout if capture else ""


def nix_update(*args: str) -> None:
    run(["nix", "run", "nixpkgs#nix-update", "--", "--flake", "--system", SYSTEM, *args])


def latest_longbridge_version() -> str:
    """Find the newest Longbridge release with both supported artifacts."""
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
        entry_type = raw_entry.get("type")
        entry_name = raw_entry.get("name")
        if entry_type != "file" or not isinstance(entry_name, str):
            continue
        match = re.fullmatch(r"v([0-9]+\.[0-9]+\.[0-9]+)\.md", entry_name)
        if match:
            versions.add(match.group(1))

    ordered_versions = sorted(
        versions,
        key=lambda version: tuple(map(int, version.split("."))),
        reverse=True,
    )

    suffixes = ("linux-x86_64.deb", "macos-aarch64.dmg")
    for version in ordered_versions:
        base_url = f"https://assets.lbkrs.com/github/release/longbridge-desktop/stable/longbridge-v{version}"
        for suffix in suffixes:
            try:
                request = urllib.request.Request(
                    f"{base_url}-{suffix}",
                    headers=GITHUB_HEADERS,
                    method="HEAD",
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


def update_longbridge_hashes(version: str, linux_hash: str, macos_aarch64_hash: str) -> None:
    path = Path("packages/longbridge/package.nix")
    text = path.read_text()
    text = replace_once(
        text,
        r'^  version = "[^"]+";',
        f'  version = "{version}";',
        "Failed to update Longbridge version",
    )

    for suffix, hash_value in {
        "linux-x86_64.deb": linux_hash,
        "macos-aarch64.dmg": macos_aarch64_hash,
    }.items():
        text = replace_once(
            text,
            rf'(suffix = "{re.escape(suffix)}";\n\s+hash = ")[^"]+(";)',
            rf"\g<1>{hash_value}\2",
            f"Failed to update Longbridge hash for {suffix}",
        )

    path.write_text(text)


def update_longbridge() -> None:
    version = latest_longbridge_version()
    base_url = f"https://assets.lbkrs.com/github/release/longbridge-desktop/stable/longbridge-v{version}"
    print(f"Latest Longbridge version: {version}")
    update_longbridge_hashes(
        version,
        prefetch_sri_hash(f"{base_url}-linux-x86_64.deb"),
        prefetch_sri_hash(f"{base_url}-macos-aarch64.dmg"),
    )


def update_package(name: str) -> None:
    match name:
        case "longbridge":
            update_longbridge()
        case "longbridge-terminal":
            nix_update("--use-github-releases", name)
        case "warp":
            nix_update("--version=branch=master", name)
        case _:
            nix_update(name)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", help="package attribute to update, or 'all'")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.package == "all":
        for package in ("longbridge-terminal", "longbridge", "warp"):
            update_package(package)
        return
    update_package(args.package)


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"error: {error}", file=sys.stderr)
        sys.exit(1)

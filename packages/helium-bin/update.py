#!/usr/bin/env python3
"""Update Helium's Linux and macOS releases independently."""

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

SOURCES = Path(__file__).with_name("sources.json")
USER_AGENT = "9bingyin-nur-packages-updater"
PLATFORMS = {
    "linux": (
        "helium-linux",
        {
            "x86_64-linux": "x86_64_linux.tar.xz",
            "aarch64-linux": "arm64_linux.tar.xz",
        },
    ),
    "darwin": ("helium-macos", {"aarch64-darwin": "arm64-macos.dmg"}),
}


def latest_release(repository: str) -> str:
    request = urllib.request.Request(
        f"https://github.com/imputnet/{repository}/releases/latest",
        headers={"User-Agent": USER_AGENT},
        method="HEAD",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        final_url = response.geturl()

    path = urlparse(final_url).path
    prefix = f"/imputnet/{repository}/releases/tag/"
    if not path.startswith(prefix):
        raise RuntimeError(f"Unexpected Helium release URL: {final_url}")
    version = unquote(path.removeprefix(prefix)).strip("/")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.+_-]*", version):
        raise RuntimeError(f"Invalid Helium release tag: {version}")
    return version


def asset_url(repository: str, version: str, suffix: str) -> str:
    asset = (
        f"helium-{version}-{suffix}"
        if repository == "helium-linux"
        else f"helium_{version}_{suffix}"
    )
    return (
        f"https://github.com/imputnet/{repository}/releases/download/"
        f"{quote(version, safe='.+_-')}/{quote(asset)}"
    )


def prefetch_sri_hash(url: str) -> str:
    result = subprocess.run(
        ["nix", "store", "prefetch-file", "--json", url],
        check=True,
        text=True,
        capture_output=True,
    )
    payload: object = json.loads(result.stdout)
    if not isinstance(payload, dict):
        raise RuntimeError(
            f"nix store prefetch-file returned an invalid payload for {url}"
        )
    hash_value = payload.get("hash")
    if not isinstance(hash_value, str) or not hash_value.startswith("sha256-"):
        raise RuntimeError(f"nix store prefetch-file returned no SRI hash for {url}")
    return hash_value


def update_package() -> list[dict[str, str]]:
    sources = json.loads(SOURCES.read_text())
    changes = []
    for platform, (repository, assets) in PLATFORMS.items():
        version = latest_release(repository)
        old_version = sources[platform]["version"]
        if old_version == version:
            continue
        hashes = {
            system: prefetch_sri_hash(asset_url(repository, version, suffix))
            for system, suffix in assets.items()
        }
        sources[platform] = {"version": version, "hashes": hashes}
        label = "macos" if platform == "darwin" else "linux"
        changes.append(f"{label} {old_version} -> {version}")

    if not changes:
        return []
    SOURCES.write_text(json.dumps(sources, indent=2) + "\n")
    return [{"commitMessage": "helium-bin: " + "; ".join(changes)}]


def main() -> None:
    argparse.ArgumentParser(description=__doc__).parse_args()
    print(json.dumps(update_package()))


if __name__ == "__main__":
    try:
        main()
    except (
        OSError,
        ValueError,
        RuntimeError,
        subprocess.CalledProcessError,
        urllib.error.URLError,
    ) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1) from error

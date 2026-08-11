#!/usr/bin/env python3
"""Update Termius from the official appcast and archive its arm64 macOS ZIP."""

from __future__ import annotations

import argparse
import base64
import binascii
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parents[2]
APPCAST_URL = "https://autoupdate.termius.com/mac-arm64/latest-mac.yml"
SOURCE_URL = "https://autoupdate.termius.com/mac-arm64/Termius.zip"
WAYBACK_SAVE_URL = f"https://web.archive.org/save/{SOURCE_URL}"
USER_AGENT = "9bingyin-nur-packages-updater"


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        return None


def run(command: list[str]) -> str:
    return subprocess.run(
        command,
        check=True,
        text=True,
        capture_output=True,
    ).stdout


def read_url(url: str, *, timeout: int = 30) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8")


def latest_release() -> tuple[str, str]:
    appcast = read_url(APPCAST_URL)
    versions = [
        match.group(1)
        for line in appcast.splitlines()
        if (match := re.fullmatch(r"version:\s*([0-9]+(?:\.[0-9]+)+)", line))
    ]
    if len(versions) != 1:
        raise RuntimeError("Termius appcast has no unique valid version")

    lines = appcast.splitlines()
    digests: list[str] = []
    for index, line in enumerate(lines[:-1]):
        if re.fullmatch(r"\s*-\s+url:\s*Termius\.zip\s*", line) is None:
            continue
        match = re.fullmatch(r"\s+sha512:\s*([A-Za-z0-9+/]+={0,2})\s*", lines[index + 1])
        if match is not None:
            digests.append(match.group(1))

    if len(digests) != 1:
        raise RuntimeError("Termius appcast has no unique ZIP SHA-512 digest")

    try:
        digest = base64.b64decode(digests[0], validate=True)
    except binascii.Error as error:
        raise RuntimeError("Termius appcast has an invalid ZIP SHA-512 digest") from error
    if len(digest) != 64:
        raise RuntimeError("Termius appcast has an invalid ZIP SHA-512 digest")

    return versions[0], f"sha512-{digests[0]}"


def wayback_url(timestamp: str) -> str:
    return f"https://web.archive.org/web/{timestamp}id_/{SOURCE_URL}"


def timestamp_from_url(url: str) -> str:
    match = re.search(r"/web/([0-9]{14})(?:id_|if_)?/", url)
    if match is None:
        raise RuntimeError(f"Wayback Machine returned an unexpected URL: {url!r}")
    return match.group(1)


def save_snapshot() -> str:
    request = urllib.request.Request(
        WAYBACK_SAVE_URL,
        headers={"User-Agent": USER_AGENT},
    )
    opener = urllib.request.build_opener(NoRedirectHandler())
    try:
        opener.open(request, timeout=600)
    except urllib.error.HTTPError as error:
        if error.code not in (301, 302, 303, 307, 308):
            raise
        location = error.headers.get("Location")
    else:
        raise RuntimeError("Wayback Machine did not return a snapshot redirect")

    if not isinstance(location, str):
        raise RuntimeError("Wayback Machine returned no snapshot URL")

    candidate = timestamp_from_url(location)
    request = urllib.request.Request(
        wayback_url(candidate),
        headers={"User-Agent": USER_AGENT},
        method="HEAD",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return timestamp_from_url(response.geturl())


def archive_hash(timestamp: str) -> str:
    payload: object = json.loads(
        run(["nix", "store", "prefetch-file", "--json", wayback_url(timestamp)])
    )
    if not isinstance(payload, dict):
        raise RuntimeError("nix store prefetch-file returned an invalid payload")

    store_path = payload.get("storePath")
    if not isinstance(store_path, str):
        raise RuntimeError("nix store prefetch-file returned no store path")

    return run(
        ["nix", "hash", "file", "--type", "sha512", "--sri", store_path]
    ).strip()


def unique_match(text: str, pattern: str, error: str) -> re.Match[str]:
    matches = list(re.finditer(pattern, text, flags=re.MULTILINE))
    if len(matches) != 1:
        raise RuntimeError(error)
    return matches[0]


def replace_once(text: str, pattern: str, replacement: str, error: str) -> str:
    unique_match(text, pattern, error)
    return re.sub(pattern, replacement, text, count=1, flags=re.MULTILINE)


def current_value(package_text: str, pattern: str, error: str) -> str:
    return unique_match(package_text, pattern, error).group(1)


def update_package(version: str, hash_value: str) -> None:
    package_path = ROOT / "packages/termius/package.nix"
    text = package_path.read_text()
    current_version = current_value(
        text,
        r'^  version = "([^"]+)";',
        "Failed to read the current Termius version",
    )
    current_value(
        text,
        r'^  waybackTimestamp = "([0-9]{14})";',
        "Failed to read the current Termius Wayback timestamp",
    )
    current_hash = current_value(
        text,
        r'^    hash = "([^"]+)";',
        "Failed to read the current Termius hash",
    )
    if current_version == version and current_hash == hash_value:
        print(f"termius is already at {version}")
        return

    timestamp = save_snapshot()
    archived_hash = archive_hash(timestamp)
    if archived_hash != hash_value:
        raise RuntimeError(
            f"Archived Termius hash mismatch: expected {hash_value}, got {archived_hash}"
        )

    text = replace_once(
        text,
        r'^  version = "[^"]+";',
        f'  version = "{version}";',
        "Failed to update the Termius version",
    )
    text = replace_once(
        text,
        r'^  waybackTimestamp = "[0-9]{14}";',
        f'  waybackTimestamp = "{timestamp}";',
        "Failed to update the Termius Wayback timestamp",
    )
    text = replace_once(
        text,
        r'^    hash = "[^"]+";',
        f'    hash = "{hash_value}";',
        "Failed to update the Termius hash",
    )
    package_path.write_text(text)


def main() -> None:
    argparse.ArgumentParser(description=__doc__).parse_args()
    version, hash_value = latest_release()
    update_package(version, hash_value)


if __name__ == "__main__":
    try:
        main()
    except (
        OSError,
        RuntimeError,
        UnicodeError,
        subprocess.CalledProcessError,
        urllib.error.URLError,
    ) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1) from error

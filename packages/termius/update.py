#!/usr/bin/env python3
"""Update Termius from the official appcast and archive its arm64 macOS ZIP."""

from __future__ import annotations

import argparse
import base64
import binascii
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import TypeGuard, cast

ROOT = Path(__file__).parents[2]
APPCAST_URL = "https://autoupdate.termius.com/mac-arm64/latest-mac.yml"
SOURCE_URL = "https://autoupdate.termius.com/mac-arm64/Termius.zip"
SPN2_SAVE_URL = "https://web.archive.org/save"
SPN2_STATUS_URL = "https://web.archive.org/save/status"
CDX_API_URL = "https://web.archive.org/cdx/search/cdx"
USER_AGENT = "9bingyin-nur-packages-updater"
HTTP_RETRY_STATUSES = {429, 503}
MAX_HTTP_RETRIES = 4
CAPTURE_TIMEOUT_SECONDS = 600
REPLAY_POLL_SECONDS = 20


class SkipUpdate(RuntimeError):
    """The Wayback Machine cannot provide the ZIP now; the next run retries."""


def run(command: list[str]) -> str:
    return subprocess.run(
        command,
        check=True,
        text=True,
        capture_output=True,
    ).stdout


def required_environment(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} must be set")
    return value


def archive_headers() -> dict[str, str]:
    access_key = required_environment("INTERNET_ARCHIVE_ACCESS_KEY")
    secret_key = required_environment("INTERNET_ARCHIVE_SECRET_KEY")
    return {
        "Accept": "application/json",
        "Authorization": f"LOW {access_key}:{secret_key}",
        "User-Agent": USER_AGENT,
    }


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
        match = re.fullmatch(
            r"\s+sha512:\s*([A-Za-z0-9+/]+={0,2})\s*", lines[index + 1]
        )
        if match is not None:
            digests.append(match.group(1))

    if len(digests) != 1:
        raise RuntimeError("Termius appcast has no unique ZIP SHA-512 digest")

    try:
        digest = base64.b64decode(digests[0], validate=True)
    except binascii.Error as error:
        raise RuntimeError(
            "Termius appcast has an invalid ZIP SHA-512 digest"
        ) from error
    if len(digest) != 64:
        raise RuntimeError("Termius appcast has an invalid ZIP SHA-512 digest")

    return versions[0], f"sha512-{digests[0]}"


def wayback_url(timestamp: str) -> str:
    return f"https://web.archive.org/web/{timestamp}id_/{SOURCE_URL}"


def is_string_mapping(value: object) -> TypeGuard[dict[str, object]]:
    return isinstance(value, dict) and all(
        isinstance(key, str) for key in cast(dict[object, object], value)
    )


def json_object(raw: bytes) -> dict[str, object]:
    payload: object = json.loads(raw.decode())
    if not is_string_mapping(payload):
        raise RuntimeError("Wayback Machine returned a non-object JSON payload")
    return payload


def retry_after_seconds(error: urllib.error.HTTPError, default: float) -> float:
    raw = error.headers.get("Retry-After")
    if raw is None:
        return default
    try:
        return max(default, float(raw))
    except ValueError:
        return default


def request_json(
    url: str,
    *,
    data: bytes | None = None,
    timeout: int,
) -> dict[str, object]:
    headers = archive_headers()
    if data is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8"
    request = urllib.request.Request(
        url,
        data=data,
        headers=headers,
        method="POST" if data is not None else "GET",
    )
    delay = 5.0
    for attempt in range(MAX_HTTP_RETRIES):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json_object(response.read())
        except urllib.error.HTTPError as error:
            error.read()
            if error.code not in HTTP_RETRY_STATUSES or attempt == MAX_HTTP_RETRIES - 1:
                raise
            time.sleep(retry_after_seconds(error, delay))
            delay = min(delay * 2, 60.0)
    raise RuntimeError(f"Wayback Machine request failed: {url}")


def string_field(payload: dict[str, object], key: str, error: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        raise RuntimeError(error)
    return value


def save_snapshot() -> str:
    capture = request_json(
        SPN2_SAVE_URL,
        data=urllib.parse.urlencode(
            {
                "url": SOURCE_URL,
                "force_get": "1",
                "skip_first_archive": "1",
                "js_behavior_timeout": "0",
            }
        ).encode(),
        timeout=60,
    )
    job_id = capture.get("job_id")
    if not isinstance(job_id, str) or not job_id:
        raise SkipUpdate(
            "the Wayback Machine refused the capture: "
            f"{json.dumps(capture, ensure_ascii=False, sort_keys=True)}"
        )

    deadline = time.monotonic() + CAPTURE_TIMEOUT_SECONDS
    delay = 5.0
    while time.monotonic() < deadline:
        time.sleep(delay)
        status = request_json(f"{SPN2_STATUS_URL}/{job_id}", timeout=60)
        state = status.get("status")
        if state == "success":
            timestamp = string_field(
                status,
                "timestamp",
                "Wayback Machine returned no capture timestamp",
            )
            if re.fullmatch(r"[0-9]{14}", timestamp) is None:
                raise RuntimeError(
                    f"Wayback Machine returned an invalid timestamp: {timestamp!r}"
                )
            wait_for_capture(timestamp)
            return timestamp
        if state == "error":
            message = (
                status.get("message") or status.get("status_ext") or "unknown error"
            )
            raise SkipUpdate(f"the Wayback Machine capture failed: {message}")
        delay = min(delay * 1.5, 20.0)
    raise SkipUpdate("the Wayback Machine capture timed out")


def archive_hash(timestamp: str) -> str:
    payload = json_object(
        run(
            ["nix", "store", "prefetch-file", "--json", wayback_url(timestamp)]
        ).encode()
    )
    store_path = payload.get("storePath")
    if not isinstance(store_path, str):
        raise RuntimeError("nix store prefetch-file returned no store path")

    return run(["nix", "hash", "file", "--type", "sha512", "--sri", store_path]).strip()


def cdx_timestamps(*parameters: tuple[str, str]) -> tuple[str, ...]:
    """Timestamps of the archived captures the Wayback Machine reports."""
    query = urllib.parse.urlencode(
        {"url": SOURCE_URL, "output": "json", "fl": "timestamp", **dict(parameters)}
    )
    request = urllib.request.Request(
        f"{CDX_API_URL}?{query}", headers={"User-Agent": USER_AGENT}
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        payload: object = json.loads(response.read().decode())
    if not isinstance(payload, list):
        raise RuntimeError("Wayback Machine CDX API returned a non-array payload")
    return tuple(
        value
        for row in payload
        if isinstance(row, list)
        for value in row
        if isinstance(value, str) and re.fullmatch(r"[0-9]{14}", value)
    )


def wait_for_capture(timestamp: str) -> None:
    """Wait until the Wayback Machine indexes a new capture.

    A fresh capture is not replayable before it is indexed. The Wayback Machine
    serves the previous capture of the same URL until then, so hashing too early
    compares the previous content against the new digest and rejects it.
    """
    deadline = time.monotonic() + CAPTURE_TIMEOUT_SECONDS
    while True:
        if timestamp in cdx_timestamps(("from", timestamp), ("to", timestamp)):
            return
        if time.monotonic() >= deadline:
            raise SkipUpdate(f"the capture at {timestamp} is not indexed")
        time.sleep(REPLAY_POLL_SECONDS)


def latest_capture() -> str | None:
    """Timestamp of the newest complete capture of the source URL."""
    timestamps = cdx_timestamps(("filter", "statuscode:200"), ("limit", "-1"))
    return max(timestamps, default=None)


def resolve_timestamp(hash_value: str) -> str:
    """A Wayback timestamp whose archived content matches the appcast digest."""
    captured: str | None = None
    try:
        captured = save_snapshot()
    except SkipUpdate as error:
        reason = str(error)
    else:
        if archive_hash(captured) == hash_value:
            return captured
        reason = f"the capture at {captured} does not match the appcast digest"

    existing = latest_capture()
    if (
        existing is not None
        and existing != captured
        and archive_hash(existing) == hash_value
    ):
        return existing
    raise SkipUpdate(f"{reason}; no archived Termius ZIP matches the appcast digest")


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

    try:
        timestamp = resolve_timestamp(hash_value)
    except SkipUpdate as error:
        print(f"::warning::termius: {error}", file=sys.stderr)
        return

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

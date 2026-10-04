#!/usr/bin/env python3
"""Update Termius from the official appcast and archive its arm64 macOS ZIP."""

from __future__ import annotations

import argparse
import base64
import binascii
import hashlib
import http.client
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import TypeGuard, cast

ROOT = Path(__file__).parents[2]
APPCAST_URL = "https://autoupdate.termius.com/mac-arm64/latest-mac.yml"
SOURCE_URL = "https://autoupdate.termius.com/mac-arm64/Termius.zip"
SPN2_SAVE_URL = "https://web.archive.org/save"
SPN2_STATUS_URL = "https://web.archive.org/save/status"
CDX_API_URL = "https://web.archive.org/cdx/search/cdx"
USER_AGENT = "9bingyin-nur-packages-updater"
HTTP_RETRY_STATUSES = {408, 429, 500, 502, 503, 504}
MAX_HTTP_RETRIES = 2
CAPTURE_TIMEOUT_SECONDS = 600
REPLAY_POLL_SECONDS = 20


class SkipUpdate(RuntimeError):
    """The Wayback Machine cannot provide the ZIP now; the next run retries."""


class RateLimited(SkipUpdate):
    """Stop this run rather than moving throttled traffic to another endpoint."""


class ReplayNotReady(SkipUpdate):
    """The exact capture is not replayable yet."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(
        self,
        req: urllib.request.Request,
        fp: object,
        code: int,
        msg: str,
        headers: object,
        newurl: str,
    ) -> None:
        return None


API_OPENER = urllib.request.build_opener(NoRedirect)


def redact(message: str) -> str:
    for name in ("INTERNET_ARCHIVE_ACCESS_KEY", "INTERNET_ARCHIVE_SECRET_KEY"):
        value = os.environ.get(name)
        if value:
            message = message.replace(value, "<REDACTED>")
    return " ".join(message.split())[:500]


def log(message: str) -> None:
    print(f"termius: {redact(message)}", file=sys.stderr)


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
    return f"https://web.archive.org/web/{timestamp}if_/{SOURCE_URL}"


def is_string_mapping(value: object) -> TypeGuard[dict[str, object]]:
    return isinstance(value, dict) and all(
        isinstance(key, str) for key in cast(dict[object, object], value)
    )


def json_object(raw: bytes) -> dict[str, object]:
    try:
        payload: object = json.loads(raw)
    except (ValueError, UnicodeError) as error:
        raise SkipUpdate("Wayback Machine returned a non-JSON response") from error
    if not is_string_mapping(payload):
        raise SkipUpdate("Wayback Machine returned a non-object JSON payload")
    return payload


def retry_after_seconds(error: urllib.error.HTTPError, default: float) -> float:
    raw = error.headers.get("Retry-After")
    if raw is None:
        return default
    try:
        delay = float(raw)
    except ValueError:
        try:
            delay = (
                parsedate_to_datetime(raw).timestamp()
                - datetime.now(timezone.utc).timestamp()
            )
        except (ValueError, TypeError, OverflowError):
            return default
    return max(default, delay) if math.isfinite(delay) else default


def request_bytes(
    url: str,
    *,
    data: bytes | None = None,
    timeout: int = 60,
    authenticated: bool = False,
) -> bytes:
    headers = archive_headers() if authenticated else {"User-Agent": USER_AGENT}
    headers["Accept"] = "application/json"
    if data is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded;charset=UTF-8"
    request = urllib.request.Request(url, data=data, headers=headers)
    opener = API_OPENER.open if authenticated else urllib.request.urlopen
    for attempt in range(MAX_HTTP_RETRIES):
        delay = 5.0
        rate_limited = False
        try:
            with opener(request, timeout=timeout) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            error.close()
            if authenticated and error.code in {401, 403}:
                raise RuntimeError(
                    f"Wayback API credentials rejected (HTTP {error.code})"
                ) from error
            # Only a confirmed refusal is safe to retry for a capture POST.
            retryable = error.code in (
                {429} if data is not None else HTTP_RETRY_STATUSES
            )
            delay = retry_after_seconds(error, delay)
            reason = f"HTTP {error.code} from {url}"
            rate_limited = error.code == 429
        except (OSError, urllib.error.URLError, http.client.HTTPException) as error:
            retryable = data is None
            reason = f"{type(error).__name__} from {url}"
        if not retryable or attempt == MAX_HTTP_RETRIES - 1 or delay > 60:
            if data is not None:
                reason += "; capture not confirmed; checking existing captures instead of resubmitting"
            if rate_limited:
                raise RateLimited(reason)
            raise SkipUpdate(reason)
        log(f"{reason}; retrying read/request after {delay:g}s")
        time.sleep(delay)
    raise SkipUpdate(f"Wayback request failed: {url}")


def request_json(
    url: str,
    *,
    data: bytes | None = None,
    timeout: int,
) -> dict[str, object]:
    return json_object(
        request_bytes(url, data=data, timeout=timeout, authenticated=True)
    )


def capture_error(payload: dict[str, object]) -> str:
    code = payload.get("status_ext") or "unknown"
    message = payload.get("message") or payload.get("exception") or "no details"
    return redact(f"{code}: {message}")


def capture_timestamp(payload: dict[str, object]) -> str:
    timestamp = payload.get("timestamp")
    if not isinstance(timestamp, str) or re.fullmatch(r"[0-9]{14}", timestamp) is None:
        raise SkipUpdate("Wayback Machine returned no valid capture timestamp")
    if payload.get("original_url", SOURCE_URL) != SOURCE_URL:
        raise SkipUpdate("Wayback Machine captured a different source URL")
    return timestamp


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
        timeout=120,
    )
    if capture.get("status") == "error":
        raise SkipUpdate(f"capture refused ({capture_error(capture)})")
    if capture.get("status") == "success":
        return capture_timestamp(capture)
    job_id = capture.get("job_id")
    if (
        not isinstance(job_id, str)
        or re.fullmatch(r"[A-Za-z0-9-]{1,100}", job_id) is None
    ):
        raise SkipUpdate(f"no capture job started ({capture_error(capture)})")
    log(f"submitted capture job {job_id}")

    deadline = time.monotonic() + CAPTURE_TIMEOUT_SECONDS
    delay = 5.0
    last_error = "still pending"
    while time.monotonic() < deadline:
        time.sleep(min(delay, max(0, deadline - time.monotonic())))
        if time.monotonic() >= deadline:
            break
        try:
            status = request_json(f"{SPN2_STATUS_URL}/{job_id}", timeout=60)
        except RateLimited:
            raise
        except SkipUpdate as error:
            last_error = str(error)
            log(f"job {job_id} status unavailable; keeping the same job ({last_error})")
        else:
            if status.get("job_id", job_id) != job_id:
                raise SkipUpdate("Wayback Machine returned a different capture job")
            state = status.get("status")
            if state == "success":
                timestamp = capture_timestamp(status)
                log(f"capture job {job_id} succeeded at {timestamp}")
                return timestamp
            if state == "error":
                raise SkipUpdate(
                    f"capture job {job_id} failed ({capture_error(status)})"
                )
        delay = min(delay * 1.5, 20.0)
    raise SkipUpdate(f"capture job {job_id} timed out ({last_error})")


def archive_hash(timestamp: str) -> str:
    url = wayback_url(timestamp)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    deadline = time.monotonic() + CAPTURE_TIMEOUT_SECONDS
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            if response.geturl() != url:
                raise ReplayNotReady(f"capture {timestamp} redirected to another URL")
            try:
                captured_at = parsedate_to_datetime(
                    response.headers.get("Memento-Datetime", "")
                )
            except (ValueError, TypeError, OverflowError) as error:
                raise ReplayNotReady(
                    f"capture {timestamp} has no valid Memento-Datetime"
                ) from error
            if (
                captured_at.tzinfo is None
                or captured_at.astimezone(timezone.utc).strftime("%Y%m%d%H%M%S")
                != timestamp
            ):
                raise ReplayNotReady(
                    f"capture {timestamp} replayed a different timestamp"
                )
            digest = hashlib.sha512()
            while chunk := response.read(1024 * 1024):
                if time.monotonic() >= deadline:
                    raise ReplayNotReady(f"capture {timestamp} download timed out")
                digest.update(chunk)
            return f"sha512-{base64.b64encode(digest.digest()).decode()}"
    except urllib.error.HTTPError as error:
        error.close()
        message = f"capture {timestamp} unavailable (HTTP {error.code})"
        if error.code == 429:
            raise RateLimited(message) from error
        if error.code in {400, 401, 403, 410}:
            raise SkipUpdate(message) from error
        raise ReplayNotReady(message) from error
    except (OSError, urllib.error.URLError, http.client.HTTPException) as error:
        raise ReplayNotReady(
            f"capture {timestamp} unavailable ({type(error).__name__})"
        ) from error


def cdx_timestamps(*parameters: tuple[str, str]) -> tuple[str, ...]:
    query = urllib.parse.urlencode(
        {"url": SOURCE_URL, "output": "json", "fl": "timestamp", **dict(parameters)}
    )
    try:
        payload: object = json.loads(request_bytes(f"{CDX_API_URL}?{query}"))
    except (ValueError, UnicodeError) as error:
        raise SkipUpdate("Wayback CDX returned a non-JSON response") from error
    if not isinstance(payload, list):
        raise SkipUpdate("Wayback CDX returned a non-array response")
    return tuple(
        row[0]
        for row in payload
        if isinstance(row, list)
        and len(row) == 1
        and isinstance(row[0], str)
        and re.fullmatch(r"[0-9]{14}", row[0])
    )


def wait_for_capture(timestamp: str, hash_value: str) -> None:
    """Verify the exact replay and official digest; CDX visibility can lag."""
    deadline = time.monotonic() + CAPTURE_TIMEOUT_SECONDS
    last_error = ""
    while time.monotonic() < deadline:
        try:
            captured_hash = archive_hash(timestamp)
        except ReplayNotReady as error:
            if str(error) != last_error:
                last_error = str(error)
                log(f"waiting for replay: {last_error}")
        else:
            if captured_hash != hash_value:
                raise SkipUpdate(
                    f"capture {timestamp} does not match the official SHA-512"
                )
            return
        time.sleep(min(REPLAY_POLL_SECONDS, max(0, deadline - time.monotonic())))
    raise SkipUpdate(f"capture {timestamp} is not replayable yet ({last_error})")


def recent_captures() -> tuple[str, ...]:
    timestamps = cdx_timestamps(("filter", "statuscode:(200|-)"), ("limit", "-3"))
    return tuple(sorted(set(timestamps), reverse=True))


def matching_capture(hash_value: str, checked: set[str]) -> str | None:
    try:
        timestamps = recent_captures()
    except RateLimited:
        raise
    except SkipUpdate as error:
        log(f"capture index unavailable ({error}); continuing without CDX")
        return None
    for timestamp in timestamps:
        if timestamp in checked:
            continue
        try:
            captured_hash = archive_hash(timestamp)
        except RateLimited:
            raise
        except SkipUpdate as error:
            log(str(error))
            continue
        checked.add(timestamp)
        if captured_hash == hash_value:
            log(f"reusing verified capture {timestamp}")
            return timestamp
    return None


def resolve_timestamp(hash_value: str) -> str:
    checked: set[str] = set()
    existing = matching_capture(hash_value, checked)
    if existing is not None:
        return existing
    try:
        timestamp = save_snapshot()
        wait_for_capture(timestamp, hash_value)
        return timestamp
    except RateLimited:
        raise
    except SkipUpdate as error:
        reason = str(error)
        log(f"{reason}; checking existing captures again")
    existing = matching_capture(hash_value, checked)
    if existing is not None:
        return existing
    raise SkipUpdate(
        f"{reason}; no verified capture available; deferred to the next update run"
    )


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

    timestamp = resolve_timestamp(hash_value)

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
        urllib.error.URLError,
    ) as error:
        print(f"::error::termius: {redact(str(error))}", file=sys.stderr)
        raise SystemExit(1) from error

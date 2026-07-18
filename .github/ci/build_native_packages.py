#!/usr/bin/env nix
#! nix shell --inputs-from .# nixpkgs#python3 --command python3
"""Build native packages while refreshing the short-lived niks3 OIDC token."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

NIKS3_AUDIENCE = "https://niks3.bingyin.org"


def required_environment(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} must be set")
    return value


def fetch_oidc_token() -> str:
    request_url = urllib.parse.urlparse(required_environment("ACTIONS_ID_TOKEN_REQUEST_URL"))
    query = dict(urllib.parse.parse_qsl(request_url.query))
    query["audience"] = NIKS3_AUDIENCE
    url = urllib.parse.urlunparse(request_url._replace(query=urllib.parse.urlencode(query)))
    request = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {required_environment('ACTIONS_ID_TOKEN_REQUEST_TOKEN')}"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)
    if not isinstance(payload, dict) or not isinstance(payload.get("value"), str):
        raise RuntimeError("GitHub OIDC response did not contain a token")
    return payload["value"]


def write_token(path: Path) -> None:
    temporary = path.with_suffix(".new")
    temporary.write_text(fetch_oidc_token())
    temporary.chmod(0o600)
    temporary.replace(path)


def refresh_token(path: Path, stop: threading.Event) -> None:
    while not stop.wait(180):
        while not stop.is_set():
            try:
                write_token(path)
                break
            except Exception as error:  # noqa: BLE001
                print(f"warning: failed to refresh niks3 OIDC token: {error}")
                stop.wait(15)


def main() -> None:
    system = required_environment("SYSTEM")
    with tempfile.TemporaryDirectory(prefix="niks3-auth-") as directory:
        token_path = Path(directory) / "token"
        write_token(token_path)
        stop = threading.Event()
        thread = threading.Thread(target=refresh_token, args=(token_path, stop), daemon=True)
        thread.start()
        try:
            subprocess.run(
                [
                    "nix",
                    "shell",
                    "nixpkgs#nix-fast-build",
                    "nixpkgs#niks3",
                    "-c",
                    "nix-fast-build",
                    "--flake",
                    f".#packages.{system}",
                    "--select",
                    'packages: builtins.removeAttrs packages [ "default" "formatter" ]',
                    "--systems",
                    system,
                    "--skip-cached",
                    "--eval-workers",
                    "1",
                    "--cachix-cache",
                    "9bingyin",
                    "--niks3-server",
                    required_environment("NIKS3_SERVER"),
                    "--no-nom",
                    "--no-link",
                ],
                check=True,
                env={**os.environ, "NIKS3_AUTH_TOKEN_FILE": str(token_path)},
            )
        finally:
            stop.set()
            thread.join(timeout=1)


if __name__ == "__main__":
    main()

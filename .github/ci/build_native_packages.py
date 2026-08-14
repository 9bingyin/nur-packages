#!/usr/bin/env nix
#! nix shell --inputs-from .# nixpkgs#python3 --command python3
"""Build native packages with nix-fast-build. Upload to niks3 when NIKS3_SERVER is set."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import threading
import urllib.parse
import urllib.request
from pathlib import Path

NIKS3_AUDIENCE = "https://niks3.bingyin.org"
NIX_FAST_BUILD_INPUT = "github:Mic92/nix-fast-build"


def required_environment(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} must be set")
    return value


def fetch_oidc_token() -> str:
    request_url = urllib.parse.urlparse(
        required_environment("ACTIONS_ID_TOKEN_REQUEST_URL")
    )
    query = dict(urllib.parse.parse_qsl(request_url.query))
    query["audience"] = NIKS3_AUDIENCE
    url = urllib.parse.urlunparse(
        request_url._replace(query=urllib.parse.urlencode(query))
    )
    request = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {required_environment('ACTIONS_ID_TOKEN_REQUEST_TOKEN')}"
        },
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


def nix_fast_build_command(system: str, niks3_server: str | None) -> list[str]:
    command = [
        "nix",
        "shell",
        NIX_FAST_BUILD_INPUT,
        "-c",
        "nix-fast-build",
        "--flake",
        f".#packages.{system}",
        "--select",
        'packages: builtins.removeAttrs packages [ "default" ]',
        "--systems",
        system,
        "--skip-cached",
        "--eval-workers",
        "1",
        "--no-nom",
    ]
    if niks3_server:
        command[3:3] = ["nixpkgs#niks3"]
        command.extend(["--niks3-server", niks3_server])
    return command


def run_build(system: str, niks3_server: str | None, token_path: Path | None) -> None:
    env = dict(os.environ)
    if token_path is not None:
        env["NIKS3_AUTH_TOKEN_FILE"] = str(token_path)
    subprocess.run(nix_fast_build_command(system, niks3_server), check=True, env=env)


def main() -> None:
    system = required_environment("SYSTEM")
    niks3_server = os.environ.get("NIKS3_SERVER")
    if not niks3_server:
        run_build(system, None, None)
        return

    with tempfile.TemporaryDirectory(prefix="niks3-auth-") as directory:
        token_path = Path(directory) / "token"
        write_token(token_path)
        stop = threading.Event()
        thread = threading.Thread(
            target=refresh_token, args=(token_path, stop), daemon=True
        )
        thread.start()
        try:
            run_build(system, niks3_server, token_path)
        finally:
            stop.set()
            thread.join(timeout=1)


if __name__ == "__main__":
    main()

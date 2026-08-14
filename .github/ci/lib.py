"""Shared utilities for local and GitHub Actions automation scripts."""

from __future__ import annotations

import os
import subprocess
from collections.abc import Mapping, Sequence
from pathlib import Path

NATIVE_RUNNERS = {
    "x86_64-linux": "ubuntu-latest",
    "aarch64-linux": "ubuntu-24.04-arm",
    "aarch64-darwin": "macos-latest",
}


def run(
    command: Sequence[str],
    *,
    capture: bool = False,
    check: bool = True,
    cwd: Path | None = None,
    env: Mapping[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    """Run a command, optionally capturing its output."""
    return subprocess.run(
        command,
        check=check,
        cwd=cwd,
        env=None if env is None else {**os.environ, **env},
        text=True,
        capture_output=capture,
    )


def write_output(key: str, value: str) -> None:
    """Write a GitHub Actions output, or print it when run locally."""
    output = os.environ.get("GITHUB_OUTPUT")
    if output is None:
        print(f"output: {key}={value}")
        return
    with Path(output).open("a") as file:
        file.write(f"{key}={value}\n")


def nix_eval_raw(attribute: str) -> str | None:
    """Evaluate a Nix attribute and return its raw value on success."""
    result = run(["nix", "eval", "--raw", attribute], capture=True, check=False)
    return result.stdout.strip() if result.returncode == 0 else None

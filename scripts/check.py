#!/usr/bin/env nix
#! nix shell --inputs-from .# nixpkgs#python3 --command python3
"""Run strict repository validation manually."""

from __future__ import annotations

import os
from pathlib import Path

from subprocess import run


def command(arguments: list[str]) -> None:
    run(arguments, check=True)


def main() -> None:
    command(["nix", "run", ".#formatter", "--", "--no-cache", "--fail-on-change"])
    command(["nix", "flake", "check", "--impure", "--show-trace"])

    workflows = sorted(str(path) for path in Path(".github/workflows").glob("*.yml"))
    command(["nix", "run", "nixpkgs#actionlint", "--", *workflows])
    command(
        [
            "nix",
            "shell",
            "--inputs-from",
            ".#",
            "nixpkgs#pyright",
            "--command",
            "pyright",
            ".github/ci",
            "scripts",
        ]
    )
    command(["./.github/ci/check_workflows.py"])
    command(["./.github/ci/check_readme.py"])

    base_ref = os.environ.get("PRE_PUSH_BASE_REF", "origin/main")
    if run(["git", "rev-parse", "--verify", "--quiet", base_ref]).returncode == 0:
        command(["./.github/ci/check_maintainers.py", "--base-ref", base_ref])


if __name__ == "__main__":
    main()

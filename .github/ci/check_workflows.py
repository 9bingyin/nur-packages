#!/usr/bin/env nix
#! nix shell --inputs-from .# nixpkgs#python3 --command python3
"""Lint workflows and enforce the dependency-free Python automation model."""

from __future__ import annotations

from pathlib import Path

from lib import run


def main() -> None:
    workflows = sorted(Path(".github/workflows").glob("*.yml"))
    run(["nix", "run", "nixpkgs#actionlint", "--", *(str(path) for path in workflows)])

    for workflow in workflows:
        content = workflow.read_text()
        if ".github/ci/" in content and "cachix/install-nix-action" not in content:
            raise RuntimeError(f"{workflow} invokes a Nix shebang script without installing Nix")
        if "oven-sh/setup-bun" in content or "bun install" in content:
            raise RuntimeError(f"{workflow} must not install Bun")

    update_workflow = Path(".github/workflows/update-flake.yml").read_text()
    for command in (
        "./.github/ci/prepare_update_branch.py",
        "./.github/ci/update.py",
        "./.github/ci/create_pr.py",
    ):
        if command not in update_workflow:
            raise RuntimeError(f"Update workflow must invoke {command}")


if __name__ == "__main__":
    main()

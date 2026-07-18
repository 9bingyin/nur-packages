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

    update_caller = Path(".github/workflows/update-dependencies.yml").read_text()
    update_workflow = Path(".github/workflows/update-targets.yml").read_text()
    for forbidden in ("NUR_UPDATE_TOKEN", "secrets: inherit"):
        if forbidden in update_caller or forbidden in update_workflow:
            raise RuntimeError(f"Update workflows must not contain {forbidden}")
    for required in (
        "AUTOMATION_APP_PRIVATE_KEY",
        "actions/create-github-app-token@v3",
        "vars.AUTOMATION_APP_CLIENT_ID",
        "steps.app-token.outputs.token",
    ):
        if required not in update_caller + update_workflow:
            raise RuntimeError(f"Update workflows must use {required}")

    for command in (
        "./.github/ci/prepare_update_branch.py",
        "./.github/ci/update.py",
        "NIX_UPDATE_SYSTEM: ${{ matrix.system }}",
        "./.github/ci/create_pr.py",
    ):
        if command not in update_workflow:
            raise RuntimeError(f"Update workflow must invoke {command}")


if __name__ == "__main__":
    main()

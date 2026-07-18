#!/usr/bin/env nix
#! nix shell --inputs-from .# nixpkgs#python3 --command python3
"""Reuse or create an automated update branch from the default branch."""

from __future__ import annotations

import argparse
import os

from lib import run


def branch_name(update_type: str, name: str) -> str:
    return f"automation/update-{update_type}-{name}"


def remote_branch_exists(branch: str) -> bool:
    return run(
        ["git", "ls-remote", "--exit-code", "--heads", "origin", branch],
        check=False,
    ).returncode == 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("type", choices=("package", "flake-input"))
    parser.add_argument("name")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    base_branch = os.environ.get("BASE_BRANCH", "main")
    branch = branch_name(args.type, args.name)
    run(["git", "fetch", "origin", base_branch])

    if not remote_branch_exists(branch):
        run(["git", "checkout", "-B", branch, f"origin/{base_branch}"])
        return

    print(f"Reusing update branch {branch}")
    run(["git", "fetch", "origin", branch])
    run(["git", "checkout", "-B", branch, f"origin/{branch}"])
    rebase = run(["git", "rebase", f"origin/{base_branch}"], check=False)
    if rebase.returncode == 0:
        return

    print(f"::warning::Cannot rebase {branch}; rebuilding it from {base_branch}")
    run(["git", "rebase", "--abort"], check=False)
    run(["git", "reset", "--hard", f"origin/{base_branch}"])


if __name__ == "__main__":
    main()

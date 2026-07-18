#!/usr/bin/env nix
#! nix shell --inputs-from .# nixpkgs#python3 --command python3
"""Commit an update branch and create, update, or merge its pull request."""

from __future__ import annotations

import argparse
import os
from dataclasses import dataclass

from lib import run


@dataclass(frozen=True, slots=True)
class PullRequest:
    body: str
    branch: str
    commit_message: str
    title: str


def build_pull_request(
    update_type: str,
    name: str,
    current_version: str,
    new_version: str,
) -> PullRequest:
    branch = f"automation/update-{update_type}-{name}"
    if update_type == "package":
        title = f"{name}: {current_version} -> {new_version}"
        body = f"Automated update of `{name}` from `{current_version}` to `{new_version}`."
    else:
        title = f"flake.lock: update {name}"
        body = f"Automated update of flake input `{name}` from `{current_version}` to `{new_version}`."
    return PullRequest(body=body, branch=branch, commit_message=title, title=title)


def pull_request_number(branch: str) -> str | None:
    result = run(
        ["gh", "pr", "list", "--head", branch, "--json", "number", "--jq", ".[0].number // empty"],
        capture=True,
    )
    return result.stdout.strip() or None


def label_arguments(labels: str) -> list[str]:
    return [
        argument
        for label in labels.split(",")
        if (stripped := label.strip())
        for argument in ("--label", stripped)
    ]


def create_or_update(pull_request: PullRequest) -> str:
    base_branch = os.environ.get("BASE_BRANCH", "main")
    labels = os.environ.get("PR_LABELS", "dependencies,automated")
    run(["git", "add", "."])
    run(["git", "commit", "-m", pull_request.commit_message])
    run(["git", "push", "--force-with-lease", "origin", f"HEAD:{pull_request.branch}"])

    number = pull_request_number(pull_request.branch)
    if number is not None:
        run(["gh", "pr", "edit", number, "--title", pull_request.title, "--body", pull_request.body])
        return number

    run(
        [
            "gh",
            "pr",
            "create",
            "--base",
            base_branch,
            "--head",
            pull_request.branch,
            "--title",
            pull_request.title,
            "--body",
            pull_request.body,
            *label_arguments(labels),
        ]
    )
    number = pull_request_number(pull_request.branch)
    if number is None:
        raise RuntimeError("GitHub did not return the created pull request")
    return number


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("type", choices=("package", "flake-input"))
    parser.add_argument("name")
    parser.add_argument("current_version")
    parser.add_argument("new_version")
    return parser.parse_args()


def main() -> None:
    if not os.environ.get("GH_TOKEN"):
        raise RuntimeError("GH_TOKEN must be set")
    args = parse_args()
    number = create_or_update(
        build_pull_request(args.type, args.name, args.current_version, args.new_version)
    )
    if os.environ.get("AUTO_MERGE", "false") == "true":
        run(["gh", "pr", "merge", number, "--squash", "--delete-branch"])


if __name__ == "__main__":
    main()

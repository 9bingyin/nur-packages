#!/usr/bin/env nix
#! nix shell --inputs-from .# nixpkgs#python3 --command python3
"""Merge automated update pull requests after their package builds succeed."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import TypeGuard, cast

from lib import run


def is_mapping(value: object) -> TypeGuard[dict[str, object]]:
    return isinstance(value, dict) and all(
        isinstance(key, str) for key in cast(dict[object, object], value)
    )


def is_object_list(value: object) -> TypeGuard[list[object]]:
    return isinstance(value, list)


def pull_request_numbers(event: dict[str, object]) -> list[int]:
    workflow_run = event.get("workflow_run")
    if not is_mapping(workflow_run):
        return []
    pull_requests = workflow_run.get("pull_requests")
    if not is_object_list(pull_requests):
        return []

    numbers: list[int] = []
    for pull_request in pull_requests:
        if not is_mapping(pull_request):
            continue
        number = pull_request.get("number")
        if isinstance(number, int):
            numbers.append(number)
    return numbers


def label_names(pull_request: dict[str, object]) -> set[str]:
    labels = pull_request.get("labels")
    if not is_object_list(labels):
        return set()
    return {
        name
        for label in labels
        if is_mapping(label)
        if isinstance(name := label.get("name"), str)
    }


def should_merge(pull_request: dict[str, object], head_sha: str, base_branch: str) -> bool:
    head_branch = pull_request.get("headRefName")
    head_oid = pull_request.get("headRefOid")
    base = pull_request.get("baseRefName")
    is_draft = pull_request.get("isDraft")
    required_labels = {"automated", "dependencies"}
    return (
        isinstance(head_branch, str)
        and head_branch.startswith("automation/update-")
        and head_oid == head_sha
        and base == base_branch
        and is_draft is False
        and required_labels.issubset(label_names(pull_request))
    )


def merge_pull_request(number: int, head_sha: str) -> None:
    result = run(
        [
            "gh",
            "pr",
            "view",
            str(number),
            "--json",
            "baseRefName,headRefName,headRefOid,isDraft,labels",
        ],
        capture=True,
    )
    payload: object = json.loads(result.stdout)
    if not is_mapping(payload):
        raise RuntimeError(f"GitHub returned invalid data for pull request #{number}")
    if not should_merge(
        payload,
        head_sha,
        os.environ.get("BASE_BRANCH", "main"),
    ):
        print(f"Skipping pull request #{number}: it is not an eligible automated update")
        return
    run(
        [
            "gh",
            "pr",
            "merge",
            str(number),
            "--squash",
            "--delete-branch",
            "--match-head-commit",
            head_sha,
        ]
    )


def main() -> None:
    event_path = os.environ.get("GITHUB_EVENT_PATH")
    head_sha = os.environ.get("WORKFLOW_HEAD_SHA")
    if not event_path or not head_sha:
        raise RuntimeError("GITHUB_EVENT_PATH and WORKFLOW_HEAD_SHA must be set")

    payload: object = json.loads(Path(event_path).read_text())
    if not is_mapping(payload):
        raise RuntimeError("GitHub event payload is not an object")
    for number in pull_request_numbers(payload):
        merge_pull_request(number, head_sha)


if __name__ == "__main__":
    main()

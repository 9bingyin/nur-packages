#!/usr/bin/env nix
#! nix shell --inputs-from .# nixpkgs#python3 --command python3
"""Update packages or flake inputs. CI groups open pull requests per target."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path

from lib import nix_eval_raw, run, write_output

CI_DIR = Path(__file__).resolve().parent


def has_changes() -> bool:
    return run(["git", "diff", "--quiet"], check=False).returncode != 0


def reset_worktree() -> None:
    run(["git", "reset", "--hard", "HEAD"], check=False)
    run(["git", "clean", "-fd"], check=False)


def nix_update_arguments(name: str) -> list[str]:
    path = Path("packages") / name / "nix-update-args"
    if not path.is_file():
        return []
    return [
        argument
        for line in path.read_text().splitlines()
        if (argument := line.strip()) and not argument.startswith("#")
    ]


def update_package(name: str, system: str) -> None:
    package_directory = Path("packages") / name
    update_script = package_directory / "update.py"
    if update_script.is_file():
        run([str(update_script)])
        return
    run(
        [
            "nix",
            "run",
            "nixpkgs#nix-update",
            "--",
            "--flake",
            "--system",
            system,
            name,
            *nix_update_arguments(name),
        ]
    )


def update_flake_input(name: str) -> None:
    run(["nix", "flake", "update", name])


def flake_input_revision(name: str) -> str:
    lock = json.loads(Path("flake.lock").read_text())
    nodes = lock.get("nodes", {}) if isinstance(lock, dict) else {}
    node = nodes.get(name, {}) if isinstance(nodes, dict) else {}
    locked = node.get("locked", {}) if isinstance(node, dict) else {}
    revision = (
        locked.get("rev") or locked.get("lastModified")
        if isinstance(locked, dict)
        else None
    )
    return str(revision)[:8] if revision is not None else "unknown"


def parse_targets(raw: str) -> list[tuple[str, str]]:
    payload: object = json.loads(raw)
    if not isinstance(payload, list):
        raise RuntimeError("UPDATE_TARGETS must be a JSON array")

    targets: list[tuple[str, str]] = []
    for item in payload:
        if not isinstance(item, dict):
            raise RuntimeError("UPDATE_TARGETS items must be objects")
        name = item.get("name")
        current_version = item.get("current_version")
        if not isinstance(name, str) or not name:
            raise RuntimeError("UPDATE_TARGETS item has no name")
        if not isinstance(current_version, str) or not current_version:
            raise RuntimeError(f"UPDATE_TARGETS item {name} has no current_version")
        targets.append((name, current_version))
    return targets


def apply_update(update_type: str, name: str, system: str) -> str | None:
    if update_type == "package":
        update_package(name, system)
    else:
        update_flake_input(name)
    if not has_changes():
        return None
    if update_type == "package":
        return nix_eval_raw(f".#packages.{system}.{name}.version") or "unknown"
    return flake_input_revision(name)


def process_target(
    update_type: str,
    name: str,
    current_version: str,
    system: str,
) -> None:
    reset_worktree()
    run([str(CI_DIR / "prepare_update_branch.py"), update_type, name])
    new_version = apply_update(update_type, name, system)
    if new_version is None:
        print(f"{name} is already up to date")
        return
    run(
        [
            str(CI_DIR / "create_pr.py"),
            update_type,
            name,
            current_version,
            new_version,
        ]
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("type", nargs="?", choices=("package", "flake-input"))
    parser.add_argument("name", nargs="?")
    return parser.parse_args()


def update_one(update_type: str, name: str, system: str) -> None:
    new_version = apply_update(update_type, name, system)
    if new_version is None:
        write_output("updated", "false")
        return
    write_output("updated", "true")
    write_output("new_version", new_version)


def update_group(update_type: str, system: str) -> None:
    raw_targets = os.environ.get("UPDATE_TARGETS")
    if not raw_targets:
        raise RuntimeError("UPDATE_TARGETS must be set")

    failed: list[str] = []
    for name, current_version in parse_targets(raw_targets):
        try:
            process_target(update_type, name, current_version, system)
        except (OSError, RuntimeError, ValueError, subprocess.CalledProcessError) as error:
            failed.append(name)
            print(f"::error::{name} update failed: {error}")
            reset_worktree()

    if failed:
        raise SystemExit(f"Failed to update: {', '.join(failed)}")


def main() -> None:
    args = parse_args()
    system = os.environ.get("NIX_UPDATE_SYSTEM", "x86_64-linux")
    if (args.type is None) != (args.name is None):
        raise RuntimeError("type and name must be provided together")
    if args.type is not None and args.name is not None:
        update_one(args.type, args.name, system)
        return

    update_type = os.environ.get("UPDATE_TYPE")
    if update_type not in {"package", "flake-input"}:
        raise RuntimeError("UPDATE_TYPE must be package or flake-input")
    update_group(update_type, system)


if __name__ == "__main__":
    main()

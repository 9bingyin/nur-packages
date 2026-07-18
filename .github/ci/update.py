#!/usr/bin/env nix
#! nix shell --inputs-from .# nixpkgs#python3 --command python3
"""Update one package or flake input and write GitHub Actions outputs."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from lib import nix_eval_raw, run, write_output


def has_changes() -> bool:
    return run(["git", "diff", "--quiet"], check=False).returncode != 0


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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("type", choices=("package", "flake-input"))
    parser.add_argument("name")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.type == "package":
        run(["./scripts/update-packages.py", args.name])
    else:
        update_flake_input(args.name)

    if not has_changes():
        write_output("updated", "false")
        return

    new_version = (
        nix_eval_raw(f".#packages.x86_64-linux.{args.name}.version")
        if args.type == "package"
        else flake_input_revision(args.name)
    )
    write_output("updated", "true")
    write_output("new_version", new_version or "unknown")


if __name__ == "__main__":
    main()

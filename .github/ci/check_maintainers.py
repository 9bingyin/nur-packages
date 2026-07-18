#!/usr/bin/env nix
#! nix shell --inputs-from .# nixpkgs#python3 --command python3
"""Fail pull requests that add public packages without meta.maintainers."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path

from lib import run

EXPRESSION = r"""
let
  flakePath = builtins.getEnv "CHECK_FLAKE_PATH";
  system = builtins.getEnv "CHECK_SYSTEM";
  flake = builtins.getFlake flakePath;
  pkgs = flake.packages.${system} or { };
  lib = flake.inputs.nixpkgs.lib;
  isHidden = pkg: (builtins.tryEval (pkg.passthru.hideFromDocs or false)).value or false;
  count = _name: pkg:
    let maintainers = builtins.tryEval (pkg.meta.maintainers or [ ]);
    in if isHidden pkg then null else if maintainers.success then builtins.length maintainers.value else 0;
in
  lib.filterAttrs (_: value: value != null) (builtins.mapAttrs count pkgs)
"""


def maintainer_counts(directory: Path, system: str) -> dict[str, int]:
    result = run(
        ["nix", "eval", "--impure", "--json", "--expr", EXPRESSION],
        capture=True,
        env={"CHECK_FLAKE_PATH": str(directory.resolve()), "CHECK_SYSTEM": system},
    )
    payload = json.loads(result.stdout)
    if not isinstance(payload, dict) or not all(
        isinstance(name, str) and isinstance(count, int) for name, count in payload.items()
    ):
        raise RuntimeError("Maintainer evaluation returned invalid JSON")
    return payload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-ref", default="origin/main")
    parser.add_argument("--system", default="x86_64-linux")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    repository = Path.cwd()
    base_sha = run(["git", "rev-parse", args.base_ref], cwd=repository, capture=True).stdout.strip()
    base_directory = Path(tempfile.mkdtemp(prefix="maintainers-base-"))

    try:
        run(["git", "worktree", "add", "--detach", str(base_directory), base_sha], cwd=repository)
        head = maintainer_counts(repository, args.system)
        base = maintainer_counts(base_directory, args.system)
    finally:
        run(["git", "worktree", "remove", "--force", str(base_directory)], cwd=repository, check=False)

    new_packages = sorted(set(head) - set(base))
    missing = [name for name in new_packages if head[name] == 0]
    if not missing:
        print("No new packages in this push." if not new_packages else "All new packages declare maintainers.")
        return

    for name in missing:
        print(f"::error file=packages/{name}/package.nix::New package '{name}' has empty meta.maintainers.")
    raise SystemExit(1)


if __name__ == "__main__":
    main()

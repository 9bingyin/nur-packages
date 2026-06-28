#!/usr/bin/env python3
"""Fail PRs that add packages without meta.maintainers."""

from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import cast

log = logging.getLogger("check-maintainers")

EXPR = r"""
let
  flakePath = builtins.getEnv "CHECK_FLAKE_PATH";
  system = builtins.getEnv "CHECK_SYSTEM";
  flake = builtins.getFlake flakePath;
  pkgs = flake.packages.${system} or { };
  lib = flake.inputs.nixpkgs.lib;
  isHidden = pkg: (builtins.tryEval (pkg.passthru.hideFromDocs or false)).value or false;
  count = name: pkg:
    let
      maintainers = builtins.tryEval (pkg.meta.maintainers or [ ]);
    in
      if isHidden pkg then null else if maintainers.success then builtins.length maintainers.value else 0;
in
lib.filterAttrs (_: value: value != null) (builtins.mapAttrs count pkgs)
"""


def run(*cmd: str, cwd: Path | None = None) -> str:
    result = subprocess.run(
        list(cmd),
        check=True,
        capture_output=True,
        text=True,
        cwd=cwd,
    )
    return result.stdout.strip()


def nix_eval_counts(flake_dir: Path, system: str) -> dict[str, int]:
    env = {
        **os.environ,
        "CHECK_FLAKE_PATH": str(flake_dir.resolve()),
        "CHECK_SYSTEM": system,
    }
    result = subprocess.run(
        ["nix", "eval", "--impure", "--json", "--expr", EXPR],
        check=True,
        capture_output=True,
        text=True,
        env=env,
    )
    return cast("dict[str, int]", json.loads(result.stdout))


def prepare_base_worktree(repo: Path, base_ref: str) -> Path:
    base_sha = run("git", "rev-parse", base_ref, cwd=repo)
    log.info("base ref %s -> %s", base_ref, base_sha[:12])
    base_dir = Path(tempfile.mkdtemp(prefix="maintainers-base-"))
    run("git", "worktree", "add", "--detach", str(base_dir), base_sha, cwd=repo)
    return base_dir


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-ref", default="origin/main")
    parser.add_argument("--system", default="x86_64-linux")
    args = parser.parse_args()

    repo = Path.cwd()
    base_dir = prepare_base_worktree(repo, args.base_ref)
    try:
        head = nix_eval_counts(repo, args.system)
        base = nix_eval_counts(base_dir, args.system)
    finally:
        run("git", "worktree", "remove", "--force", str(base_dir), cwd=repo)

    new_packages = sorted(set(head) - set(base))
    if not new_packages:
        log.info("No new packages in this PR.")
        return 0

    missing = [name for name in new_packages if head.get(name, 0) == 0]
    if not missing:
        log.info("All new packages declare maintainers.")
        return 0

    for name in missing:
        print(
            f"::error file=packages/{name}/package.nix"
            f"::New package '{name}' has empty meta.maintainers."
        )
    return 1


if __name__ == "__main__":
    sys.exit(main())

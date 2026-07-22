#!/usr/bin/env nix
#! nix shell --inputs-from .# nixpkgs#python3 --command python3
"""Build the matrix of public packages and their native GitHub runners."""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import PurePosixPath
from typing import TypeGuard, cast

from lib import run, write_output

RUNNERS = {
    "x86_64-linux": "ubuntu-latest",
    "aarch64-linux": "ubuntu-24.04-arm",
    "aarch64-darwin": "macos-latest",
}
GLOBAL_PACKAGE_PATHS = frozenset({"default.nix", "flake.lock", "flake.nix"})
GLOBAL_PACKAGE_PREFIXES = ("lib/", "overlays/")
PACKAGE_EXPRESSION = r"""
let
  system = builtins.getEnv "BUILD_SYSTEM";
  flake = builtins.getFlake (toString ./.);
  pkgs = flake.packages.${system} or { };
  isHidden = pkg:
    let result = builtins.tryEval (pkg.passthru.hideFromDocs or false);
    in if result.success then result.value else false;
  isPublic = pkg: pkg ? version && !(isHidden pkg);
in
  builtins.filter (name: isPublic pkgs.${name}) (builtins.attrNames pkgs)
"""


@dataclass(frozen=True, slots=True)
class MatrixItem:
    package: str
    runner: str
    system: str


def is_string_list(value: object) -> TypeGuard[list[str]]:
    return isinstance(value, list) and all(
        isinstance(item, str) for item in cast(list[object], value)
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base-revision",
        help="Build only packages changed since this Git revision; omit to build all packages",
    )
    return parser.parse_args()


def changed_paths(base_revision: str) -> list[str]:
    result = run(
        [
            "git",
            "diff",
            "--name-only",
            "--diff-filter=ACMR",
            f"{base_revision}...HEAD",
        ],
        capture=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"Failed to list changes since {base_revision}:\n{result.stderr}"
        )
    return result.stdout.splitlines()


def changed_packages(paths: list[str]) -> set[str] | None:
    """Return affected package directories, or None when every package is affected."""
    package_names: set[str] = set()
    for path in paths:
        if path in GLOBAL_PACKAGE_PATHS or path.startswith(GLOBAL_PACKAGE_PREFIXES):
            return None
        parts = PurePosixPath(path).parts
        if len(parts) >= 2 and parts[0] == "packages":
            package_names.add(parts[1])
    return package_names


def packages_for(system: str) -> list[str]:
    result = run(
        ["nix", "eval", "--json", "--impure", "--expr", PACKAGE_EXPRESSION],
        capture=True,
        check=False,
        env={"BUILD_SYSTEM": system},
    )
    if result.returncode != 0:
        raise RuntimeError(f"Failed to discover packages for {system}:\n{result.stderr}")

    payload: object = json.loads(result.stdout)
    if not is_string_list(payload):
        raise RuntimeError(f"Package discovery for {system} returned invalid JSON")
    return sorted(payload)


def main() -> None:
    args = parse_args()
    package_filter = (
        changed_packages(changed_paths(args.base_revision))
        if args.base_revision is not None
        else None
    )
    if package_filter is None:
        print("Building all public packages")
    else:
        print(f"Building changed packages: {', '.join(sorted(package_filter)) or '(none)'}")

    items = (
        [
            MatrixItem(package=package, runner=runner, system=system)
            for system, runner in RUNNERS.items()
            for package in packages_for(system)
            if package_filter is None or package in package_filter
        ]
        if package_filter is None or package_filter
        else []
    )
    matrix = {"include": [asdict(item) for item in items]}
    print(json.dumps(matrix, indent=2))
    write_output("matrix", json.dumps(matrix, separators=(",", ":")))
    write_output("has-packages", str(bool(items)).lower())


if __name__ == "__main__":
    main()

#!/usr/bin/env nix
#! nix shell --inputs-from .# nixpkgs#python3 --command python3
"""Build the matrix of public packages and their native GitHub runners."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from typing import TypeGuard, cast

from lib import run, write_output

RUNNERS = {
    "x86_64-linux": "ubuntu-latest",
    "aarch64-linux": "ubuntu-24.04-arm",
    "aarch64-darwin": "macos-latest",
}
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
    items = [
        MatrixItem(package=package, runner=runner, system=system)
        for system, runner in RUNNERS.items()
        for package in packages_for(system)
    ]
    matrix = {"include": [asdict(item) for item in items]}
    print(json.dumps(matrix, indent=2))
    write_output("matrix", json.dumps(matrix, separators=(",", ":")))
    write_output("has-packages", str(bool(items)).lower())


if __name__ == "__main__":
    main()

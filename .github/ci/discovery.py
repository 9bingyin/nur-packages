#!/usr/bin/env nix
#! nix shell --inputs-from .# nixpkgs#python3 --command python3
"""Build the GitHub Actions update matrix for packages and flake inputs."""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path

from lib import run, write_output

PACKAGE_EXPRESSION = r"""
let
  config = builtins.fromJSON (builtins.getEnv "DISCOVERY_CONFIG");
  flake = builtins.getFlake (toString ./.);
  pkgs = flake.packages.${config.system} or { };
  isHidden = pkg: (builtins.tryEval (pkg.passthru.hideFromDocs or false)).value or false;
  shouldDiscover = pkg: !(isHidden pkg) && pkg ? version;
  versionOf = name:
    if pkgs ? ${name} && shouldDiscover pkgs.${name} then {
      inherit name;
      value = pkgs.${name}.version;
    } else null;
in
if config.filter == null then
  builtins.mapAttrs (_: pkg: if shouldDiscover pkg then pkg.version else null) pkgs
else
  builtins.listToAttrs (builtins.filter (item: item != null) (map versionOf config.filter))
"""


@dataclass(frozen=True, slots=True)
class MatrixItem:
    current_version: str
    name: str
    type: str


def split_filter(value: str) -> list[str] | None:
    items = value.split()
    return items or None


def discover_packages(package_filter: list[str] | None, system: str) -> list[MatrixItem]:
    config = json.dumps({"filter": package_filter, "system": system})
    result = run(
        ["nix", "eval", "--json", "--impure", "--expr", PACKAGE_EXPRESSION],
        capture=True,
        check=False,
        env={"DISCOVERY_CONFIG": config},
    )
    if result.returncode != 0:
        raise RuntimeError(f"Failed to discover packages:\n{result.stderr}")

    raw_versions = json.loads(result.stdout)
    if not isinstance(raw_versions, dict):
        raise RuntimeError("Package discovery returned a non-object JSON value")

    items = [
        MatrixItem(current_version=version, name=name, type="package")
        for name, version in raw_versions.items()
        if isinstance(name, str) and isinstance(version, str)
    ]
    items.sort(key=lambda item: item.name)

    found = {item.name for item in items}
    for name in package_filter or []:
        if name not in found:
            print(f"::warning::Package {name} was not found or has no version")
    return items


def discover_flake_inputs(input_filter: list[str] | None) -> list[MatrixItem]:
    lock_path = Path("flake.lock")
    if not lock_path.exists():
        return []

    lock = json.loads(lock_path.read_text())
    if not isinstance(lock, dict):
        raise RuntimeError("flake.lock is not a JSON object")
    nodes = lock.get("nodes")
    if not isinstance(nodes, dict):
        raise RuntimeError("flake.lock has no nodes")
    root = nodes.get("root")
    root_inputs = root.get("inputs") if isinstance(root, dict) else None
    if not isinstance(root_inputs, dict):
        raise RuntimeError("flake.lock has no root inputs")

    names = input_filter or sorted(root_inputs)
    items: list[MatrixItem] = []
    for name in names:
        node = nodes.get(name)
        locked = node.get("locked") if isinstance(node, dict) else None
        revision = (
            locked.get("rev") or locked.get("lastModified")
            if isinstance(locked, dict)
            else None
        )
        current_version = str(revision)[:8] if revision is not None else "unknown"
        items.append(MatrixItem(current_version=current_version, name=name, type="flake-input"))
    return items


def main() -> None:
    package_filter = split_filter(os.environ.get("PACKAGES", ""))
    input_filter = split_filter(os.environ.get("INPUTS", ""))
    system = os.environ.get("SYSTEM", "x86_64-linux")
    matrix = {
        "include": [
            *(asdict(item) for item in discover_packages(package_filter, system)),
            *(asdict(item) for item in discover_flake_inputs(input_filter)),
        ]
    }
    print(json.dumps(matrix, indent=2))
    write_output("matrix", json.dumps(matrix, separators=(",", ":")))
    write_output("has-updates", str(bool(matrix["include"])).lower())


if __name__ == "__main__":
    main()

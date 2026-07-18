#!/usr/bin/env nix
#! nix shell --inputs-from .# nixpkgs#python3 --command python3
"""Build the GitHub Actions update matrix for packages and flake inputs."""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path

from lib import run, write_output

PACKAGE_SYSTEMS = ("x86_64-linux", "aarch64-linux", "aarch64-darwin")
PACKAGE_EXPRESSION = r"""
let
  config = builtins.fromJSON (builtins.getEnv "DISCOVERY_CONFIG");
  flake = builtins.getFlake (toString ./.);
  pkgs = flake.packages.${config.system} or { };
  isHidden = pkg: (builtins.tryEval (pkg.passthru.hideFromDocs or false)).value or false;
  shouldDiscover = pkg: !(isHidden pkg) && pkg ? version;
in
  builtins.mapAttrs (_: pkg: if shouldDiscover pkg then pkg.version else null) pkgs
"""


@dataclass(frozen=True, slots=True)
class MatrixItem:
    current_version: str
    name: str
    system: str
    type: str


def split_filter(value: str) -> list[str] | None:
    items = value.split()
    return items or None


def package_versions(system: str) -> dict[str, str]:
    result = run(
        ["nix", "eval", "--json", "--impure", "--expr", PACKAGE_EXPRESSION],
        capture=True,
        check=False,
        env={"DISCOVERY_CONFIG": json.dumps({"system": system})},
    )
    if result.returncode != 0:
        raise RuntimeError(f"Failed to discover packages for {system}:\n{result.stderr}")

    payload: object = json.loads(result.stdout)
    if not isinstance(payload, dict):
        raise RuntimeError(f"Package discovery for {system} returned a non-object JSON value")
    return {
        name: version
        for name, version in payload.items()
        if isinstance(name, str) and isinstance(version, str)
    }


def discover_packages(package_filter: list[str] | None) -> list[MatrixItem]:
    discovered: dict[str, MatrixItem] = {}
    for system in PACKAGE_SYSTEMS:
        for name, version in package_versions(system).items():
            if package_filter is None or name in package_filter:
                discovered.setdefault(
                    name,
                    MatrixItem(
                        current_version=version,
                        name=name,
                        system=system,
                        type="package",
                    ),
                )

    for name in package_filter or []:
        if name not in discovered:
            print(f"::warning::Package {name} was not found or has no version")
    return sorted(discovered.values(), key=lambda item: item.name)


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
        items.append(
            MatrixItem(
                current_version=str(revision)[:8] if revision is not None else "unknown",
                name=name,
                system="x86_64-linux",
                type="flake-input",
            )
        )
    return items


def main() -> None:
    package_filter = split_filter(os.environ.get("PACKAGES", ""))
    input_filter = split_filter(os.environ.get("INPUTS", ""))
    matrix = {
        "include": [
            *(asdict(item) for item in discover_packages(package_filter)),
            *(asdict(item) for item in discover_flake_inputs(input_filter)),
        ]
    }
    print(json.dumps(matrix, indent=2))
    write_output("matrix", json.dumps(matrix, separators=(",", ":")))
    write_output("has-updates", str(bool(matrix["include"])).lower())


if __name__ == "__main__":
    main()

#!/usr/bin/env nix
#! nix shell --inputs-from .# nixpkgs#python3 --command python3
"""Build the GitHub Actions update matrix for packages and flake inputs."""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path

from lib import NATIVE_RUNNERS, run, write_output

PACKAGE_SYSTEMS = tuple(NATIVE_RUNNERS)
MANUAL_UPDATE_MARKER = "no-auto-update"
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
GROUP_SPECS = (
    ("linux-x86", "x86_64-linux", "package"),
    ("linux-arm", "aarch64-linux", "package"),
    ("darwin-arm", "aarch64-darwin", "package"),
    ("linux-flake-input", "x86_64-linux", "flake-input"),
)


@dataclass(frozen=True, slots=True)
class Target:
    current_version: str
    name: str
    system: str
    type: str


@dataclass(frozen=True, slots=True)
class MatrixItem:
    group: str
    runner: str
    system: str
    targets: list[dict[str, str]]
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
        raise RuntimeError(
            f"Failed to discover packages for {system}:\n{result.stderr}"
        )

    payload: object = json.loads(result.stdout)
    if not isinstance(payload, dict):
        raise RuntimeError(
            f"Package discovery for {system} returned a non-object JSON value"
        )
    return {
        name: version
        for name, version in payload.items()
        if isinstance(name, str) and isinstance(version, str)
    }


def automatic_updates_disabled(name: str) -> bool:
    return (Path("packages") / name / MANUAL_UPDATE_MARKER).is_file()


def discover_packages(package_filter: list[str] | None) -> list[Target]:
    discovered: dict[str, Target] = {}
    disabled: set[str] = set()
    for system in PACKAGE_SYSTEMS:
        for name, version in package_versions(system).items():
            if automatic_updates_disabled(name):
                disabled.add(name)
                continue
            if package_filter is None or name in package_filter:
                discovered.setdefault(
                    name,
                    Target(
                        current_version=version,
                        name=name,
                        system=system,
                        type="package",
                    ),
                )

    for name in package_filter or []:
        if name in disabled:
            print(f"::warning::Package {name} has automatic updates disabled")
        elif name not in discovered:
            print(f"::warning::Package {name} was not found or has no version")
    return sorted(discovered.values(), key=lambda item: item.name)


def discover_flake_inputs(input_filter: list[str] | None) -> list[Target]:
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
    items: list[Target] = []
    for name in names:
        node = nodes.get(name)
        locked = node.get("locked") if isinstance(node, dict) else None
        revision = (
            locked.get("rev") or locked.get("lastModified")
            if isinstance(locked, dict)
            else None
        )
        items.append(
            Target(
                current_version=str(revision)[:8]
                if revision is not None
                else "unknown",
                name=name,
                system="x86_64-linux",
                type="flake-input",
            )
        )
    return items


def encode_targets(items: list[Target]) -> list[dict[str, str]]:
    return [
        {"current_version": item.current_version, "name": item.name} for item in items
    ]


def build_matrix(
    packages: list[Target], flake_inputs: list[Target]
) -> dict[str, list[dict[str, object]]]:
    include: list[dict[str, object]] = []
    for group, system, update_type in GROUP_SPECS:
        items = [
            item
            for item in (packages if update_type == "package" else flake_inputs)
            if item.system == system and item.type == update_type
        ]
        if not items:
            continue
        include.append(
            asdict(
                MatrixItem(
                    group=group,
                    runner=NATIVE_RUNNERS[system],
                    system=system,
                    targets=encode_targets(items),
                    type=update_type,
                )
            )
        )
    return {"include": include}


def main() -> None:
    package_filter = split_filter(os.environ.get("PACKAGES", ""))
    input_filter = split_filter(os.environ.get("INPUTS", ""))
    matrix = build_matrix(
        discover_packages(package_filter),
        discover_flake_inputs(input_filter),
    )
    print(json.dumps(matrix, indent=2))
    write_output("matrix", json.dumps(matrix, separators=(",", ":")))
    write_output("has-updates", str(bool(matrix["include"])).lower())


if __name__ == "__main__":
    main()

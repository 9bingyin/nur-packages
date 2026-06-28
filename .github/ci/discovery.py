#!/usr/bin/env python3
"""Build a GitHub Actions matrix for package and flake-input updates."""

from __future__ import annotations

import json
import logging
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

log = logging.getLogger("discovery")

PACKAGE_EXPR = r"""
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


@dataclass(frozen=True)
class MatrixItem:
    type: str
    name: str
    current_version: str

    def to_dict(self) -> dict[str, str]:
        return {
            "type": self.type,
            "name": self.name,
            "current_version": self.current_version,
        }


def write_output(key: str, value: str) -> None:
    output_path = os.environ.get("GITHUB_OUTPUT")
    if output_path:
        with Path(output_path).open("a") as output:
            output.write(f"{key}={value}\n")
    else:
        log.info("output: %s=%s", key, value)


def split_filter(value: str) -> list[str] | None:
    items = value.split()
    return items or None


def discover_packages(packages_filter: list[str] | None, system: str) -> list[MatrixItem]:
    config = json.dumps({"system": system, "filter": packages_filter})
    result = subprocess.run(
        ["nix", "eval", "--json", "--impure", "--expr", PACKAGE_EXPR],
        capture_output=True,
        text=True,
        env={**os.environ, "DISCOVERY_CONFIG": config},
        check=False,
    )
    if result.returncode != 0:
        log.error("failed to discover packages:\n%s", result.stderr)
        raise SystemExit(result.returncode)

    versions: dict[str, str | None] = json.loads(result.stdout)
    items = [
        MatrixItem("package", name, version)
        for name, version in sorted(versions.items())
        if version is not None
    ]

    if packages_filter:
        found = {item.name for item in items}
        for name in packages_filter:
            if name not in found:
                log.warning("package %s was not found or has no version", name)

    return items


def root_input_names(lock: dict[str, Any]) -> list[str]:
    nodes = lock.get("nodes", {})
    root = nodes.get("root", {})
    inputs = root.get("inputs", {})
    if not isinstance(inputs, dict):
        return []
    return sorted(inputs)


def input_revision(lock: dict[str, Any], name: str) -> str:
    node = lock.get("nodes", {}).get(name, {})
    locked = node.get("locked", {})
    if not isinstance(locked, dict):
        return "unknown"
    return str(locked.get("rev") or locked.get("lastModified") or "unknown")[:8]


def discover_flake_inputs(inputs_filter: list[str] | None) -> list[MatrixItem]:
    lock_path = Path("flake.lock")
    if not lock_path.exists():
        return []

    lock = json.loads(lock_path.read_text())
    names = inputs_filter or root_input_names(lock)
    return [MatrixItem("flake-input", name, input_revision(lock, name)) for name in names]


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    packages_filter = split_filter(os.environ.get("PACKAGES", ""))
    inputs_filter = split_filter(os.environ.get("INPUTS", ""))
    system = os.environ.get("SYSTEM", "x86_64-linux")

    items = [
        *discover_packages(packages_filter, system),
        *discover_flake_inputs(inputs_filter),
    ]
    matrix = {"include": [item.to_dict() for item in items]}

    log.info("discovered %d update target(s)", len(items))
    log.info(json.dumps(matrix, indent=2))

    write_output("matrix", json.dumps(matrix, separators=(",", ":")))
    write_output("has-updates", str(bool(items)).lower())


if __name__ == "__main__":
    main()

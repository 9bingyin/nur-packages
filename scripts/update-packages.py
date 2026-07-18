#!/usr/bin/env nix
#! nix shell --inputs-from .# nixpkgs#python3 --command python3
"""Update one package through its package-specific updater or nix-update."""

from __future__ import annotations

import argparse
import os
import subprocess
from collections.abc import Sequence
from pathlib import Path

SYSTEM = os.environ.get("NIX_UPDATE_SYSTEM", "x86_64-linux")


def run(command: Sequence[str]) -> None:
    subprocess.run(command, check=True)


def nix_update_arguments(package: str) -> list[str]:
    path = Path("packages") / package / "nix-update-args"
    if not path.is_file():
        return []
    return [
        argument
        for line in path.read_text().splitlines()
        if (argument := line.strip()) and not argument.startswith("#")
    ]


def update_package(package: str) -> None:
    package_directory = Path("packages") / package
    if not (package_directory / "package.nix").is_file():
        raise RuntimeError(f"Unknown package: {package}")

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
            SYSTEM,
            package,
            *nix_update_arguments(package),
        ]
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", help="public package attribute to update")
    return parser.parse_args()


def main() -> None:
    update_package(parse_args().package)


if __name__ == "__main__":
    main()

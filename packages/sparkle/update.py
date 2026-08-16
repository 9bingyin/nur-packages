#!/usr/bin/env python3
"""Update Sparkle and its bundled Go sidecars with nix-update."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).parents[2]
PACKAGE = ROOT / "packages" / "sparkle" / "package.nix"
SYSTEM = "aarch64-darwin"
UNSTABLE_VERSION = re.compile(
    r'(version = ")(?!0-unstable-)[^"]+-unstable-(\d{4}-\d{2}-\d{2}";)'
)


def nix_update(*arguments: str) -> None:
    subprocess.run(
        [
            "nix",
            "run",
            "nixpkgs#nix-update",
            "--",
            "--flake",
            "--system",
            SYSTEM,
            *arguments,
        ],
        check=True,
        cwd=ROOT,
    )


def normalize_unstable_versions() -> None:
    text = PACKAGE.read_text()
    updated, count = UNSTABLE_VERSION.subn(r"\g<1>0-unstable-\2", text)
    if count:
        PACKAGE.write_text(updated)


def main() -> None:
    nix_update("sparkle")
    nix_update("--version=branch", "sparkle.sparkle-service")
    nix_update("--version=branch=Alpha", "sparkle.mihomo-alpha")
    normalize_unstable_versions()


if __name__ == "__main__":
    main()

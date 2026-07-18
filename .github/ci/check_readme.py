#!/usr/bin/env nix
#! nix shell --inputs-from .# nixpkgs#python3 --command python3
"""Keep README's package catalogue aligned with public package definitions."""

from __future__ import annotations

import re
from pathlib import Path

HIDDEN_PACKAGES = {"default", "formatter"}
PACKAGE_LINK = re.compile(r"\]\(packages/([^/]+)/package\.nix\)")


def package_names() -> set[str]:
    return {
        path.name
        for path in Path("packages").iterdir()
        if path.is_dir() and path.name not in HIDDEN_PACKAGES and (path / "package.nix").is_file()
    }


def main() -> None:
    documented = set(PACKAGE_LINK.findall(Path("README.md").read_text()))
    packages = package_names()
    missing = sorted(packages - documented)
    stale = sorted(documented - packages)
    if not missing and not stale:
        print("README package catalogue is consistent.")
        return
    if missing:
        print(f"::error::README package catalogue is missing: {', '.join(missing)}")
    if stale:
        print(f"::error::README references missing packages: {', '.join(stale)}")
    raise SystemExit(1)


if __name__ == "__main__":
    main()

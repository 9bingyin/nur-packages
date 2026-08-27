"""Evaluate and compare package outputs for two flake checkouts."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path
from typing import Optional, cast

Package = dict[str, Optional[str]]
PackageSet = dict[str, Package]

APPLY_EXPRESSION = (
    "packages: builtins.mapAttrs (_: package: { "
    "path = package.outPath; "
    "version = package.version or null; "
    "}) packages"
)


def evaluate_packages(repository: Path, system: str) -> PackageSet:
    command = [
        "nix",
        "eval",
        "--json",
        "--no-write-lock-file",
        "--option",
        "accept-flake-config",
        "false",
        "--option",
        "allow-import-from-derivation",
        "false",
        f"path:{repository.resolve()}#packages.{system}",
        "--apply",
        APPLY_EXPRESSION,
    ]
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    payload: object = json.loads(result.stdout)
    if not isinstance(payload, dict):
        raise RuntimeError(f"Package evaluation for {system} returned a non-object")

    packages = cast(dict[object, object], payload)
    validated: PackageSet = {}
    for name, value in packages.items():
        if not isinstance(name, str) or not isinstance(value, dict):
            raise RuntimeError(f"Package evaluation for {system} returned invalid data")
        path = value.get("path")
        version = value.get("version")
        if not isinstance(path, str):
            raise RuntimeError(f"Package {name} has no output path on {system}")
        if version is not None and not isinstance(version, str):
            raise RuntimeError(f"Package {name} has an invalid version on {system}")
        validated[name] = {"path": path, "version": version}
    return validated


def comparison(
    target: PackageSet, merged: PackageSet, system: str
) -> dict[str, object]:
    target_names = set(target)
    merged_names = set(merged)
    common_names = target_names & merged_names
    changed = [
        {
            "after": merged[name],
            "before": target[name],
            "name": name,
        }
        for name in sorted(common_names)
        if target[name]["path"] != merged[name]["path"]
    ]
    return {
        "added": sorted(merged_names - target_names),
        "changed": changed,
        "mergedCount": len(merged),
        "removed": sorted(target_names - merged_names),
        "system": system,
        "targetCount": len(target),
        "unchangedCount": len(common_names) - len(changed),
    }


def markdown_summary(result: dict[str, object]) -> str:
    added = cast(list[str], result["added"])
    changed = cast(list[dict[str, object]], result["changed"])
    removed = cast(list[str], result["removed"])
    lines = [
        f"## Eval: {result['system']}",
        "",
        "| Result | Count |",
        "| --- | ---: |",
        f"| Added | {len(added)} |",
        f"| Removed | {len(removed)} |",
        f"| Changed | {len(changed)} |",
        f"| Unchanged | {result['unchangedCount']} |",
    ]
    sections = (
        ("Added packages", added),
        ("Removed packages", removed),
        ("Changed packages", [cast(str, item["name"]) for item in changed]),
    )
    for title, names in sections:
        if names:
            lines.extend(["", f"### {title}", "", *[f"- `{name}`" for name in names]])
    return "\n".join(lines) + "\n"


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--merged", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--system", required=True)
    parser.add_argument("--target", required=True, type=Path)
    return parser.parse_args()


def main() -> None:
    args = arguments()
    target = evaluate_packages(args.target, args.system)
    merged = evaluate_packages(args.merged, args.system)
    result = comparison(target, merged, args.system)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")

    summary = markdown_summary(result)
    print(summary)
    if summary_path := os.environ.get("GITHUB_STEP_SUMMARY"):
        with Path(summary_path).open("a") as file:
            file.write(summary)


if __name__ == "__main__":
    main()

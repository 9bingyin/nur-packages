#!/usr/bin/env python3
"""Update Sparkle and its bundled service with nix-update."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parents[2]
PACKAGE = ROOT / "packages" / "sparkle" / "package.nix"
SYSTEM = "aarch64-darwin"
SPARKLE_VERSION = re.compile(r'^  version = "([^"]+)";', re.MULTILINE)
SERVICE_BLOCK = re.compile(
    r"  sparkle-service = buildGoModule \{(?P<body>.*?)\n  \};", re.DOTALL
)
SERVICE_VERSION = re.compile(r'(pname = "sparkle-service";\n\s+version = ")([^"]+)(";)')
SERVICE_SOURCE = re.compile(
    r'src = fetchFromGitHub \{.*?rev = "([^"]+)";\s+hash = "([^"]+)";'
    r'\s+\};\s+vendorHash = "([^"]+)";',
    re.DOTALL,
)
UNSTABLE_VERSION = re.compile(r"(?:.*-)?unstable-(\d{4}-\d{2}-\d{2})")


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
        stdout=sys.stderr,
    )


def versions(text: str) -> tuple[str, str]:
    sparkle = SPARKLE_VERSION.search(text)
    service = SERVICE_VERSION.search(text)
    if sparkle is None or service is None:
        raise RuntimeError("Failed to read Sparkle package versions")
    return sparkle.group(1), service.group(2)


def service_source(text: str) -> tuple[str, str, str]:
    block = SERVICE_BLOCK.search(text)
    source = SERVICE_SOURCE.search(block.group("body")) if block is not None else None
    if source is None:
        raise RuntimeError("Failed to read sparkle-service source")
    return source.group(1), source.group(2), source.group(3)


def normalize_service_version(text: str) -> str:
    service = SERVICE_VERSION.search(text)
    if service is None:
        raise RuntimeError("Failed to find sparkle-service version")
    unstable = UNSTABLE_VERSION.fullmatch(service.group(2))
    if unstable is None:
        raise RuntimeError(f"Unexpected sparkle-service version: {service.group(2)}")
    version = f"0-unstable-{unstable.group(1)}"
    return f"{text[: service.start(2)]}{version}{text[service.end(2) :]}"


def service_change(old_version: str, new_version: str) -> tuple[str, str]:
    if old_version == new_version:
        return (
            f"sparkle: refresh sparkle-service {new_version}",
            f"Refresh bundled `sparkle-service` at `{new_version}`.",
        )
    return (
        f"sparkle: update sparkle-service {old_version} -> {new_version}",
        f"Update bundled `sparkle-service` from `{old_version}` to `{new_version}`.",
    )


def main() -> None:
    original = PACKAGE.read_text()
    old_sparkle, old_service = versions(original)

    nix_update("sparkle")
    after_sparkle = PACKAGE.read_text()
    nix_update("--version=branch=main", "sparkle.sparkle-service")
    final = normalize_service_version(PACKAGE.read_text())
    PACKAGE.write_text(final)

    new_sparkle, new_service = versions(final)
    sparkle_changed = after_sparkle != original
    service_changed = service_source(final) != service_source(after_sparkle)
    if sparkle_changed and old_sparkle == new_sparkle:
        raise RuntimeError("Sparkle changed without changing its version")
    if not sparkle_changed and not service_changed:
        print("[]")
        return

    service_message, service_body = service_change(old_service, new_service)
    if sparkle_changed:
        message = f"sparkle: {old_sparkle} -> {new_sparkle}"
        body = service_body if service_changed else None
    else:
        message = service_message
        body = service_body

    change = {"commitMessage": message}
    if body is not None:
        change["commitBody"] = body
    print(json.dumps([change], separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"error: {error}", file=sys.stderr)
        raise SystemExit(1) from error

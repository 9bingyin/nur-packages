#!/usr/bin/env bash
set -euo pipefail

system="${NIX_UPDATE_SYSTEM:-x86_64-linux}"

nix_update() {
  nix run nixpkgs#nix-update -- --flake --system "$system" "$@"
}

current_version() {
  nix eval --raw --system "$system" --impure ".#$1.version"
}

latest_longbridge_version() {
  python3 - <<'PY'
import json
import os
import re
import sys
import urllib.request

headers = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "9bingyin-nur-packages-updater",
}
if token := os.environ.get("GITHUB_TOKEN"):
    headers["Authorization"] = f"Bearer {token}"

api_url = (
    "https://api.github.com/repos/longbridge/longbridge-desktop-website/"
    "contents/docs/release-notes"
)
request = urllib.request.Request(api_url, headers=headers)
entries = json.load(urllib.request.urlopen(request, timeout=30))

versions = sorted(
    {
        match.group(1)
        for entry in entries
        if entry.get("type") == "file"
        for match in [re.fullmatch(r"v([0-9]+\.[0-9]+\.[0-9]+)\.md", entry.get("name", ""))]
        if match
    },
    key=lambda version: tuple(map(int, version.split("."))),
    reverse=True,
)

suffixes = [
    "linux-x86_64.deb",
    "macos-aarch64.dmg",
]

for version in versions:
    for suffix in suffixes:
        url = (
            "https://assets.lbkrs.com/github/release/longbridge-desktop/stable/"
            f"longbridge-v{version}-{suffix}"
        )
        try:
            request = urllib.request.Request(url, headers=headers, method="HEAD")
            with urllib.request.urlopen(request, timeout=30) as response:
                if response.status != 200:
                    break
        except Exception:
            break
    else:
        print(version)
        sys.exit(0)

raise SystemExit("no valid longbridge release with linux and macOS artifacts found")
PY
}

prefetch_sri_hash() {
  local url="$1"

  nix store prefetch-file --json "$url" |
    python3 -c 'import json, sys; print(json.load(sys.stdin)["hash"])'
}

update_longbridge_hashes() {
  local version="$1"
  local linux_hash="$2"
  local macos_aarch64_hash="$3"

  python3 - \
    "$version" \
    "$linux_hash" \
    "$macos_aarch64_hash" <<'PY'
import re
import sys
from pathlib import Path

version, linux_hash, macos_aarch64_hash = sys.argv[1:]
path = Path("packages/longbridge/package.nix")
text = path.read_text()

text, count = re.subn(r'(?m)^  version = "[^"]+";', f'  version = "{version}";', text, count=1)
if count != 1:
    raise SystemExit("failed to update longbridge version")

for suffix, hash_value in {
    "linux-x86_64.deb": linux_hash,
    "macos-aarch64.dmg": macos_aarch64_hash,
}.items():
    pattern = re.compile(rf'(suffix = "{re.escape(suffix)}";\n\s+hash = ")[^"]+(";)')
    text, count = pattern.subn(rf'\g<1>{hash_value}\2', text, count=1)
    if count != 1:
        raise SystemExit(f"failed to update hash for {suffix}")

path.write_text(text)
PY
}

update_longbridge_terminal() {
  nix_update --use-github-releases longbridge-terminal
}

update_longbridge() {
  local version
  local base_url
  local linux_hash
  local macos_aarch64_hash

  version="$(latest_longbridge_version)"
  base_url="https://assets.lbkrs.com/github/release/longbridge-desktop/stable/longbridge-v${version}"

  echo "latest longbridge version: $version"
  linux_hash="$(prefetch_sri_hash "${base_url}-linux-x86_64.deb")"
  macos_aarch64_hash="$(prefetch_sri_hash "${base_url}-macos-aarch64.dmg")"

  update_longbridge_hashes \
    "$version" \
    "$linux_hash" \
    "$macos_aarch64_hash"
}

update_warp() {
  nix_update --version=branch=master warp
}

update_package() {
  local package="$1"

  case "$package" in
  longbridge)
    update_longbridge
    ;;
  longbridge-terminal)
    update_longbridge_terminal
    ;;
  warp)
    update_warp
    ;;
  *)
    echo "unsupported package: $package" >&2
    return 2
    ;;
  esac
}

set_output() {
  local key="$1"
  local value="$2"

  if [[ -n ${GITHUB_OUTPUT:-} ]]; then
    printf '%s=%s\n' "$key" "$value" >>"$GITHUB_OUTPUT"
  fi
}

update_with_outputs() {
  local package="$1"
  local old_version
  local new_version
  local commit_message

  old_version="$(current_version "$package")"
  update_package "$package"
  new_version="$(current_version "$package")"

  if [[ $old_version == "$new_version" ]]; then
    commit_message="$package: update"
  else
    commit_message="$package: $old_version -> $new_version"
  fi

  echo "commit message: $commit_message"
  set_output package "$package"
  set_output old_version "$old_version"
  set_output new_version "$new_version"
  set_output commit_message "$commit_message"
}

main() {
  if [[ $# -eq 0 ]]; then
    echo "usage: $0 <longbridge|longbridge-terminal|warp|all>" >&2
    return 2
  fi

  if [[ $1 == "all" ]]; then
    update_package longbridge-terminal
    update_package longbridge
    update_package warp
    return
  fi

  update_with_outputs "$1"
}

main "$@"

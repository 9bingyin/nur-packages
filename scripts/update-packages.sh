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

for version in versions:
    deb_url = (
        "https://assets.lbkrs.com/github/release/longbridge-desktop/stable/"
        f"longbridge-v{version}-linux-x86_64.deb"
    )
    try:
        request = urllib.request.Request(deb_url, headers=headers, method="HEAD")
        with urllib.request.urlopen(request, timeout=30) as response:
            if response.status == 200:
                print(version)
                sys.exit(0)
    except Exception:
        continue

raise SystemExit("no valid longbridge linux deb release found")
PY
}

update_longbridge_terminal() {
  nix_update --use-github-releases longbridge-terminal
}

update_longbridge() {
  local version
  version="$(latest_longbridge_version)"
  echo "latest longbridge version: $version"
  nix_update --version="$version" longbridge
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

  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
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

  if [[ "$old_version" == "$new_version" ]]; then
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
  if [[ "$#" -eq 0 ]]; then
    echo "usage: $0 <longbridge|longbridge-terminal|warp|all>" >&2
    return 2
  fi

  if [[ "$1" == "all" ]]; then
    update_package longbridge-terminal
    update_package longbridge
    update_package warp
    return
  fi

  update_with_outputs "$1"
}

main "$@"

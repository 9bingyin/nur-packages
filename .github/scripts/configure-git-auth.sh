#!/usr/bin/env bash
# Authenticate later git commands as the automation app, including worktrees.
# actions/checkout stores the read-only GITHUB_TOKEN in an includeIf file, and
# that header is sent instead of GH_TOKEN. Pushes then show up as github-actions[bot].
set -euo pipefail

if [[ -z ${GH_TOKEN:-} ]]; then
  echo "GH_TOKEN is required" >&2
  exit 1
fi

while IFS= read -r key; do
  [[ -n $key ]] || continue
  while IFS= read -r path; do
    [[ -n $path && -f $path ]] || continue
    case "$(basename "$path")" in
    git-credentials-*.config) rm -f "$path" ;;
    esac
  done < <(git config --local --get-all "$key" || true)
  git config --local --unset-all "$key" || true
done < <(git config --local --name-only --get-regexp '^includeIf\.gitdir:' || true)

auth_dir="$(mktemp -d "${TMPDIR:-/tmp}/git-auth.XXXXXX")"
chmod 700 "$auth_dir"
token_file="$auth_dir/token"
helper="$auth_dir/helper"
umask 077
printf '%s' "$GH_TOKEN" >"$token_file"
cat >"$helper" <<EOF
#!/bin/sh
if [ "\$1" = get ]; then
  printf 'username=x-access-token\npassword=%s\n' "\$(cat $(printf '%q' "$token_file"))"
fi
EOF
chmod 700 "$helper"

basic="$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 | tr -d '\n')"
git config --local --unset-all http.https://github.com/.extraheader || true
git config --local http.https://github.com/.extraheader "AUTHORIZATION: basic ${basic}"

# Empty values clear helpers from checkout, gh auth setup-git, and the system.
# The next helper returns only the app token, including inside a worktree.
git config --local --unset-all credential.helper || true
git config --local credential.helper ""
git config --local --add credential.helper "!$helper"
git config --local --unset-all credential.https://github.com.helper || true
git config --local credential.https://github.com.helper ""
git config --local --add credential.https://github.com.helper "!$helper"

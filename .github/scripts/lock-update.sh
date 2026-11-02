#!/usr/bin/env bash
set -euo pipefail

if git diff --quiet -- flake.lock && git diff --cached --quiet -- flake.lock; then
  echo "flake.lock is already up to date"
  exit 0
fi

base="$(git rev-parse HEAD)"
git add flake.lock
git commit -m "flake.lock: update inputs"

remote=""
if git fetch --quiet origin refs/heads/update/lock; then
  remote="$(git rev-parse FETCH_HEAD)"
fi
if [[ -n $remote && -n ${BOT_NAME:-} ]]; then
  foreign="$(
    git log --format=%an "$remote" "^${base}" |
      awk -v bot="$BOT_NAME" 'NF && $0 != bot && $0 != "mergify[bot]" { found = 1 } END { if (found) print "yes" }'
  )"
  if [[ $foreign == yes ]]; then
    echo "Skipping update/lock because it contains manual changes"
    exit 0
  fi
fi
if [[ -n $remote ]]; then
  git push --force-with-lease="refs/heads/update/lock:${remote}" origin "HEAD:refs/heads/update/lock"
else
  git push origin "HEAD:refs/heads/update/lock"
fi

existing="$(gh pr list --head update/lock --json number --jq '.[0].number // empty')"
if [[ -z $existing ]]; then
  gh pr create \
    --base "${BASE_BRANCH}" \
    --head update/lock \
    --title "flake.lock: update inputs" \
    --body "Automated update of flake inputs." \
    --label dependencies \
    --label automated
fi

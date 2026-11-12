#!/usr/bin/env bash
set -euo pipefail
repo=${1:?usage: candidate.sh <plugin checkout or worktree> <out dir> [commit]}
out=${2:?usage: candidate.sh <plugin checkout or worktree> <out dir> [commit]}
commit=${3:-HEAD}
modules=$(git -C "$repo" worktree list --porcelain | sed -n '1s/^worktree //p')/node_modules
rm -rf "$out"; mkdir -p "$out"
git -C "$repo" archive --format=tar "$commit" | tar -x -C "$out"
cp -a "$modules" "$out/node_modules"
printf '{"commit":"%s","source":"%s","builtAt":"%s"}\n' "$(git -C "$repo" rev-parse "$commit")" "$repo" "$(date -Is)" > "$out/RELEASE.json"
(cd "$out" && bb plugin build . >/dev/null)
echo "$out built from $(git -C "$repo" rev-parse --short "$commit")"

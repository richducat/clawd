#!/usr/bin/env bash
set -euo pipefail

# Auto-commit + push any changes across multiple repos.
# Intended for unattended backup. Safe-ish defaults:
# - pulls with rebase before pushing
# - creates a new commit only if there are changes
# - does NOT attempt conflict resolution; if pull --rebase fails, it aborts that repo.

TS_UTC=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

REPOS=(
  "$ROOT_DIR"
  "$ROOT_DIR/paid-media-buyer-pro"
  "$ROOT_DIR/labstudio-fit"
  "$ROOT_DIR/second-brain"
  "$ROOT_DIR/JSW"
)

ok=0
skipped=0
failed=0

for repo in "${REPOS[@]}"; do
  if [[ ! -d "$repo/.git" ]]; then
    echo "[skip] not a git repo: $repo"
    skipped=$((skipped+1))
    continue
  fi

  echo "\n== Repo: $repo =="

  # Ensure we can talk to remote; avoid hanging forever.
  git -C "$repo" remote -v || true

  # Determine branch + upstream situation.
  branch=$(git -C "$repo" rev-parse --abbrev-ref HEAD || echo "")
  if [[ "$branch" == "HEAD" || -z "$branch" ]]; then
    echo "[skip] detached HEAD (not safe to auto-pull/push): $repo"
    skipped=$((skipped+1))
    continue
  fi

  # Pull first to minimize push conflicts.
  # If upstream is missing, fall back to pulling from origin/<branch>.
  if git -C "$repo" rev-parse --abbrev-ref --symbolic-full-name @{u} >/dev/null 2>&1; then
    if ! git -C "$repo" pull --rebase --autostash; then
      echo "[fail] pull --rebase failed (leaving repo untouched): $repo"
      failed=$((failed+1))
      continue
    fi
  else
    if ! git -C "$repo" pull --rebase --autostash origin "$branch"; then
      echo "[fail] pull --rebase (no upstream; tried origin/$branch) failed: $repo"
      failed=$((failed+1))
      continue
    fi
  fi

  if [[ -z "$(git -C "$repo" status --porcelain)" ]]; then
    echo "[ok] clean"
    ok=$((ok+1))
    continue
  fi

  git -C "$repo" add -A

  # If add didn't change anything (rare), skip.
  if [[ -z "$(git -C "$repo" diff --cached --name-only)" ]]; then
    echo "[ok] nothing staged"
    ok=$((ok+1))
    continue
  fi

  # Commit message is intentionally consistent for easy searching.
  git -C "$repo" commit -m "chore(backup): auto-sync $TS_UTC" --no-gpg-sign || true

  # Push (uses repo's configured upstream). If upstream is missing, set it.
  if git -C "$repo" rev-parse --abbrev-ref --symbolic-full-name @{u} >/dev/null 2>&1; then
    if ! git -C "$repo" push; then
      echo "[fail] push failed: $repo"
      failed=$((failed+1))
      continue
    fi
  else
    if ! git -C "$repo" push -u origin HEAD; then
      echo "[fail] push -u origin HEAD failed: $repo"
      failed=$((failed+1))
      continue
    fi
  fi

  echo "[ok] committed + pushed"
  ok=$((ok+1))
done

echo "\nSummary: ok=$ok skipped=$skipped failed=$failed"
[[ "$failed" -eq 0 ]]

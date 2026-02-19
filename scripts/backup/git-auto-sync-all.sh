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
)

# Also include sibling repos under ~/repos (if present).
if [[ -d "$HOME/repos" ]]; then
  while IFS= read -r d; do
    REPOS+=("$d")
  done < <(find "$HOME/repos" -maxdepth 3 -type d -name .git -print 2>/dev/null | sed 's#/.git$##' | sort -u)
fi

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

  # Skip detached HEAD to avoid clobbering or forcing history.
  branch="$(git -C "$repo" symbolic-ref --quiet --short HEAD || true)"
  if [[ -z "$branch" ]]; then
    echo "[skip] detached HEAD: $repo"
    skipped=$((skipped+1))
    continue
  fi

  upstream="$(git -C "$repo" rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || true)"

  # Pull first to minimize push conflicts.
  if [[ -n "$upstream" ]]; then
    if ! git -C "$repo" pull --rebase --autostash; then
      echo "[fail] pull --rebase failed (leaving repo untouched): $repo"
      failed=$((failed+1))
      continue
    fi
  else
    # No upstream set. Try pulling from origin/<branch> if it exists.
    git -C "$repo" fetch origin --prune || true
    if git -C "$repo" show-ref --verify --quiet "refs/remotes/origin/$branch"; then
      if ! git -C "$repo" pull --rebase --autostash origin "$branch"; then
        echo "[fail] pull --rebase origin/$branch failed (leaving repo untouched): $repo"
        failed=$((failed+1))
        continue
      fi
    else
      echo "[warn] no upstream and origin/$branch not found; skipping pull: $repo"
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

  # Push (ensure upstream exists; create it if missing).
  if [[ -z "$upstream" ]]; then
    # Set upstream to origin/<branch> if possible; otherwise create it by pushing.
    if git -C "$repo" show-ref --verify --quiet "refs/remotes/origin/$branch"; then
      git -C "$repo" branch --set-upstream-to="origin/$branch" "$branch" >/dev/null 2>&1 || true
      upstream="$(git -C "$repo" rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || true)"
    fi
  fi

  if [[ -z "$upstream" ]]; then
    if ! git -C "$repo" push -u origin HEAD; then
      echo "[fail] push -u origin HEAD failed: $repo"
      failed=$((failed+1))
      continue
    fi
  else
    if ! git -C "$repo" push; then
      echo "[fail] push failed: $repo"
      failed=$((failed+1))
      continue
    fi
  fi

  echo "[ok] committed + pushed"
  ok=$((ok+1))
done

echo "\nSummary: ok=$ok skipped=$skipped failed=$failed"
[[ "$failed" -eq 0 ]]

#!/usr/bin/env bash
set -euo pipefail

# Creates a compressed backup bundle of OpenClaw "database-ish" state
# and uploads it to Google Drive (richducat@gmail.com), into the existing
# "Project File Backups" folder.

ACCOUNT="richducat@gmail.com"
# Google Drive folder id: "Project File Backups" (discovered via search)
PARENT_FOLDER_ID="1lpCE-GMPVoChB3qqTBvLAVB9ekAnmMs3"

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
STATE_DIR="/Users/richardducat/.openclaw"

TS_LOCAL=$(date +"%Y-%m-%d_%H%M%S")
NAME="openclaw-backup_${TS_LOCAL}.tar.gz"
OUT_DIR="$ROOT_DIR/tmp/backups"
OUT_PATH="$OUT_DIR/$NAME"

mkdir -p "$OUT_DIR"

# What we include (keep it tight; avoid huge logs):
# - workspace memory/ (operational state + tokens)
# - OpenClaw memory search index sqlite(s)
# - gateway config

TAR_INPUTS=(
  "$ROOT_DIR/memory"
  "$STATE_DIR/openclaw.json"
  "$STATE_DIR/memory"
)

# Filter: exclude bulky temp sqlite artifacts.
# NOTE: GNU tar flags differ; macOS bsdtar supports --exclude.

tar -czf "$OUT_PATH" \
  --exclude='*.tmp-*' \
  --exclude='**/.DS_Store' \
  "${TAR_INPUTS[@]}"

# Upload to Drive
cd "$ROOT_DIR"

echo "Uploading $OUT_PATH to Drive folder $PARENT_FOLDER_ID (account=$ACCOUNT)"
gog drive upload "$OUT_PATH" --account "$ACCOUNT" --parent "$PARENT_FOLDER_ID" --name "$NAME" --no-input

echo "✅ Drive backup uploaded: $NAME"

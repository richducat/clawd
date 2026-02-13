#!/usr/bin/env bash
set -euo pipefail

# Creates a compressed backup bundle of OpenClaw state and places it into the
# local Google Drive sync folder (so it uploads via Drive Desktop).

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
STATE_DIR="/Users/richardducat/.openclaw"

DRIVE_ROOT="$HOME/Library/CloudStorage/GoogleDrive-richducat@gmail.com/My Drive"
DEST_DIR="$DRIVE_ROOT/OpenClaw Backups"

TS_LOCAL=$(date +"%Y-%m-%d_%H%M%S")
NAME="openclaw-backup_${TS_LOCAL}.tar.gz"
OUT_TMP_DIR="$ROOT_DIR/tmp/backups"
OUT_TMP_PATH="$OUT_TMP_DIR/$NAME"

mkdir -p "$OUT_TMP_DIR" "$DEST_DIR"

TAR_INPUTS=(
  "$ROOT_DIR/memory"
  "$STATE_DIR/openclaw.json"
  "$STATE_DIR/memory"
)

tar -czf "$OUT_TMP_PATH" \
  --exclude='*.tmp-*' \
  --exclude='**/.DS_Store' \
  "${TAR_INPUTS[@]}"

cp -f "$OUT_TMP_PATH" "$DEST_DIR/$NAME"

echo "✅ Local Drive sync copy created: $DEST_DIR/$NAME"

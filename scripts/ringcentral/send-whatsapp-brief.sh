#!/usr/bin/env bash
set -euo pipefail

# Sends RingCentral brief to a WhatsApp number using wacli.
#
# Env:
#   WHATSAPP_TARGET_PHONE (e.g. +17727660559)
#   (RingCentral env vars consumed by the node script)

# Load workspace env vars (RingCentral + target phone)
if [[ -f .env.local ]]; then
  # shellcheck disable=SC2046
  export $(grep -v '^#' .env.local | grep -E '^[A-Z0-9_]+=' | xargs) || true
fi

TARGET="${WHATSAPP_TARGET_PHONE:-}"
if [[ -z "$TARGET" ]]; then
  echo "Missing WHATSAPP_TARGET_PHONE" >&2
  exit 1
fi

BRIEF=$(node scripts/ringcentral/morning-brief.mjs --hours 24)

echo "$BRIEF" | wacli send text --to "$TARGET" --message -

echo "Sent RingCentral brief to $TARGET" >&2

#!/usr/bin/env bash
set -euo pipefail

# Safe OpenClaw update wrapper.
# Purpose: update OpenClaw, then auto-heal common post-update gateway auth issues
# (e.g., "device token mismatch") and verify reachability.

log() { printf "[%s] %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

log "Starting OpenClaw safe update..."

if ! command -v openclaw >/dev/null 2>&1; then
  log "ERROR: openclaw not found in PATH"
  exit 1
fi

# Run update
log "Running: openclaw update"
openclaw update

# Restart gateway service (best-effort)
log "Restarting gateway"
openclaw gateway restart --force || true

# Probe reachability
log "Probing gateway"
if openclaw gateway probe >/dev/null 2>&1; then
  log "Gateway probe: OK"
  exit 0
fi

# If probe failed, attempt device token rotation for the local operator role.
# This updates local device-auth + server side for this device.
log "Gateway probe failed; attempting device token rotate for local operator"

# Extract local device id
STATE_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}"
DEVICE_AUTH="$STATE_DIR/identity/device-auth.json"
if [[ ! -f "$DEVICE_AUTH" ]]; then
  log "ERROR: device-auth.json not found at $DEVICE_AUTH"
  exit 1
fi

DEVICE_ID=$(python3 - <<'PY'
import json,sys
p=sys.argv[1]
print(json.load(open(p))['deviceId'])
PY
"$DEVICE_AUTH")

# Rotate operator token for just this device.
openclaw devices rotate --device "$DEVICE_ID" --role operator >/dev/null 2>&1 || true

# Restart and probe again
log "Restarting gateway again"
openclaw gateway restart --force || true

log "Re-probing gateway"
if openclaw gateway probe >/dev/null 2>&1; then
  log "Gateway probe: OK after rotate"
  exit 0
fi

log "ERROR: Gateway still unreachable after rotate. Run: openclaw status --all"
exit 2

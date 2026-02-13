# PR Draft — Make TYFYS Daily Sales Ops Brief REP-safe + testable (2026-02-02)

## Title
feat: add redact mode + no-credentials selftest to daily sales ops brief

## Summary
Improves `scripts/tyfys/daily-sales-ops-brief.mjs` so it can be safely pasted into group chats and quickly validated without credentials:
- `--redact` now masks *all* RingCentral contact identifiers (won’t leak non-numeric names like “John Smith” if RC omits phone numbers).
- Adds `--selftest` to run a small sanity-check for the redaction helpers without hitting RingCentral/Zoho.
- Removes unused RingCentral env var wiring from this script (RC auth/refresh remains handled in `scripts/lib/ringcentral.mjs`).

## Files changed
- `scripts/tyfys/daily-sales-ops-brief.mjs`

## How to test (local)
1) Run the no-credentials selftest:
   - `node scripts/tyfys/daily-sales-ops-brief.mjs --selftest`
   - Expect: `Selftest OK`

2) (Optional, with your normal env vars) Run the brief with redaction:
   - `node scripts/tyfys/daily-sales-ops-brief.mjs --hours 24 --connectedSec 30 --fewMin 2 --redact`

3) Confirm:
   - Phone numbers render as `***-***-1234`.
   - If RC payload has only a contact name (no digits), it renders as `Unknown` in redact mode.
   - Deal and Event titles render as stable `Deal#<suffix>` / `Event#<suffix>` identifiers.
   - Header shows `| REDACTED`.

## Risk assessment
- Low risk. Changes are isolated to output formatting + an optional `--selftest` fast-exit path.
- No changes to RingCentral/Zoho API endpoints, filtering logic, or thresholds.

## Rollback plan
- Revert commits `fdd6155` and/or `a4fa118` to restore prior output behavior.

# PR Draft — TYFYS: Deal File Health “At-Risk” Flags + Redaction

## Summary
This PR upgrades the `deal-file-health` scanner to make it more actionable day-to-day:
- Adds an **at-risk classifier** (overdue tasks, missing attachments in handoff stages, stale notes/attachments, too many open tasks)
- Adds a **--redact** mode so output is safe to paste into non-private channels
- Adds **--onlyAtRisk** to print just the problem deals
- Adds a **--selftest** mode that runs without any API credentials

## Branch
`chore/2026-02-02-deal-health-risk`

## Commit(s)
- `707c199` — `chore(tyfys): add at-risk flags + redaction to deal file health`

## Files changed
- `scripts/tyfys/deal-file-health.mjs`

## How to test (tomorrow)
1) No-credentials selftest:
   - `node scripts/tyfys/deal-file-health.mjs --selftest`
   - Expect: `Selftest OK`

2) Normal run (requires existing Zoho env vars):
   - `node scripts/tyfys/deal-file-health.mjs --hours 168 --limit 40`

3) At-risk only:
   - `node scripts/tyfys/deal-file-health.mjs --hours 168 --limit 80 --onlyAtRisk`

4) Redacted output (safe to share):
   - `node scripts/tyfys/deal-file-health.mjs --hours 168 --limit 80 --onlyAtRisk --redact`
   - Confirm deal names are masked like `Deal#123ABC` and provider names are `REDACTED`.

## Risk assessment
Low.
- Read-only reporting tool (no writes to Zoho)
- Default output is backwards-compatible-ish (adds `flags=...` at end of each line)

## Rollback plan
Revert commit `707c199`.

## Notes
Current risk flags:
- `OVERDUE_TASKS`
- `MANY_OPEN_TASKS` (≥6 open)
- `NO_ATTACHMENTS` (for stages `Ready for Provider` / `Sent to Provider`)
- `STALE_NOTE_<Nd>` / `STALE_ATTACH_<Nd>` (default 7 days, configurable via `--staleDays`)

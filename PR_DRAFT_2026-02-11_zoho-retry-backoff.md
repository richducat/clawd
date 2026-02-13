# PR Draft — 2026-02-11 — Zoho CRM retry/backoff for transient failures

## A) What I shipped (one tangible improvement)
Added a centralized HTTP retry + exponential backoff wrapper for Zoho API calls so TYFYS ops scripts are more resilient to:
- throttling (429)
- transient gateway errors (502/503/504)
- timeouts (408)
- intermittent network/socket errors

This reduces “random nightly failures” and prevents half-finished runs for scripts like `fulfillment-tasker`, `provider-handoff-tasker`, `sms-autopilot`, etc.

## B) Why this is the highest-priority thing
These scripts directly drive throughput/revenue (keeping deals moving + ensuring tasks/SMS ops happen). When Zoho flakes, runs fail and you lose momentum.

This is PR-sized, low-risk, and immediately testable.

## C) Exactly what changed
- `scripts/lib/zoho.mjs`
  - New helper `zohoFetchJson()` that retries retryable HTTP statuses with exponential backoff + jitter.
  - Plumbed through to `zohoCrmCoql`, `zohoCrmGet`, `zohoCrmPost`, `zohoCrmPut`, and `zohoBookingsReportGet`.
  - Optional env knobs:
    - `ZOHO_HTTP_MAX_RETRIES` (default 4)
    - `ZOHO_HTTP_RETRY_BASE_MS` (default 500)

Branch: `chore/2026-02-11-zoho-retry-backoff`
Commit: `cd92d61`

## D) How to test (tomorrow)
1) Sanity check (syntax):
   - `node --check scripts/lib/zoho.mjs`
2) Run any Zoho-backed script you already rely on (example):
   - `node scripts/tyfys/fulfillment-tasker.mjs --sinceDays 2 --limit 50 --dry-run`
   - or `node scripts/tyfys/provider-handoff-tasker.mjs --sinceDays 2 --limit 50 --dry-run`

If Zoho returns a transient error, you’ll now see stderr lines like:
- `Zoho HTTP retry attempt=1/4 status=429 delayMs=...`

## E) Risk, security, rollback
- Security: no client PII/PHI changes; only request plumbing + generic retry logs (status/delay). No payload logging.
- Risk: minimal. Worst case: a script waits a few seconds longer before failing.
- Rollback: revert commit `cd92d61`.

# PR Draft — TYFYS: Ops risk flags in daily brief + shared deal file health lib

**Branch:** `feat/2026-02-02-ops-risk-brief`

## Summary
This PR adds an **ops-focused “risk flags” section** to the TYFYS Daily Sales + Ops Brief, powered by a newly-extracted shared library for scanning **Zoho Deal “file health”** (tasks/notes/attachments).

Key outcomes:
- Daily brief can now optionally include a short **At-risk deals** list (`--opsRisk`) so ops issues are surfaced in the same message as sales activity.
- The deal health logic was extracted into a reusable module (`scripts/tyfys/lib/deal-file-health-lib.mjs`) so multiple scripts can share the same scanner + formatting.
- Both scripts support **credential-free selftests** (`--selftest`).

## Files changed
- `scripts/tyfys/daily-sales-ops-brief.mjs`
- `scripts/tyfys/deal-file-health.mjs`
- `scripts/tyfys/lib/deal-file-health-lib.mjs` (new)

## How to test (local)
1) **Run selftests (no credentials required):**
   - `node scripts/tyfys/deal-file-health.mjs --selftest`
   - `node scripts/tyfys/daily-sales-ops-brief.mjs --selftest`
   - Expect: `Selftest OK` for both.

2) **Run deal health scan (requires Zoho env):**
   - `node scripts/tyfys/deal-file-health.mjs --hours 168 --limit 40 --onlyAtRisk`
   - Optional safe-to-share output:
     - `node scripts/tyfys/deal-file-health.mjs --hours 168 --limit 40 --onlyAtRisk --redact`

3) **Run the daily brief with ops risk section (requires Zoho + RingCentral env):**
   - `node scripts/tyfys/daily-sales-ops-brief.mjs --hours 24 --connectedSec 30 --fewMin 2 --opsRisk`
   - Optional safe-to-share:
     - `node scripts/tyfys/daily-sales-ops-brief.mjs --hours 24 --connectedSec 30 --fewMin 2 --opsRisk --redact`

## Risk assessment
- **Low risk.** Read-only reporting; no writes to Zoho/RingCentral.
- `--redact` reduces accidental PII leakage when sharing output.

## Rollback plan
- Revert commit `db8a7c2` or remove the `--opsRisk` section and/or the new lib file.

# PR Draft — 2026-02-10 — Fulfillment Tasker: stage-aware Provider requirement

## A) Deliverable
Adjusted `scripts/tyfys/fulfillment-tasker.mjs` so it **does not require the “Provider” field on early-stage deals**, reducing noisy/unsatisfiable “fill required fields” tasks.

Key changes:
- Added **stage/appointment-aware Provider requirement** (`shouldRequireProvider()`):
  - Provider required if Stage contains “provider”, or Appointment Status looks scheduled/confirmed/completed/etc.
  - Otherwise Provider is treated as *not required yet*.
- Updated task Description text to reflect the conditional Provider rule.
- Added CLI knobs:
  - `--sinceDays <n>` (default 14)
  - `--limit <n>` (default 200; capped at 200 for COQL safety)
- Improved output summary:
  - prints created task list (up to 25) + counts for `skipped_already_created`

Branch: `chore/2026-02-10-fulfillment-tasker-stage-rules`

## B) Why this matters (impact)
This script is meant to remove you from the fulfillment loop by creating actionable tasks for Devin/Karen. When Provider is required too early, it can:
- generate tasks that cannot be completed yet,
- create alert fatigue,
- reduce trust in the automation.

This change keeps the “top fields” discipline while making Provider enforcement match real workflow timing.

## C) How to test (tomorrow)
1) Dry run:
   - `node scripts/tyfys/fulfillment-tasker.mjs --dry-run`

2) Narrow scan window (faster + easier to inspect):
   - `node scripts/tyfys/fulfillment-tasker.mjs --dry-run --sinceDays 3 --limit 200`

3) Sanity check behavior:
   - Confirm deals in **early stages** (no provider stage / not scheduled) generate tasks *without* “Provider” in the missing list.
   - Confirm deals in **provider-related stages** or **scheduled appointment statuses** still require Provider.

## D) Risk / rollback
Risk is low and contained to one script.
- If the regex is too permissive/restrictive, it only affects whether Provider shows up in the missing list.

Rollback: revert commit `ffe7889` on this branch.

## E) Next best follow-ups (optional)
- Add a small allowlist of exact Appointment Status picklist values once we confirm the org’s canonical statuses (reduces regex guesswork).
- Add a “per-owner summary” section so Devin vs Karen workload is obvious at a glance.

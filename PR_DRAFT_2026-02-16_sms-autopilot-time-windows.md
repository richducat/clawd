# PR: TYFYS SMS autopilot — configurable time windows + 20:30 PT fix

## A) Goal
Make `scripts/tyfys/sms-autopilot.mjs` safer + more predictable by:
- Removing “magic” hard-coded PT windows (quiet hours + send windows)
- Fixing the evening window bug where the comment said **20:30 PT** but the code stopped at **19:59 PT**
- Adding a small, local test so we can lock the time-window behavior down

## B) What changed (PR-sized)
- **Configurable time windows via CLI flags** (defaults preserve prior behavior, except evening now correctly runs until 20:30):
  - `--tz` (default `America/Los_Angeles`)
  - `--quietStart` (default `21:00`)
  - `--quietEnd` (default `08:00`)
  - `--morningWindow` (default `09:00-12:00`)
  - `--eveningWindow` (default `16:00-20:30`)
  - `--nowIso` override for deterministic scheduling checks (useful for dry-run debugging)
- Refactored the time-window math to be **minute-accurate** and handle **midnight wrap** correctly.
- Added `node:test` coverage for the boundary cases:
  - evening includes **20:29 PT**, excludes **20:30 PT**
  - quiet hours wrap midnight (**21:00–08:00 PT**)
- Made the script import-safe (won’t auto-execute when imported by tests).

## C) How to test (tomorrow)
From repo root:

1) Run the time-window unit tests:
```bash
node --test scripts/tyfys/sms-autopilot.timewindows.test.mjs
```

2) Optional: sanity-check the scheduling logic at a specific time (still hits Zoho/RC/doc export unless you stub env; safest is `--dry-run`):
```bash
node scripts/tyfys/sms-autopilot.mjs --dry-run --mode schedule --nowIso 2026-02-17T04:29:00.000Z
```

## D) Risks / notes
- Behavioral change: evening window now correctly runs until **20:30 PT** (previously it effectively ended at 20:00 due to hour-only logic).
- Defaults are set to match the original intent (PT-based), but now you can safely adjust without editing code.
- No changes to message content, Zoho queries, or RingCentral send semantics.

## E) Meta
- Branch: `chore/2026-02-16-sms-autopilot-time-windows`
- Commit: `eda11ab` (local)
- Diff: `2 files changed, 131 insertions(+), 33 deletions(-)`

# Context Anchor — 2026-02-17 00:22 ET

## Quick internal summary (inputs)
- `memory/goals-master.md`: **missing** (ENOENT). Confirmed: no file named `goals-master.md` in `/Users/richardducat/clawd/memory/`.
- `memory/2026-02-16.md`: TYFYS SMS autopilot scheduling improvements (time windows).
  - Fixed bug: evening window claimed it ran until **20:30 PT**, but code only checked hours and stopped before 20:00.
  - Quiet hours + morning/evening windows now configurable via CLI flags (defaults remain PT-based):
    - `--tz` (default `America/Los_Angeles`)
    - `--quietStart` / `--quietEnd`
    - `--morningWindow` / `--eveningWindow` (default evening ends 20:30)
    - `--nowIso` for deterministic window debugging
  - Added boundary tests (`node:test`): `scripts/tyfys/sms-autopilot.timewindows.test.mjs`
  - Branch: `chore/2026-02-16-sms-autopilot-time-windows` @ `eda11ab`
- `MEMORY.md` (skim — operating rules / non-negotiables):
  - Draft-first for all outbound comms until explicitly approved to send; **do not email Karen back**.
  - Prefer PRs; don’t push live/production; Richard tests/commits.
  - Avoid friction: decide when ≥70% sure; ask only for safety/irreversible/costly uncertainty.
  - LabStudio: **no mock data** in user-visible UI.
  - Dual MacBooks: one LaunchAgent per Mac; don’t copy/sync `~/.openclaw*`.

## Top 10 commitments (keep steady)
1) Be proactive: keep Richard organized; take work off his plate.
2) Draft-first for **all** outbound comms until explicitly approved to send.
3) Special rule: **do not email Karen back** (draft-only if needed).
4) Prefer PR-sized changes; do not push live/production.
5) Avoid friction: if ≥70% sure, decide + proceed; ask only when needed.
6) LabStudio: no mock data in user-visible UI (DB/integration-backed only).
7) Deploy hygiene: watch Vercel author identity pitfalls; use runbooks.
8) Dual-Mac OpenClaw: one gateway LaunchAgent per Mac; never sync/copy `~/.openclaw*`.
9) Always write the next-day plan into daily memory to prevent context loss.
10) If something breaks: log it, queue the fix, execute in next work block (no surprise actions).

## Today’s non-negotiables
- Courts/school: stay current (daily scans + draft-only replies as needed).
- Backups: hourly git auto-sync + nightly OpenClaw state bundle (Drive + local sync).
- RC updates: morning RC posts + inbound/outbound SMS automations healthy; capture any token/tenant changes.

## Active workstreams + next actions
### TYFYS — SMS autopilot time windows
- Status: branch + commit created; tests added.
- Next actions:
  - Run: `node --test scripts/tyfys/sms-autopilot.timewindows.test.mjs`
  - Open PR for Richard to review.
  - If approved, merge via Richard’s normal flow.

### RingCentral housekeeping
- Observed: `memory/ringcentral-token.new.json` exists alongside `memory/ringcentral-token.json`.
- Next actions:
  - Determine why there are two token files (migration? new tenant?) and which should be canonical.
  - Confirm RC automations reference the intended token stores/state files.

### Context / goals master file
- Issue: `memory/goals-master.md` is referenced by automations (e.g., “Daily goals + deadlines post (PRIVATE)”) but missing.
- Next actions:
  - Search repo git history / other folders for a prior goals master.
  - If truly absent: create `memory/goals-master.md` with current goals/commitments + deadlines.

## Cron health (last 24h) — errors
Detected via `cron list`:
- **ERROR (recent):** `LabStudio deploy: shop-on-prod-baseline once Vercel quota resets` (jobId `e69a0b5d-fb54-4b65-ac83-4aad62d55e60`) — `lastError: "Unsupported channel: whatsapp"`.
  - This job’s `delivery` is `mode: announce` with no explicit `channel/to`.

## Detected breakages + the fix to apply next (queued)
1) **Fix: “Unsupported channel: whatsapp” delivery path**
   - Hypothesis: when `delivery.channel` is omitted, delivery resolves to a default/stale channel (whatsapp) somewhere in config/plugin routing.
   - Next steps (smallest safe):
     - Patch the failing job(s) to explicitly set `delivery.channel="telegram"` and `delivery.to` (or set `delivery.mode="none"` if it should be silent).
     - Re-run the deploy job manually after fixing delivery routing.

2) **Fix: missing `memory/goals-master.md`**
   - Create the file (or rename + update references) so goal/deadline automations have a stable source of truth.

# Context Anchor (internal)

Updated: 2026-02-19 (Thu) — ~07:02 ET

## Internal summary (quick)
- **Operating rules (skim from MEMORY.md):** draft-first for all outbound; **never email Karen directly**; avoid friction; keep changes PR-sized; LabStudio UI must be real-data-backed (no mock data).
- **Missing source files (job expects them):** `memory/goals-master.md` and `memory/2026-02-16.md` are referenced but do **not** exist in `/Users/richardducat/clawd/memory/` as of this run.

## Top 10 commitments (keep stable)
1) **Kids-first logistics**: courts/school comms watched and acted on promptly.
2) **Courts email monitoring** (keywords: clerk of courts, brevard court 18, magistrate 32940) — no misses.
3) **School monitoring** (Quest/IEP/SLP/SIS/Focus) — no misses.
4) **Backups**: hourly git auto-sync + nightly OpenClaw state bundle backups must keep succeeding.
5) **TYFYS morning RingCentral posts**: morning update + lead buckets + KPI scoreboard must be reliable + rep-safe.
6) **TYFYS SMS automations**: keep RC tokens healthy; obey inbound-only rules; avoid spamming; respect throttles.
7) **TYFYS client processing visibility**: stage 1–3 status updates to Devin group (morning + evening).
8) **LabStudio build blocks (11am/2pm/5pm weekdays)**: ship small, real-data member flows; PR-based; **no prod deploy without explicit approval**.
9) **Drift control**: keep automation changes from living only in chat/UI—record them in anchor notes.
10) **OpenClaw dual-Mac stability**: don’t copy `~/.openclaw*` between machines; one LaunchAgent per Mac; office uses `--profile office` + `gateway.mode=local`.

## Today’s non-negotiables (courts/school + backups + RC updates)
- **Courts/School**
  - Ops scan: 06:15 ET (daily)
  - Email Watch (courts+schools): **07:30 ET** and **16:40 ET**
- **Backups**
  - Hourly: `scripts/backup/git-auto-sync-all.sh` at **:05** every hour
  - Nightly OpenClaw bundles: **02:30 ET** (Drive upload) + **02:40 ET** (local Drive sync)
- **RingCentral updates (Sales Team)**
  - 08:30 ET weekday: Morning Sales Team RC update
  - 08:32 ET weekday: Lead buckets
  - 08:35 ET weekday: KPI scoreboard
  - 08:40 ET weekday: DriftGuard verification (dry-run sanity checks)

## Active workstreams + next actions
### TYFYS — automations + ops reliability
- Next actions:
  - If RC `invalid_grant`: refresh tokens via `node scripts/tyfys/ringcentral-oauth-refresh-token-per-user.mjs --tenant new --user <adam|amy|devin|jared|richard>`.
  - Keep Devin-group status updates (stages 1–3) concise and actionable.

### LabStudio — member-usable flows (real data only)
- Next actions:
  - Continue from latest open PR/branch during next build block; prioritize the next end-to-end flow (cafe/booking/shop/cart/checkout) **without mock UI**.

### PersonaPlex — disk exhaustion
- Next actions:
  - Increase pod disk to 40–60GB OR set HF cache to a larger mount (`HF_HOME`, `HF_HUB_CACHE`) and restart the server.

## Cron health (quick)
- **Enabled jobs with lastStatus=error in last 24h:** none detected.
- **Note (non-impacting):** some **disabled** one-shot jobs show historical errors (e.g., “Unsupported channel: whatsapp”).

## Detected breakages + queued fix (do not execute now)
1) **Breakage:** `memory/goals-master.md` missing.
   - Impact: the daily goals/deadlines post + this anchor can’t reference canonical goals.
   - Queued fix: locate the canonical goals source (may be elsewhere in repo or in second-brain) and either (a) restore `memory/goals-master.md` or (b) update the cron jobs to point at the correct file.
2) **Breakage:** `memory/2026-02-16.md` missing.
   - Impact: continuity gap for Feb 16; referenced by this anchor.
   - Queued fix: reconstruct a placeholder from `git log` (Feb 16) + any PR_DRAFT_* artifacts + cron run history, then backfill key decisions.

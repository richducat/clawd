# Context Anchor (internal)

Last updated: 2026-02-19 17:42 ET

## Source reads (internal summary)
- ⚠️ Missing files (still not found in `/Users/richardducat/clawd/memory/`):
  - `/Users/richardducat/clawd/memory/goals-master.md`
  - `/Users/richardducat/clawd/memory/2026-02-16.md`
  - Verified via `ls` + `find` (no matches). This anchor is running “blind” on goals/daily plan until fixed.
- MEMORY.md skim (operating rules / non-negotiables):
  - Draft-first for *all* outbound emails until explicitly approved to send.
  - **Do not email Karen back** automatically (draft-only; no sending without explicit approval).
  - Be proactive + low-friction: if ≥70% sure and safe/reversible, decide and proceed.
  - For code/work: PR-sized changes; do not push live; Richard tests/commits.
  - LabStudio: **NO mock data** in user-visible UI (must be real DB/integration-backed).
  - OpenClaw dual-Mac rules: one LaunchAgent per Mac; don’t copy `~/.openclaw*`; office uses `--profile office`.
- Recent daily memory:
  - 2026-02-19: LabStudio work continued on branch `feat/2026-02-19-labstudio-flows` (PR #4); commit `f960745`; `pnpm build` succeeded.

## Top 10 commitments (current operating commitments)
1) Draft-first for outbound comms; never send without explicit approval.
2) Never email Karen back automatically (draft-only; wait for approval).
3) Ship one tangible, testable deliverable (PR-sized) on a steady cadence.
4) LabStudio: real DB/integration-backed UI only (no mock data in UI).
5) TYFYS: protect privacy (no client PII/PHI leakage; rep-safe where required).
6) Keep RingCentral automations healthy (morning posts + verification + ops brief).
7) Keep backup jobs healthy (hourly git autosync; nightly OpenClaw state backups).
8) Maintain change-control: decisions shouldn’t live only in chat—anchor in memory files.
9) Avoid drift collisions: detect/disable duplicates; minimize overlapping automations.
10) Keep dual-Mac OpenClaw separation stable (office brain vs travel cockpit).

## Today’s non-negotiables (courts/school + backups + RC updates)
- Courts/school watch:
  - 7:30am ET email watch (courts + schools) (cron: `0a9c010d-...`) ✅
  - 4:30pm ET email watch (courts + schools) (cron: `f110cf0a-...`) ✅
  - Rule: draft-only replies.
- Backups:
  - Hourly git auto-sync (cron: `d43e5f81-...`) ✅
  - Nightly OpenClaw state bundle → Drive (cron: `188a18be-...`) ✅
  - Nightly OpenClaw state bundle → local Drive sync (cron: `854bc3fc-...`) ✅
- RingCentral updates:
  - Weekday AM: Morning Sales Team RC update (cron: `cf636099-...`) ✅
  - Weekday AM: Lead buckets (cron: `bd09ab42-...`) ✅
  - Weekday AM: KPI scoreboard (cron: `728172ee-...`) ✅
  - Weekday AM: Verification (cron: `b925e5db-...`) ✅
  - Weekday 4pm: Day Cap RC update (cron: `08f00dea-...`) ✅
  - Mon–Sat 6pm: TYFYS Ops Brief reminder (cron: `9c83a94e-...`) ✅

## Active workstreams + next actions
### 1) Anchoring / drift prevention
- Next action (queued): restore the two missing anchor inputs so “daily goals/deadlines” + “daily plan” jobs have a canonical source.
  - Create `memory/goals-master.md` with current goals + deadlines.
  - Create `memory/2026-02-16.md` (retro-summary: decisions + what shipped + next-day plan) OR adjust this anchor + any jobs to point to the actual canonical file(s) if naming changed.

### 2) LabStudio
- Current: PR #4 ongoing; branch `feat/2026-02-19-labstudio-flows`; build passes.
- Next action: continue member-usable end-to-end flows (cafe + booking + shop/cart/checkout) with real data paths; keep PR-sized.
- Guardrail: do not deploy to prod without explicit approval.

### 3) TYFYS automations (RingCentral + Zoho)
- Next action: watch the inbound SMS auto-reply scanner reliability (see breakages below).
- Continue normal ops: inbound forward-to-owner, waiting-room check-in, provider replies watch.

### 4) DriftGuard / hygiene
- Next action: capture any UI-only automation edits (preflight expects this) into this file.

## Cron health (quick)
- Enabled jobs with `lastStatus=error` in the most recent run (approx last 24h window):
  - `786870c7-a69b-426c-bd29-3dad3f438003` — “TYFYS inbound SMS auto-reply scanner (Sales team)” — `lastError`: `Error: cron: job execution timed out`.
- Disabled one-shots with historical errors (not urgent): multiple “Cool Cat” Telegram-topic one-shots failed with `Unsupported channel: whatsapp`.

## Detected breakages + queued fix (do NOT apply now; next work block)
1) **Missing anchor inputs**: `goals-master.md` + `2026-02-16.md` do not exist.
   - Fix plan:
     - Create `memory/goals-master.md` (seed: top business goals + personal/courts/school non-negotiables + LabStudio/TYFYS priorities).
     - Create `memory/2026-02-16.md` (retro summary + decisions + next-day plan).
     - Then verify/adjust any cron payloads that read goals-master so they use the canonical path.
2) **Cron timeout: inbound SMS auto-reply scanner** (job `786870c7-...`).
   - Likely cause: script runtime > timeoutSeconds (1200s) or a hang in RingCentral/Zoho paging.
   - Fix plan:
     - Reproduce manually with timing logs and smaller window (e.g., lookback limit / paging cap).
     - Either optimize (pagination limits, caching, early exits) or increase cron `timeoutSeconds` (e.g., 1800–2400) if safe.
     - Ensure summary-only output so runs remain predictable.
3) **(Low priority) Disabled “whatsapp” delivery defaults**: old jobs show `Unsupported channel: whatsapp` despite Telegram intent.
   - Fix plan: delete/ignore old one-shots; when creating future jobs, explicitly set delivery channel/target.

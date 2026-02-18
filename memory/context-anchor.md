# Context Anchor (internal)

Last updated: 2026-02-18 17:42 ET

## 1) Source reads (internal summary)
- ✅ Read: `/Users/richardducat/clawd/memory/goals-master.md`
  - Near-term priorities: LabStudio real DB-backed member flows; TYFYS stages 1–3 daily movement; automation reliability; courts/school; backups/change-control.
- ✅ Read: `/Users/richardducat/clawd/memory/2026-02-16.md`
  - Placeholder daily note (continuity repair). Reminder: keep daily files present + capture next actions.
- ✅ MEMORY.md skim (operating rules / non-negotiables):
  - **Draft-first for ALL outbound email** until explicit approval to send.
  - **Do not email Karen back** automatically (draft-only; require approval).
  - Autonomy + low-friction: if ≥70% sure and safe/reversible, decide and proceed.
  - Code: PR-sized; do not push live; Richard tests/commits.
  - LabStudio: **no mock data** in user-visible UI (DB/integration-backed; seeding OK if it writes to DB).
  - OpenClaw dual-Mac: one LaunchAgent per Mac; don’t copy `~/.openclaw*`; office uses `--profile office`.

## 2) Top 10 commitments (bullets)
1) Draft-first for outbound comms; never send without explicit approval.
2) Never email Karen back automatically (draft-only; wait for approval).
3) Ship tangible, testable deliverables (PR-sized; aim <400 lines net).
4) LabStudio UI must be real-data-backed (no mock data).
5) TYFYS privacy/rep-safety: avoid PII/PHI; no Stripe/private-financials in rep posts.
6) Keep RingCentral automations reliable (AM posts + verification + day-cap + ops brief).
7) Keep backups green (hourly git auto-sync; nightly OpenClaw state backups).
8) Change-control: decisions + automation edits must land in memory files, not just chat.
9) Avoid drift collisions: no duplicate cron commands / shared state-file collisions.
10) Keep OpenClaw office/travel separation stable (one gateway per Mac, correct profile usage).

## 3) Today’s non-negotiables (courts/school + backups + RC updates)
- Courts/school:
  - Email watch jobs must run; any replies are **draft-only**.
  - (Wednesdays) Berkeley speech weekly check-in: draft-only reply in-thread.
- Backups:
  - Hourly git auto-sync must stay green.
  - Nightly OpenClaw state backups (Drive + local sync) must stay green.
- RingCentral / TYFYS updates:
  - Morning RC: update + lead buckets + KPI scoreboard + verification must stay green.
  - Day-cap RC update (4pm weekdays) must stay green.

## 4) Active workstreams + next actions
### A) LabStudio (member-usable flows; no mock data)
- Next actions:
  - Continue incremental PR-sized improvements during scheduled build blocks.
  - Do not deploy to prod without explicit approval.

### B) TYFYS throughput (Zoho stages 1–3)
- Next actions:
  - Keep “missing intake notes / missing key attachments / overdue tasks” visibility tight.
  - Make sure stages 1–3 updates (Devin group) are actionable (top stuck + specific next step).

### C) TYFYS automation hygiene (RC + Zoho)
- Next actions:
  - Keep token health stable (Zoho + RingCentral). If `invalid_grant`, refresh via per-user oauth refresh script.
  - Fix outbound SMS autopilot runtime (see breakages).

### D) Continuity
- Next actions:
  - Ensure a `memory/YYYY-MM-DD.md` file exists daily and ends with “next actions”.

## 5) Cron health (jobs with lastStatus=error in last 24h)
- Enabled:
  - `0aa2a6d7-2921-43d7-9242-c7c75c75122d` — **TYFYS outbound SMS autopilot (Adam/Amy, NEW tenant)**: `Error: cron: job execution timed out`.

## 6) Detected breakages + the fix to apply next (queued)
1) **TYFYS outbound SMS autopilot timeout**
   - Likely causes: run doing too much work per invocation (lead paging + RC throttling), or inefficient Zoho queries.
   - Fix plan (next available work block):
     - Repro locally with smaller caps (`--leadLimit 40`) and measure runtime.
     - Add batching/cursor to state (`memory/tyfys-sms-autopilot.json`) so each cron run processes a bounded slice.
     - Add RC rate-limit backoff + hard cap on sends per run.
     - If needed: split into separate jobs per rep and/or narrower time window.
2) **“Unsupported channel: whatsapp” errors on old one-shot jobs (disabled)**
   - Not currently breaking (disabled), but indicates a configuration footgun.
   - Fix plan: for future one-shots, always set `delivery.channel: telegram` explicitly (or `delivery.mode: none` for internal-only runs).

## 7) Recent automation changes (24h)
- No new change-control items detected from the source files read in this anchor run; continue to record any cron/UI edits here as they occur.

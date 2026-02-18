# Context Anchor (INTERNAL)

Last updated: 2026-02-18 12:02 ET

## 1) Internal summaries (inputs)

### memory/goals-master.md
- **MISSING FILE** at `/Users/richardducat/clawd/memory/goals-master.md` (ENOENT).

### memory/2026-02-16.md
- **MISSING FILE** at `/Users/richardducat/clawd/memory/2026-02-16.md` (ENOENT).

### MEMORY.md (skim: operating rules + non-negotiables)
- Operate proactively; minimize friction; if ≥70% sure, decide and proceed.
- **Draft-first for all outbound** until explicitly approved to send.
- **Do not email Karen back** (draft-only rule).
- LabStudio: **no mock data** in user-visible UI.
- OpenClaw dual-Macbook rules: don’t sync `~/.openclaw*`; one LaunchAgent per Mac; office vs travel profiles.

## 2) Top 10 commitments (current)
1. Single-dad responsibilities: Everett (11) + Berkeley (5).
2. School: Berkeley’s speech services continuity; weekly check-in with SLP Danielle Ryba.
3. Courts: stay on top of clerk-of-courts / Brevard Court 18 / magistrate items (email watch).
4. **Backups**: hourly git auto-sync; nightly OpenClaw state backups (Drive + local sync).
5. TYFYS: keep RC sales-team updates posting reliably (AM posts + day-cap + lead buckets + KPI scoreboard).
6. TYFYS: inbound SMS automation (auto-reply + forward-to-owner) reliability; avoid spamming; token health.
7. TYFYS: provider pipeline hygiene (handoff tasker; fulfillment tasker; provider replies watch).
8. LabStudio: ship member-usable end-to-end flows; keep work PR-sized; do not deploy without approval.
9. Repo hygiene/drift control: audits, default branch sanity, PR aging.
10. Change-control: record automation/cron changes in anchor files so decisions don’t live only in chat.

## 3) Today’s non-negotiables (must not slip)
- **Courts + school monitoring**
  - Email watch jobs (7:30am + 4:40pm ET) are the safety net.
- **Backups**
  - Hourly `git-auto-sync-all` (cron at :05) must keep running.
  - Nightly OpenClaw state backups (2:30am + 2:40am) must keep running.
- **RingCentral (RC) updates**
  - Weekday AM series: 8:30 (morning update), 8:32 (lead buckets), 8:35 (KPI scoreboard), 8:40 (verification).
  - 4:00pm ET day-cap update.

## 4) Active workstreams + next actions

### A) Context + goals anchoring (THIS JOB)
- Next action: **recreate missing files or repoint jobs**.
  - Search for canonical goals doc location (maybe `second-brain/`, `docs/`, or renamed file).
  - If missing permanently: create new `memory/goals-master.md` and backfill from recent daily notes + MEMORY.md.
  - Ensure there is a `memory/2026-02-16.md` (if it existed, it may have been renamed); otherwise create a stub with recovered summary.

### B) Cron/automation reliability
- Next action: investigate and clean up **disabled jobs** that still show `lastStatus=error` due to `Unsupported channel: whatsapp` (Cool Cat test pings; LabStudio deploy one-shot).
  - Likely fix: ensure delivery channel is explicitly `telegram` for those jobs or remove/garbage-collect expired disabled one-shots to reduce noise.

### C) TYFYS ops
- Next action: keep an eye on token health (RingCentral `invalid_grant` playbook exists) and Zoho paging/zeros for lead-buckets.

### D) LabStudio
- Next action: continue build blocks on active PR/branch (no mock data; PR-sized commits; pnpm build).

## 5) Breakages detected + queued fix

### Breakage: missing anchor inputs
- `memory/goals-master.md` not found.
- `memory/2026-02-16.md` not found.

Queued fix (next work block):
1) `find` for alternate locations/filenames and update cron/job instructions accordingly.
2) If truly missing: create the files (stub + reconstructed content) and commit them.

### Cron health (last 24h)
- No **enabled** jobs observed in `lastStatus=error` within this snapshot.
- However, several **disabled one-shot** jobs have `lastStatus=error` (historical) with `Unsupported channel: whatsapp`.

# Context Anchor (internal)

Last updated: 2026-02-17 20:02 ET

## 1) Source refresh (internal summary)
- **memory/goals-master.md:** MISSING (ENOENT)
  - Breakage: enabled cron job **“Daily goals + deadlines post (PRIVATE)”** reads this file daily.
- **memory/2026-02-16.md:** MISSING (ENOENT)
  - Continuity gap: last daily note present is `2026-02-15.md`.
- **MEMORY.md (skim — operating rules/non‑negotiables):**
  - Draft-first for ALL outbound comms until explicitly approved.
  - **Do not email Karen back** (draft-only rule persists).
  - Friction rule: if ≥70% sure, decide and proceed; only ask when safety/permissions/irreversible.
  - LabStudio: **NO mock data** in user-visible UI (must be real DB/integration-backed).
  - OpenClaw dual‑Mac: don’t copy `~/.openclaw*`; exactly one LaunchAgent per Mac; office uses `--profile office` with `gateway.mode=local` + loopback bind.

## 2) Top 10 commitments (current)
1) Kids: Everett (11) + Berkeley (5) supported; schedule + routines stable.
2) Courts: monitor/respond to clerk/docket/hearing notices (no misses).
3) School admin: Quest/Focal/SIS/IEP/speech comms + forms (keep inbox clean).
4) Berkeley speech: home practice + keep aligned w/ SLP (Danielle Ryba).
5) Everett soccer: training plan + follow-through + playtest/feedback loops.
6) TYFYS mission: deliver medical evidence (DBQs/nexus) reliably.
7) TYFYS sales/ops reliability: Zoho + RingCentral automations stay healthy (no silent failures).
8) TYFYS provider pipeline: provider replies watch + provider handoff + fulfillment tasking.
9) Backups: hourly git auto-sync + nightly OpenClaw state bundles must succeed.
10) LabStudio: ship real, DB-backed member flows (cafe/booking/shop/checkout), PR-sized; **no prod deploy** without explicit approval.

## 3) Today’s non-negotiables (must stay green)
- **Courts + school monitoring:** email watch jobs must keep running; any replies are DRAFT-only.
- **Backups:**
  - Hourly: `scripts/backup/git-auto-sync-all.sh`
  - Nightly: OpenClaw state bundle → Drive + local sync
- **RingCentral (RC) updates:** weekday AM posts (8:30 update, 8:32 buckets, 8:35 KPI) + 4:00pm day-cap; DriftGuard verifies output sanity.

## 4) Active workstreams + next actions
### A) Drift control / continuity
- Create missing `memory/goals-master.md` (minimal but real):
  - Top goals (personal + TYFYS + LabStudio)
  - Deadlines/launch targets
  - Recurring non-negotiables
  - This-week focus
- Create `memory/2026-02-16.md` retro-log reconstructed from:
  - `git log --since '2026-02-16 00:00'` (clawd + labstudio-app)
  - any `PR_DRAFT_2026-02-16_*.md` or branch names
  - cron job edits (jobs updatedAtMs within 24h of Feb 16)

### B) TYFYS automations (RC/Zoho)
- Keep RC/Zoho token + state files consistent.
  - Note: both `memory/ringcentral-token.json` and `memory/ringcentral-token.new.json` exist (potential confusion).
- Watch for `invalid_grant` and paging/zero-count anomalies.

### C) LabStudio
- Continue build blocks on current PR/branch; enforce “no mock data”; keep PR-sized; do not deploy to prod without explicit approval.

### D) OpenClaw dual‑Mac hygiene
- Periodic check: ensure only one LaunchAgent per Mac; office still `gateway.mode=local` + loopback bind; no copying of `~/.openclaw*`.

## 5) Cron health — lastStatus=error in last 24h (quick scan)
Enabled jobs with errors:
- `TYFYS inbound SMS auto-reply scanner (Sales team)` (jobId: 786870c7-a69b-426c-bd29-3dad3f438003)
  - lastError: provider cooldown / rate_limit: `Provider openai-codex is in cooldown (all profiles unavailable)`
- `TYFYS outbound SMS autopilot (Adam/Amy/Jared, NEW tenant)` (jobId: 0aa2a6d7-2921-43d7-9242-c7c75c75122d)
  - lastError: same provider cooldown / rate_limit

Disabled/one-shot jobs that still show errors (noise, but indicates config drift):
- Several one-shot “KickCraft/Everett topic” test jobs + LabStudio deploy one-shot show `Unsupported channel: whatsapp`.

## 6) Detected breakages + queued fix (apply next work block)
1) **Missing file:** `/Users/richardducat/clawd/memory/goals-master.md`
   - Fix next: create the file with a stable structure so dependent cron jobs never crash.
2) **Missing file:** `/Users/richardducat/clawd/memory/2026-02-16.md`
   - Fix next: reconstruct retro daily note from git/PR drafts.
3) **Model/provider cooldown causing cron failures** (rate_limit)
   - Fix next: update the affected cron jobs to be resilient when provider is cooling down:
     - either (a) extend timeouts + set wakeMode next-heartbeat + backoff, or
     - (b) switch those two jobs to a lighter model / alternative provider profile if available.
     - and/or (c) gate sending actions when model unavailable (skip run, do NOT spam).
4) **Cron delivery mismatch drift:** jobs with `Unsupported channel: whatsapp`
   - Fix next: scan cron store for jobs whose `state.lastError` contains that string and patch delivery fields:
     - remove any stale/incorrect `delivery.channel`
     - ensure Telegram targets are explicit where needed; otherwise `delivery.mode=none`

# Context Anchor (internal)

Last updated: 2026-02-17 22:02 ET

## 1) Source refresh (internal summary)
- **memory/goals-master.md:** MISSING (ENOENT)
  - Breakage risk: cron job **“Daily goals + deadlines post (PRIVATE)”** reads this path.
- **memory/2026-02-16.md:** MISSING (ENOENT)
  - Continuity gap: daily notes present through `2026-02-15.md`.
- **MEMORY.md (skim — operating rules/non‑negotiables):**
  - **Draft-first for ALL outbound comms** until explicitly approved.
  - **Do not email Karen back** (draft-only rule persists).
  - Friction rule: if ≥70% sure, decide and proceed; only ask when safety/permissions/irreversible.
  - LabStudio: **NO mock data** in user-visible UI (must be real DB/integration-backed).

## 2) Top 10 commitments (current)
1) Kids stability: Everett (11) + Berkeley (5) supported; schedule + routines steady.
2) Courts: monitor/respond to clerk/docket/hearing notices (no misses).
3) School admin: Quest/Focal/SIS/IEP/speech comms + forms (keep inbox clean).
4) Berkeley speech: home practice + aligned w/ SLP (Danielle Ryba).
5) Everett soccer: training plan + follow-through.
6) TYFYS mission: deliver medical evidence (DBQs/nexus) reliably.
7) TYFYS ops reliability: Zoho + RingCentral automations stay healthy (no silent failures).
8) TYFYS provider pipeline: provider replies watch + provider handoff + fulfillment tasking.
9) Backups: hourly git auto-sync + nightly OpenClaw state bundles must succeed.
10) LabStudio: ship real, DB-backed member flows (cafe/booking/shop/checkout), PR-sized; **no prod deploy** without explicit approval.

## 3) Today’s non-negotiables (must stay green)
- **Courts + school:** email-watch jobs must keep running; any replies are DRAFT-only.
- **Backups:**
  - Hourly: `scripts/backup/git-auto-sync-all.sh`
  - Nightly: OpenClaw state bundle → Drive + local sync
- **RC updates:** weekday AM posts (8:30 update, 8:32 buckets, 8:35 KPI) + 4:00pm day-cap; DriftGuard verifies output sanity.

## 4) Active workstreams + next actions
### A) Drift control / continuity
- **Create missing `memory/goals-master.md`** (minimal but stable so cron jobs never break):
  - Top goals (personal + TYFYS + LabStudio)
  - Deadlines/launch targets
  - Recurring non-negotiables
  - This-week focus
- **Reconstruct `memory/2026-02-16.md`** retro-log from:
  - `git log --since '2026-02-16 00:00'` (repo root + labstudio-app)
  - any `PR_DRAFT_2026-02-16_*.md` and branches containing `2026-02-16`
  - cron edits (jobs updatedAtMs near Feb 16)

### B) TYFYS automations (RC/Zoho)
- Keep RC/Zoho token + state files consistent.
  - Note: both `memory/ringcentral-token.json` and `memory/ringcentral-token.new.json` exist (potential confusion).
- Watch for `invalid_grant` and paging/zero-count anomalies.

### C) LabStudio
- Continue build blocks on current PR/branch; enforce “no mock data”; keep PR-sized; **do not deploy to prod** without explicit approval.

### D) OpenClaw dual‑Mac hygiene
- Periodic check: ensure only one LaunchAgent per Mac; office still `gateway.mode=local` + loopback bind; no copying of `~/.openclaw*`.

## 5) Cron health — lastStatus=error in last 24h (quick scan)
- **Enabled jobs with lastStatus=error in last 24h:** none observed.
- **Any jobs with lastStatus=error in last 24h (incl disabled):**
  - `LabStudio deploy: shop-on-prod-baseline once Vercel quota resets` (jobId `e69a0b5d-fb54-4b65-ac83-4aad62d55e60`) — **disabled**
    - lastError: `Unsupported channel: whatsapp`

## 6) Detected breakages + queued fix (apply next work block)
1) **Missing file:** `/Users/richardducat/clawd/memory/goals-master.md`
   - Fix next: create file with stable structure so dependent cron jobs never crash.
2) **Missing file:** `/Users/richardducat/clawd/memory/2026-02-16.md`
   - Fix next: reconstruct retro daily note from git/PR drafts.
3) **Delivery mismatch drift (historical symptom):** `Unsupported channel: whatsapp`
   - Fix next: scan cron store for any *enabled* jobs whose delivery includes an explicit wrong channel; patch to Telegram (or `delivery.mode=none` for internal jobs).

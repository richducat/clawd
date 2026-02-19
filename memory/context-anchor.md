# Context Anchor (internal)

Updated: 2026-02-19 (Thu) — 10:02 ET

## Internal summary (quick)
- **Operating rules / non-negotiables (skim from MEMORY.md):**
  - Draft-first for all outbound comms; **do not send without explicit approval**.
  - **Never email Karen directly**.
  - Avoid friction: if ≥70% sure, decide and proceed; only ask when safety/irreversible/costly.
  - Keep code changes PR-sized; don’t push live; Richard tests/commits.
  - LabStudio UI: **no mock data** in user-visible UI (DB/integration-backed only).
- **Continuity gap:** multiple automations reference `memory/goals-master.md` and `memory/2026-02-16.md`, but both are **missing** in `/Users/richardducat/clawd/memory/`.

## Top 10 commitments (keep stable)
1) **Kids-first logistics**: custody rhythm respected; never miss school/admin items.
2) **Courts watch**: monitor + surface anything with clerk of courts / Brevard Court 18 / magistrate 32940 / summons/hearing/docket/notice.
3) **School watch**: Quest/IEP/SLP/SIS/Focus/teacher updates monitored; draft replies when needed.
4) **Backups stay green**: hourly git auto-sync + nightly OpenClaw bundle backups must keep succeeding.
5) **TYFYS RC morning cadence** (rep-safe): morning update + lead buckets + KPI scoreboard must be reliable.
6) **TYFYS SMS automations**: tokens healthy; inbound-only rules; throttle; avoid spamming; log state files.
7) **TYFYS stage 1–3 visibility**: morning + evening status updates to Devin group must stay concise/actionable.
8) **LabStudio build blocks (11/2/5 weekdays)**: ship real-data member flows; PR-based; **no prod deploy without explicit approval**.
9) **Drift control**: automation changes must be recorded (anchor notes) and not live only in UI/chat.
10) **OpenClaw dual-Mac stability**: don’t copy `~/.openclaw*`; one LaunchAgent per Mac; office uses `--profile office` + `gateway.mode=local`.

## Today’s non-negotiables (courts/school + backups + RC updates)
- **Courts/School (PRIVATE to Richard)**
  - Daily ops scan: 06:15 ET
  - Email Watch (courts+schools): **07:30 ET** and **16:40 ET**
- **Backups**
  - Hourly: `scripts/backup/git-auto-sync-all.sh` at **:05** every hour
  - Nightly OpenClaw bundles: **02:30 ET** (Drive upload) + **02:40 ET** (local Drive sync)
- **RingCentral updates (Sales Team) — weekdays**
  - 08:30 ET: Morning Sales Team RC update
  - 08:32 ET: Lead buckets
  - 08:35 ET: KPI scoreboard
  - 08:40 ET: DriftGuard verification (dry-run sanity checks)
  - 16:00 ET: Day-cap RC update

## Active workstreams + next actions
### TYFYS — ops reliability + revenue plumbing
- **Current focus:** keep RC/SMS automations stable + continue “Veteran Files → Zoho Deal attachments” completion.
- Next actions:
  - **.gdoc export pipeline:** export Google Doc placeholders to PDF/DOCX before upload; then rerun errors-only.
  - **Unmatched folder resolution:** improve matching heuristics + create a small manual mapping file; rerun to attach.
  - **RC tokens:** if `invalid_grant`, refresh with:
    - `node scripts/tyfys/ringcentral-oauth-refresh-token-per-user.mjs --tenant new --user <adam|amy|devin|jared|richard>`

### LabStudio — member-usable flows (real data only)
- Next actions:
  - Continue from latest open PR/branch during next build block.
  - Prioritize one end-to-end flow at a time (cafe/booking/shop/cart/checkout) with real backing.
  - Remember: **no prod deploy without explicit approval**.

### Infra / reliability
- Keep “drift guardrails” intact:
  - Backups hourly + nightly must keep succeeding.
  - Cron errors should be actionable (don’t let disabled one-shot errors hide real ones).

## Cron health (quick)
- **Enabled jobs with lastStatus=error in last 24h:** none detected.
- Note (noise only): several **disabled / one-shot** jobs have error history (“Unsupported channel: whatsapp”).

## Detected breakages + queued fix (do not execute now)
1) **Breakage:** `memory/goals-master.md` missing.
   - Impact: “Daily goals + deadlines post” cron job (and this anchor) can’t reference canonical goals.
   - Fix next work block:
     - locate canonical goals source (likely `second-brain/`), then
     - create/restore `memory/goals-master.md`, OR patch cron `Daily goals + deadlines post (PRIVATE)` to point to the real file.
2) **Breakage:** `memory/2026-02-16.md` missing.
   - Impact: continuity gap; multiple prompts reference it.
   - Fix next work block:
     - reconstruct a placeholder from git commits around Feb 16 + any `PR_DRAFT_2026-02-16*` artifacts + cron/job changes near that date,
     - backfill key decisions + next actions.
3) **Hygiene:** disabled jobs with “Unsupported channel: whatsapp” error history.
   - Fix next work block: cleanup/delete those disabled jobs or correct their delivery channel so error history doesn’t mask real failures.

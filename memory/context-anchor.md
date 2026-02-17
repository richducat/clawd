# Context Anchor (internal)

Last updated: 2026-02-17 10:02 ET

## Top 10 commitments (keep me anchored)
1) Be proactive + reduce Richard’s cognitive load; proceed when ~70% sure; avoid friction.
2) Draft-first for **all outbound emails** (explicit approval required to send). **Never email Karen back.**
3) Ship PR-sized, testable improvements (generally <400 LOC net). Prefer feature branches + PRs; don’t push live unless explicitly allowed + low-risk with rollback.
4) LabStudio: make member experience demo-ready (Profiles + Shop/Checkout + Toby AI). **No mock data** in user-visible UI (DB/integration-backed only).
5) Toby AI: retrieval-backed answers grounded in transcripts; must always “sound like Toby”.
6) Control Room: phone-usable cockpit via Mac→Vercel snapshot bridge.
7) TYFYS/vaclaimteam: Zoho as truth → Stripe close → Deal creation; improve throughput + revenue.
8) Keep automations healthy: RC updates, inbox watches, driftguards, backups.
9) Protect privacy: avoid client PII/PHI; keep rep-safe when posting to Sales Team; courts/kids are PRIVATE to Richard only.
10) Write decisions + next actions into memory files to prevent drift (no “mental notes”).

## Today’s non-negotiables
### Courts / School
- Run daily court/school email watches and summarize anything deadline-critical.
- Maintain the “PRIVATE to Richard” boundary for courts/kids/school content.

### Backups
- Hourly: `scripts/backup/git-auto-sync-all.sh` (cron @ :05) must stay green.
- Nightly: OpenClaw state backups to Drive + local sync (2:30a/2:40a ET) must stay green.

### RingCentral (RC) updates (Sales Team)
- Morning posts (weekdays):
  - 8:30a ET Morning Sales Team update
  - 8:32a ET Lead buckets
  - 8:35a ET KPI scoreboard
- 4:00p ET EOD/day-cap post.
- Keep: inbound forwarder + inbound auto-reply + outbound autopilot within their window schedules.

## Active workstreams + next actions
### LabStudio
- Objective: demo-ready member flows (Profiles + Shop/Cart/Checkout + Toby AI), all real/DB-backed.
- Next actions:
  - Use the 11am/2pm/5pm build blocks to advance end-to-end Shop/Checkout and smoke flows.
  - Keep work PR-sized; run `pnpm build`.
  - Revisit deploy pathway once quota/permissions allow; ensure any deploy-related cron jobs route to Telegram correctly.

### TYFYS
- Recent change (2026-02-16): SMS autopilot time-window bugfix + config flags.
  - Branch: `chore/2026-02-16-sms-autopilot-time-windows`
  - Commit: `eda11ab`
  - Test: `node --test scripts/tyfys/sms-autopilot.timewindows.test.mjs`
- Next actions:
  - Ensure PR-ready writeup exists and boundary tests are passing.
  - Continue Zoho hygiene + RC automations (timezone backfill, inbound forwarding, lead buckets, KPI scoreboard).

### Control Room
- Objective: phone-usable cockpit (Mac→Vercel snapshot bridge).
- Next actions:
  - Keep as background track unless a blocker emerges; capture design decisions in memory.

### Toby AI
- Objective: retrieval-backed transcript-grounded answers with consistent voice.
- Next actions:
  - Identify one concrete, testable retrieval improvement/eval harness step when a work block opens.

## Detected breakages (cron health, last ~24h) + queued fixes
1) **Cron job failed**: `LabStudio deploy: shop-on-prod-baseline once Vercel quota resets` (jobId `e69a0b5d-fb54-4b65-ac83-4aad62d55e60`).
   - Last status: error
   - Last error: `Unsupported channel: whatsapp`
   - Likely cause: delivery config is implicitly routing to an unsupported provider.
   - Fix to apply next work block:
     - Update the job’s delivery to explicit Telegram (or set `delivery.mode="none"` if it should be silent), then re-run.

2) Older disabled one-shots (Feb 14) for Everett/KickCraft also show `Unsupported channel: whatsapp`.
   - No action unless re-enabled; if re-enabled: ensure `delivery.channel="telegram"` + correct `to` target.

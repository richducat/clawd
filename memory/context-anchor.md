# Context Anchor (internal)

_Last updated: 2026-02-17 01:02 ET_

## Top 10 commitments (stable)
1) **Kids / custody execution**: be present + consistent; protect mornings/evenings.
2) **Courts vigilance**: daily scan + respond quickly to clerk/docket/hearing notices.
3) **School vigilance** (Quest + IEP/speech): daily scan + timely forms/emails.
4) **Backups must run**: hourly git auto-sync; nightly OpenClaw state backups (Drive + local sync).
5) **RingCentral ops must run**: weekday AM Sales Team updates (8:30/8:32/8:35 ET) + verifications.
6) **TYFYS Zoho→RC automation reliability**: inbound forwarding + inbound auto-replies + outbound autopilot windows.
7) **Revenue-ready deliverables**: ship one PR-sized, testable improvement per nightly build cadence.
8) **LabStudio demo-ready members flow**: Profiles + Shop/Checkout + Toby AI; **no mock data** in user UI.
9) **Toby AI quality**: retrieval-grounded answers that always sound like Toby.
10) **Control Room cockpit**: phone-usable Mac→Vercel snapshot bridge.

## Today’s non-negotiables
- **COURTS**: email watch (AM + PM) for clerk of courts / Brevard Court 18 / magistrate 32940.
- **SCHOOL**: email watch (AM + PM) for Quest/IEP/speech/teacher notes.
- **BACKUPS**:
  - Hourly: `scripts/backup/git-auto-sync-all.sh` (cron @ :05)
  - Nightly: OpenClaw state bundle → Drive (02:30) + local Drive sync (02:40)
- **RC UPDATES (weekday)**:
  - 08:30 ET Morning Sales Team RC update
  - 08:32 ET lead buckets
  - 08:35 ET KPI scoreboard
  - 08:40 ET verification (dry-run checks)

## Active workstreams + next actions

### TYFYS / vaclaimteam
- **Goal**: Zoho as truth → Stripe close → Deal creation; keep sales follow-ups moving.
- Next actions:
  - Merge/test the **SMS autopilot time windows** work (branch `chore/2026-02-16-sms-autopilot-time-windows`, commit `eda11ab`):
    - Run: `node --test scripts/tyfys/sms-autopilot.timewindows.test.mjs`
    - If green: open PR draft + note boundary behavior.
  - Keep NEW tenant automations stable:
    - inbound forward-to-owner (every 30m)
    - inbound auto-reply scanner (every 30m)
    - outbound autopilot (schedule mode; Adam/Amy)

### LabStudio
- **Goal**: demo-ready members experience (Profiles + Shop/Checkout + Toby).
- Next actions:
  - Continue build blocks (11am/2pm/5pm ET weekdays): focus on **real** Shop/Checkout flows.
  - Ensure deploy path is consistent (Vercel CLI + alias to `app.labstudio.fit`); do not deploy without explicit approval.

### Toby AI
- **Goal**: retrieval-backed answers grounded in transcripts; voice/character consistency.
- Next actions:
  - Identify transcript ingestion/retrieval gaps and define a minimal grounding evaluation set.

### Control Room
- **Goal**: phone-usable cockpit via Mac→Vercel snapshot bridge.
- Next actions:
  - Clarify the snapshot bridge reliability constraints + create a small hardening checklist.

### Personal ops / CRM
- **Goal**: keep communications and meetings prepped with low friction.
- Next actions:
  - Daily ingest (06:05) + meeting prep (07:30) should keep running; confirm no auth drift.

## Cron health quick check (errors last ~24h)
Detected recent `lastStatus=error`:
- **LabStudio deploy: shop-on-prod-baseline once Vercel quota resets** (jobId `e69a0b5d-fb54-4b65-ac83-4aad62d55e60`) — `lastError: Unsupported channel: whatsapp`.

Also seen (older/disabled but still noisy): several **KickCraft/Everett** one-shot jobs failing with the same `Unsupported channel: whatsapp` error.

## Detected breakages + queued fix
### Breakage: “Unsupported channel: whatsapp”
- Likely root cause: a delivery/channel field is being set/overridden to `whatsapp` somewhere for isolated deliveries (should be Telegram or omitted).
- Queued fix (next work block):
  1) Inspect cron job definitions for the failing jobs and remove/override any `delivery.channel` incorrectly set to `whatsapp`.
  2) Re-run a one-shot send test to the intended Telegram target.
  3) For the LabStudio deploy job: set delivery to either (a) `mode:none` (silent) or (b) explicit Telegram channel+to, and re-enable only when ready.

---
Internal reminder: draft-first for all outbound emails; never email Karen directly (draft only). Avoid friction; proceed when ≥70% sure.

# Context Anchor (internal)

_Last updated: 2026-02-17 08:02 ET_

## Top 10 commitments (stable)
1) **Kids / custody execution**: be present + consistent; protect mornings/evenings.
2) **Courts vigilance**: daily scan + respond quickly to clerk/docket/hearing notices.
3) **School vigilance** (Quest + IEP/speech): daily scan + timely forms/emails.
4) **Backups must run**: hourly git auto-sync; nightly OpenClaw state backups (Drive + local sync).
5) **RingCentral ops must run**: weekday AM Sales Team updates (8:30/8:32/8:35 ET) + verification.
6) **TYFYS Zoho→RC automation reliability**: inbound forwarding + inbound auto-replies + outbound autopilot windows.
7) **Revenue-ready deliverables**: ship one PR-sized, testable improvement per nightly cadence.
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
  - Merge/test the **SMS autopilot time windows** improvement:
    - Branch: `chore/2026-02-16-sms-autopilot-time-windows`
    - Commit: `eda11ab`
    - Test: `node --test scripts/tyfys/sms-autopilot.timewindows.test.mjs`
  - If green: open PR draft + note boundary behavior (evening window ends 20:30 PT; quiet hours configurable via flags).

### LabStudio
- **Goal**: demo-ready members experience (Profiles + Shop/Checkout + Toby).
- Next actions:
  - Use build blocks (11am/2pm/5pm ET weekdays): push **real** Shop/Checkout flows (no mock data).
  - Keep deploy path consistent (Vercel CLI + alias to `app.labstudio.fit`); do not deploy without explicit approval.

### Toby AI
- **Goal**: retrieval-backed answers grounded in transcripts; voice/character consistency.
- Next actions:
  - Identify ingestion/retrieval gaps and define a minimal grounding eval set.

### Control Room
- **Goal**: phone-usable cockpit via Mac→Vercel snapshot bridge.
- Next actions:
  - Clarify snapshot bridge reliability constraints + create a small hardening checklist.

### Personal ops / CRM
- **Goal**: keep communications and meetings prepped with low friction.
- Next actions:
  - Ensure daily ingest + meeting prep automations keep running; watch for auth drift.

## Cron health quick check (errors in last ~24h)
- **LabStudio deploy: shop-on-prod-baseline once Vercel quota resets** (`e69a0b5d-fb54-4b65-ac83-4aad62d55e60`)
  - lastStatus=error; lastError: `Unsupported channel: whatsapp`
  - Note: job is disabled + deleteAfterRun, but it still ran and errored.
- **KickCraft/Everett topic one-shots** (all disabled + deleteAfterRun):
  - `df8f1ae3-dec6-4821-abe1-8d2da4d81762` — Cool Cat test ping
  - `464cbf82-4b57-43f5-b456-06d7f0738d68` — Cool Cat test ping retry
  - `806bdedf-058e-4fe0-b0c7-cd5350a2c1cc` — Cool Cat test ping (now, after permissions fixed)
  - `0338f6fa-f851-4ea5-b836-b46b3679ad14` — playtest checklist + feedback prompts
  - All show lastError: `Unsupported channel: whatsapp`

## Detected breakages + queued fix

### Breakage: Some cron deliveries still reference unsupported channel `whatsapp`
- Symptom: job run fails with `Unsupported channel: whatsapp`.
- Likely cause: legacy/incorrect delivery config (explicit channel=whatsapp or stale routing defaults) on one-shot jobs.
- Queued fix (next available work block):
  1) Locate all jobs with `lastError` containing `Unsupported channel: whatsapp`.
  2) For each:
     - If obsolete (one-shot, disabled, deleteAfterRun): **remove** it.
     - If still needed: set delivery to Telegram explicitly (`delivery.channel="telegram"`, correct `delivery.to`) OR set `delivery.mode="none"`.
  3) Re-run `cron list` and confirm **no enabled jobs** have whatsapp delivery and that disabled/deleteAfterRun jobs are cleaned up.

---
Internal ops rules (skim reminders): draft-first for all outbound emails; **never email Karen directly** (draft only). Avoid friction; proceed when ≥70% sure; ask only for safety/irreversibility/costly uncertainty.

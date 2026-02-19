# Context Anchor (internal)

Last updated: 2026-02-18 22:02 ET

## Top 10 commitments (keep true)
1) **LabStudio**: ship end-to-end member-usable flows (cafe + booking + shop/cart/checkout) with **real DB-backed data** (no mock UI).
2) **TYFYS throughput**: move Zoho stages 1–3 daily; eliminate missing intake notes + missing key attachments; reduce overdue tasks.
3) **TYFYS automation reliability**: keep RC AM/KPI/verification/EOD posts green; keep SMS autopilot reliable (timeouts/rate limits); keep tokens healthy.
4) **Personal admin stability**: never miss **courts + school** deadlines; follow draft-first comms hygiene.
5) **Backups + change-control**: hourly git autosync + nightly OpenClaw state backups stay green.
6) **Draft-first email policy**: draft-only for all outbound unless explicitly approved; **do not email Karen** without explicit approval.
7) **Low-friction ops**: if ≥70% sure, decide and proceed; only ask when safety/irreversibility/costly mistake risk.
8) **PR-sized changes**: keep code changes small, testable, and reviewable; do not push live / change prod without approval.
9) **Continuity**: keep daily notes present (memory/YYYY-MM-DD.md) + write next-day plan.
10) **Rep-safe comms**: never leak private finances/personal/courts/kids info into TYFYS team outputs.

## Today’s non-negotiables
- **Courts/school watches**: court/school email watch jobs remain healthy; any replies are **draft-only**.
- **Backups**:
  - Hourly git auto-sync job stays green.
  - Nightly OpenClaw state backups (Drive + local sync) stay green.
- **RingCentral updates**: AM + lead buckets + KPI + verification + EOD run and look sane.

## Active workstreams + next actions
### LabStudio (priority build blocks)
- Next actions:
  - Ship 2–3 PR-sized improvements this week focused on member flows.
  - Enforce “no mock data” rule: any UI must be DB-backed (seeding ok if written to DB).
  - Avoid prod deploys unless explicitly approved.

### TYFYS Ops (stages 1–3 hygiene)
- Next actions:
  - Daily visibility on missing intake notes / missing attachments / overdue tasks.
  - Keep provider handoffs + waiting-room check-ins moving.

### Automation hygiene
- Next actions:
  - Keep SMS autopilot stable (batching, per-run caps, backoff).
  - Monitor cron health; fix delivery routing misconfigs.
  - Keep token refresh paths documented and working.

## Cron health (last 24h)
- **Enabled jobs with lastStatus=error in last 24h:** none detected from current cron list snapshot.

## Detected breakages / drift risks (queue fixes; do NOT message)
1) **Legacy disabled “Cool Cat / Everett topic” jobs** show `lastStatus=error` with `lastError: "Unsupported channel: whatsapp"`.
   - Why it matters: indicates a bad/old delivery config; could recur if re-enabled.
   - Queued fix (next work block): delete or sanitize these disabled one-shot jobs (df8f1ae3…, 464cbf82…, 806bdedf…, 0338f6fa…) so they can’t be accidentally re-enabled in a broken state; ensure future kid-topic posts use Telegram channel explicitly.

2) **Disabled LabStudio deploy one-shot** (e69a0b5d…) failed with the same whatsapp delivery error.
   - Why it matters: deploy automation may have been blocked by delivery misrouting rather than Vercel.
   - Queued fix (next work block): correct delivery mode/target for this job (or remove it if superseded), then re-run deploy only when explicitly approved.

3) **Daily note continuity**: 2026-02-16 file is a placeholder.
   - Queued fix (next work block): backfill any remembered key events (or mark “no notable events recalled”) and ensure next-day plan is written nightly.

# Context Anchor (internal)

Updated: 2026-02-18 20:02 ET

## Top 10 commitments (current)
1) **LabStudio**: make app member-usable end-to-end (cafe + booking + shop/cart/checkout) with **real DB-backed data** (no mock UI).
2) **TYFYS throughput**: keep Zoho stages 1–3 moving daily; fix missing intake notes + missing attachments; reduce overdue tasks.
3) **TYFYS automations reliability**: keep RingCentral AM/KPI/verification/EOD posts green; keep tokens healthy.
4) **Outbound SMS autopilot stability**: reduce runtime/timeouts; batching + per-run caps + rate-limit backoff.
5) **Personal admin stability**: never miss **courts + school** deadlines; keep replies **draft-only**.
6) **Backups + change-control**: hourly git autosync + nightly OpenClaw backups stay green; capture decisions in memory files.
7) **Provider replies watch**: surface provider/doctor emails quickly; no outbound emails unless explicitly approved.
8) **Waiting-room + fulfillment tasking**: ensure Devin/Karen get actionable Zoho tasks; enforce required fields.
9) **Repo hygiene / drift prevention**: default branch main, avoid embedded .git / branch-path drift.
10) **Low-friction operations**: act without asking when safe; avoid creating friction; PR-sized changes.

## Today’s non-negotiables
- **Courts + school watch**: monitor Gmail for clerk/courts + Quest/school items; if reply needed → **draft-only**.
- **Backups**: hourly git autosync job stays green; nightly OpenClaw state backups stay green.
- **RingCentral updates**: AM + KPI + verification + EOD posts run and look sane.

## Active workstreams + next actions
### LabStudio
- Next actions:
  - Keep shipping 2–3 PR-sized improvements this week.
  - Prioritize real shop/cart/checkout + booking flows; eliminate any remaining mock UI surfaces.
  - Keep build blocks (11am/2pm/5pm ET weekdays) producing incremental shippable commits.

### TYFYS Ops (Stages 1–3)
- Next actions:
  - Close loop on missing intake notes + missing key attachments for active Deals.
  - Use deal-file-health + taskers to create/assign clean next steps.

### Automation hygiene
- Next actions:
  - Keep DriftGuard + cron sentinels green.
  - Continue hardening SMS autopilot: smaller batch caps, better retries/backoff, avoid long single runs.

## Cron health (last 24h)
- No jobs with `lastStatus=error` **within the last 24 hours** (threshold = now-24h).

## Detected breakages / risks (queued fixes)
1) **Several one-shot/disabled jobs show `lastError: Unsupported channel: whatsapp`** (e.g., Cool Cat Everett-topic pings; LabStudio deploy one-shot).
   - Hypothesis: delivery channel field is incorrectly set/left over (should be Telegram or mode=none).
   - Next fix (next work block): audit those specific job payloads/delivery objects; patch to explicit `channel:"telegram"` (or remove `channel` entirely when `mode:none`) and re-run only if re-enabled.

2) **LabStudio deploy one-shot job (shop-on-prod-baseline) recorded error even though it is disabled now**.
   - Next fix: when time permits, re-create deploy reminder with correct Telegram delivery (or `mode:none`) and ensure it doesn’t auto-post anywhere unintended.

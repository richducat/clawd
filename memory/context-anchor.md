# Context Anchor (internal)

Updated: 2026-02-18 19:02 ET

## Top 10 commitments (current)
1) **LabStudio**: ship member-usable end-to-end flows (cafe + booking + shop/cart/checkout) with **real DB-backed/integration-backed data** (no mock UI).
2) Keep LabStudio changes **PR-sized** (≈<400 lines net), test locally, **do not deploy/push live** without explicit approval.
3) **TYFYS throughput**: keep Zoho stages 1–3 moving daily; eliminate missing intake notes + missing key attachments; reduce overdue tasks.
4) **TYFYS automations reliability**: RingCentral AM/KPI/verification/EOD posts stay green; tokens healthy; no silent failures.
5) **Personal admin stability**: never miss **courts + school** deadlines; surface anything urgent fast.
6) **Draft-first comms hygiene**: draft-only for outbound; do not send unless explicitly approved.
7) **Email rule**: draft-only simple replies for everyone; **do NOT email Karen back**.
8) **Backups + change-control**: hourly git autosync + nightly OpenClaw state backups stay green.
9) **Friction rule**: if ≥70% sure, proceed without asking; only ask when safety/permissions/irreversibility or likely costly error.
10) **Continuity**: write next-day plan into `memory/YYYY-MM-DD.md` daily to avoid context loss.

## Today’s non-negotiables
- **Courts/school**: email watches run; any needed replies are **drafts only**.
- **Backups**: hourly git autosync OK; nightly OpenClaw state backups scheduled.
- **RingCentral updates**: AM + lead buckets + KPI + verification + EOD posts stay sane/green.

## Active workstreams + next actions
### LabStudio (primary build)
- Next actions:
  - Continue incremental shippable improvements during build blocks (11/2/5 weekdays).
  - Enforce “no mock data” requirement; if data missing, add DB seed/write-path, not UI placeholders.
  - Keep deploy runbook in mind (Vercel CLI + author identity gotchas).

### TYFYS Ops (stages 1–3)
- Next actions:
  - Keep daily client status updates to Devin group running.
  - Drive down deal-file gaps: missing intake notes, missing attachments, >10 overdue tasks.

### Automation hygiene / DriftGuard
- Next actions:
  - Watch cron error sentinel + preflight results.
  - Keep tokens healthy; if invalid_grant occurs, refresh per-user refresh tokens.

### Personal admin
- Next actions:
  - Maintain court/school scans; draft replies only when clearly needed.

## Detected breakages (last ~24h) + queued fix
### 1) ENABLED job error: TYFYS outbound SMS autopilot timed out
- Job: `TYFYS outbound SMS autopilot (Adam/Amy/Jared, NEW tenant)`
- jobId: `0aa2a6d7-2921-43d7-9242-c7c75c75122d`
- Last error: `Error: cron: job execution timed out` (lastRunAtMs 1771443900157)
- Likely cause: too much work per run / slow Zoho+RC roundtrips / leadLimit too high for timeoutSeconds (3300s) in worst-case.
- Fix to apply next work block:
  1) Reduce per-run work: drop `--leadLimit 120` → **60** (or implement paging with checkpointing in `memory/tyfys-sms-autopilot.json`).
  2) Add internal time-budget enforcement: stop sending when <5 min remaining; persist cursor.
  3) Add instrumentation for: fetch leads time, eligibility filtering time, send batch time, per-rep breakdown.
  4) If needed, bump cron timeoutSeconds to **4200** (only after (1)-(3)).

### 2) Old/disabled one-shots showing “Unsupported channel: whatsapp”
- Observed on several disabled Feb 14 one-shots + one disabled LabStudio deploy one-shot.
- Action: no immediate impact (disabled). If resurrecting any job, **explicitly set `delivery.channel: telegram`** (or `mode:none`) to avoid default-channel confusion.

## Notes from memory skim (operating rules / non-negotiables)
- Proactive and autonomous, but **draft-first** for all outbound.
- **No mock data** in LabStudio user-visible UI.
- For builds: create PRs; user tests/commits; do not push live.

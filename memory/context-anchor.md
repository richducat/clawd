# Context Anchor (internal)

Updated: 2026-02-18 21:02 ET

## 1) Source recap (internal)
- goals-master.md: priority is LabStudio member-ready end-to-end with **real DB-backed flows**; keep TYFYS stages 1–3 moving; keep automations (RC posts, SMS autopilot, tokens) reliable; don’t miss courts/school; keep backups + change-control green.
- 2026-02-16.md: daily note continuity was missing; mandate: ensure daily memory files exist + capture next-day plan; keep automations green.
- MEMORY.md (ops rules skim): draft-first outbound email policy; never email Karen automatically; avoid mock data in LabStudio; PR-sized changes; dual-Mac OpenClaw hygiene.

## 2) Top 10 commitments (current)
1) **LabStudio**: ship real, DB-backed member flows (cafe + booking + shop/cart/checkout); no mock UI.
2) LabStudio: deliver 2–3 PR-sized improvements per week (weekday build blocks).
3) **TYFYS throughput**: keep Zoho stages 1–3 moving daily; eliminate missing intake notes + missing key attachments; reduce overdue tasks.
4) **TYFYS automations**: RingCentral posts (AM + lead buckets + KPI + verification + day-cap + ops brief) stay green.
5) **Outbound SMS autopilot**: keep runtime stable (batching, limits, backoff) + avoid timeouts.
6) **Token health**: RingCentral refresh tokens + Zoho auth stay valid; fix invalid_grant quickly.
7) **Personal admin stability**: courts + school monitoring; draft-first replies; never miss deadlines.
8) **Backups**: hourly git auto-sync; nightly OpenClaw state backups to Drive + local sync.
9) **DriftGuard/change-control**: cron health sentinel + preflight + record automation changes in anchor files.
10) **Memory continuity**: daily note exists every day; next-day plan written to prevent drift.

## 3) Today’s non-negotiables (daily)
- **Courts + school**: email watch scans run; any replies are **draft-only**.
- **Backups**: hourly git autosync stays green; nightly OpenClaw state backup jobs stay green.
- **RingCentral updates**: AM + lead buckets + KPI + verification + EOD/day-cap posts run and look sane.

## 4) Active workstreams + next actions
### A) LabStudio (product)
- Next actions:
  - Pick the next smallest “member-usable” gap in the shop/cart/checkout or booking flow and implement with real DB data.
  - Keep changes PR-sized (<400 net lines), add test steps + rollback note.
  - Ensure build passes locally (pnpm build).

### B) TYFYS Ops (stages 1–3 hygiene)
- Next actions:
  - Run/monitor deal-file-health and push toward: notes present, key attachments present, overdue tasks reduced.
  - Ensure Devin-group client-status posts are skimmable and focus on movement + blockers.

### C) Automation hygiene / reliability
- Next actions:
  - Keep DriftGuard sentinel/preflight green.
  - If any job errors: capture in this file + apply smallest safe fix during next work block.

### D) Personal admin
- Next actions:
  - Continue courts/school scans; drafts only.
  - Weekly Berkeley speech check-in draft (when scheduled Wednesdays).

## 5) Cron health (last 24h errors)
Detected jobs with `lastStatus=error` (regardless of enabled/disabled):
- (DISABLED) **LabStudio deploy: shop-on-prod-baseline once Vercel quota resets** (jobId e69a0b5d-...): lastError `Unsupported channel: whatsapp`.
- (DISABLED) **KickCraft/Everett topic** pings (jobIds df8f1ae3-..., 464cbf82-..., 806bdedf-..., 0338f6fa-...): lastError `Unsupported channel: whatsapp`.

## 6) Detected breakages + queued fix (apply next work block)
### Breakage: “Unsupported channel: whatsapp” in cron runs
- Likely cause: cron delivery routing/channel config mismatch (jobs attempted to announce via a channel not supported in this gateway).
- Fix plan (next work block):
  1) For the KickCraft/Everett one-shot test jobs: **delete or permanently disable** them (they’re already disabled and were one-time).
  2) For the LabStudio deploy one-shot job: either
     - set `delivery.mode="none"` (no announcements) OR
     - set `delivery.channel="telegram"` with an explicit `to` target.
  3) After edits, re-run `cron list` and confirm no new errors.

---
(Internal note) Hard rule respected: no outbound messages sent from this run.

# Goals Master (canonical)

Last updated: 2026-02-18

## Top 5 goals (near-term)
1) **LabStudio**: make the app fully member-usable end-to-end (cafe + booking + shop/cart/checkout) with **real DB-backed data** (no mock UI).
2) **TYFYS throughput**: keep Zoho stages 1–3 moving daily; eliminate missing intake notes + missing key attachments; reduce overdue tasks.
3) **TYFYS automations reliability**: keep RingCentral AM/verification/EOD posts green; fix outbound SMS autopilot runtime/timeouts; keep tokens healthy.
4) **Personal admin stability**: never miss **courts + school** deadlines; maintain draft-first comms hygiene.
5) **Backups + change-control**: hourly git autosync + nightly OpenClaw state backups stay green; important decisions captured in memory files.

## This week (focus)
- Ship 2–3 PR-sized LabStudio improvements (member flows).
- Close the loop on missing intake notes for active Deals in first 3 stages (visibility + tasking).
- Stabilize SMS autopilot (batching, smaller per-run caps, rate-limit backoff).

## Top 3 active workstreams
- LabStudio build blocks (11am/2pm/5pm weekdays): incremental shippable changes + PRs.
- TYFYS Ops: stage health + attachments backfill + provider handoffs + waiting-room check-ins.
- Automation hygiene: DriftGuard, backups, cron health, token health.

## Today’s non-negotiables (daily)
- Courts/school email watches run; any responses are **draft-only**.
- Backups run (hourly git autosync; nightly OpenClaw state backup jobs).
- RingCentral updates run and look sane (AM + KPI + verification + EOD).

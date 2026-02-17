# Context Anchor — 2026-02-17 (Tue) 09:02 ET

## Internal summary (what changed recently)
- **Goals ladder:** M0 revenue-ready web release → M1 polish/stability → M2 scale/monitoring.
- **Current product priorities:** LabStudio (members + shop/checkout + Toby AI), Toby AI (retrieval-backed transcript-grounded answers, “sound like Toby”), Control Room (phone cockpit via Mac→Vercel snapshot bridge), TYFYS/vaclaimteam (Zoho as truth → Stripe close → Deal creation).
- **Most recent concrete work (2026-02-16):** TYFYS SMS autopilot time-window hardening.
  - Fixed bug: evening window documentation vs code mismatch (now supports running until **20:30 PT**).
  - Added CLI flags: `--tz`, `--quietStart/--quietEnd`, `--morningWindow/--eveningWindow`, `--nowIso`.
  - Added boundary tests: `node --test scripts/tyfys/sms-autopilot.timewindows.test.mjs`.
  - Branch: `chore/2026-02-16-sms-autopilot-time-windows`, commit: `eda11ab`.

## Top 10 commitments (keep me honest)
1) **Be proactive**: keep Richard organized/prepared; reduce drift.
2) **Draft-first outbound email** (explicit approval required to send); **never email Karen back**.
3) **Avoid friction**: if ≥70% sure, decide and proceed; only ask when safety/irreversible/high-cost.
4) **LabStudio**: make member experience real end-to-end (no mock data in user-visible UI).
5) **TYFYS throughput + revenue unblockers**: Zoho→RingCentral→Stripe loop stays healthy.
6) **Toby AI**: retrieval-backed answers grounded in transcripts; maintain “Toby” voice.
7) **Control Room**: phone-usable cockpit via Mac→Vercel snapshot bridge.
8) **PR-sized changes**: <400 lines net; PR-ready writeups; Richard reviews.
9) **Deploy safety**: only low-risk deploys with obvious rollback; ask for high-risk.
10) **Continuity**: record decisions in memory files (no “mental notes”).

## Today’s non-negotiables
- **Courts + school:** ensure the scheduled email watches run and surface any deadlines.
- **Backups:**
  - Hourly git auto-sync (cron @ :05).
  - Nightly OpenClaw Drive + local sync backups (02:30 / 02:40).
- **RingCentral (RC) updates:** ensure morning RC posts + verification jobs run (8:30–8:45 ET + DriftGuard verify @ 8:40).

## Active workstreams + next actions
### 1) TYFYS automation reliability
- Next:
  - **Land/merge** the SMS autopilot time-window fix branch (or open PR if not yet).
  - Verify SMS autopilot schedule windows are correct for PT (esp. evening end 20:30).
  - Keep watching for RingCentral token `invalid_grant` and refresh per-user if needed.

### 2) LabStudio
- Next:
  - Continue build blocks (11am/2pm/5pm weekdays): focus on **real Shop/Cart/Checkout** + member nav.
  - Ensure no UI-only “mock” placeholders leak to members.

### 3) Control Room
- Next:
  - Define minimal cockpit actions (snapshot refresh, deploy status, quick links) and validate the Mac→Vercel snapshot bridge reliability.

### 4) Toby AI
- Next:
  - Confirm retrieval pipeline over transcripts (grounded answers, cite/source discipline).
  - Add/verify “Toby voice” guardrails (style + tone + boundaries).

## Cron health (quick)
### Jobs with lastStatus=error in last ~24h (observed)
- **LabStudio deploy: shop-on-prod-baseline once Vercel quota resets** (`e69a0b5d-fb54-4b65-ac83-4aad62d55e60`) — lastError: `Unsupported channel: whatsapp` (job currently disabled).
- **KickCraft/Everett topic test pings** (disabled, deleteAfterRun):
  - `df8f1ae3-dec6-4821-abe1-8d2da4d81762`
  - `464cbf82-4b57-43f5-b456-06d7f0738d68`
  - `806bdedf-058e-4fe0-b0c7-cd5350a2c1cc`
  - `0338f6fa-f851-4ea5-b836-b46b3679ad14`
  - All lastError: `Unsupported channel: whatsapp`

## Detected breakages + queued fix (do NOT action now)
1) **Cron delivery routing bug/footgun:** jobs without explicit `delivery.channel` sometimes error as `Unsupported channel: whatsapp`.
   - Hypothesis: default channel being inferred incorrectly when `delivery.to` is present but `delivery.channel` omitted.
   - Fix next work block:
     - Patch affected jobs (even if disabled) to set `delivery.channel="telegram"` explicitly OR set `delivery.mode="none"` for internal-only.
     - Optionally delete the old disabled one-shot jobs that already ran.

2) **LabStudio deploy job failure is non-actionable until delivery routing fixed** (and/or Vercel quota/state).
   - Fix next work block:
     - Update `e69a0b5d...` delivery to `mode:none` (internal) or `channel:telegram` with correct target.
     - Re-run only after confirming Vercel quota reset and local build passes.

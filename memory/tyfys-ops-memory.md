# TYFYS Ops Memory (shared-safe)

This file is safe to use in TYFYS business contexts (e.g., Devin+Richard group topics). It must **never** include custody/kids/courts/personal matters.

## Principles
- REP-SAFE: Do not post Stripe/cashflow/private financials to sales/team chats.
- Draft-first email policy unless explicitly approved by Richard; sensitive categories (finance/legal/cancel/refund/chargeback/angry) must escalate.

## Key chat routing
- Devin+Richard Telegram group (enabled in OpenClaw): chatId `-1003603383366`, topicId `34`.

## Vercel / onboarding
- TYFYS onboarding app is deployed via Vercel project `tyfys-benefits`.
- Public app URL: https://app.tyfys.net/app.html
- DNS: `app.tyfys.net -> 76.76.21.21` (Vercel).
- Stripe webhook creates Zoho Deal stage: `Payment complete`.
- Lead_Source: `tyfys.net`.

## Daily/recurring ops commands
- Fulfillment tasker:
  - `cd /Users/richardducat/clawd && node scripts/tyfys/fulfillment-tasker.mjs`
  - Enforces required fields and creates Zoho Tasks routed to Devin (intake) / Karen (provider handoff).
- Duplicate lead scan:
  - `cd /Users/richardducat/clawd && node scripts/tyfys/zoho-lead-duplicates-scan.mjs --limit 200`
  - Output: `memory/tyfys-duplicate-leads-report.json`

## Zoho record hygiene
- When proving outreach, capture:
  - recipient, timestamp, subject, short summary
  - add a Zoho Note to the Deal (module Notes with Parent_Id + se_module).


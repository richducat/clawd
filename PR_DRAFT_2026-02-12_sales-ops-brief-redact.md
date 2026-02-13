# PR Draft — TYFYS: Daily Sales/Ops Brief `--redact` (PII-safe sharing)

## A) What changed (summary)
Added an optional `--redact` flag to `scripts/tyfys/daily-sales-ops-brief.mjs` to mask client phone numbers/names that appear in the RingCentral sections (missed inbound + inbound SMS “who texted you”).

Also added a lightweight `--selftest` mode so you can quickly verify the redaction behavior without hitting any APIs.

## B) Why (problem)
The daily brief output is often copy/pasted into internal chats. The RingCentral sections can include client phone numbers and/or caller names, which is unnecessary exposure and makes it harder to share broadly.

`--redact` makes the brief “REP-safe” by default when you want it.

## C) How to test (local)
From repo root:

1) Redaction logic self-test (no network calls):
   - `node scripts/tyfys/daily-sales-ops-brief.mjs --selftest --redact`

2) Real run (requires your existing env tokens):
   - `node scripts/tyfys/daily-sales-ops-brief.mjs --hours 24 --redact`

Expected:
- “Missed inbound (latest)” shows `***-***-1234` style values instead of raw phone/name
- “Who texted you (inbound SMS top)” shows masked identifiers
- The rest of the brief (rep coverage, Zoho pipeline movement, meetings booked) stays unchanged

## D) Implementation notes
- New helpers: `maskPhone()` + `redactParty()`.
- `redactParty()` keeps rep names (Adam/Amy/Jared/Ashley) but redacts other non-numeric names.
- Header line includes `redact:on` when enabled.

## E) Risk / rollout
Low risk. This is opt-in via `--redact`, so existing automations won’t change output unless you add the flag.

Commit:
- `ebc3aa6` — `chore(tyfys): add --redact to daily sales ops brief`

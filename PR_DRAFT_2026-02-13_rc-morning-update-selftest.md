# PR Draft — TYFYS: Morning Sales Team update (selftest + faster RC fetch)

## A) What / Why
The `morning-sales-team-ringcentral-update` script is a key “daily cadence” automation, but it was:

1) Hard to test locally without hitting Zoho/RingCentral APIs, and
2) Potentially slow because it fetched RingCentral call-log + message-store sequentially per rep.

This PR adds a `--selftest` mode (offline, deterministic output) and parallelizes RingCentral fetches with a small concurrency cap (default 3) to reduce runtime without hammering the API.

## B) Changes (PR-sized)
- `scripts/tyfys/morning-sales-team-ringcentral-update.mjs`
  - Add `--selftest` mode that prints a representative message without requiring env/tokens/chatId.
  - Parallelize per-rep RingCentral requests (call-log + message-store) using `Promise.all` and a simple `pLimit` concurrency cap.
  - Add `--concurrency <n>` option (default: 3).
  - Make `formatTable()` safe for empty/malformed inputs.

## C) How to test
```bash
cd /Users/richardducat/clawd

# Offline test (no env required)
node scripts/tyfys/morning-sales-team-ringcentral-update.mjs --selftest

# (Optional) Live fetch + do not post
# node scripts/tyfys/morning-sales-team-ringcentral-update.mjs --chatId <CHAT_ID> --dry-run --tenant new --window previousBusinessDay
```

Expected:
- `--selftest` prints a complete RC-ready message.
- Live run should complete faster vs prior sequential behavior (esp. with more reps) and still produce the same counts.

## D) Risk / Rollback
- Low risk: change is isolated to one script.
- If RingCentral rate-limits, reduce concurrency:
  - `--concurrency 1` (restores mostly-sequential behavior)
- Rollback: revert commit `3a5326c`.

## E) Notes / Next
- If we want true “dry-run without API calls” for live mode, we can add a `--fixture <path>` option to load saved payloads.
- If roster expands, the parallel model should keep runtimes stable.

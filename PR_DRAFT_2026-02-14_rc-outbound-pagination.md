# PR Draft — 2026-02-14 — RC outbound pagination (TYFYS)

## A) What I shipped (1 tangible thing)
Improved the TYFYS RingCentral “morning sales team update” so outbound **calls + SMS** counts are accurate even when a rep has **>1000** records in the window (RingCentral paginates these endpoints). Previously the script only counted the first page and could under-report top-performer + totals.

## B) Why this matters (impact)
- Prevents incorrect leaderboard / KPI callouts in the morning post.
- Reduces rep distrust (“the numbers are wrong”) and avoids coaching decisions based on partial data.
- Makes the daily message reliable as volume grows.

## C) What changed (implementation notes)
- Added a small `ringcentralGetAllRecords()` helper in `scripts/tyfys/morning-sales-team-ringcentral-update.mjs`.
- Supports common RingCentral paging responses:
  - `navigation.nextPage.uri` style
  - `paging.page/totalPages` style
- Updated outbound performance collection to pull **all pages** for:
  - `/call-log`
  - `/message-store`

## D) How to test (tomorrow morning)
1) Smoke test (no credentials needed):
   - `node scripts/tyfys/morning-sales-team-ringcentral-update.mjs --selftest`
2) Real run (dry):
   - `node scripts/tyfys/morning-sales-team-ringcentral-update.mjs --chatId <CHAT_ID> --dry-run`
3) If you want to confirm pagination is working on a high-volume day:
   - Pick a rep/day you know exceeds 1000 events and compare the script’s counts to RingCentral analytics/export.

## E) Scope / risk
- Scope: one script, ~50 LOC net.
- Risk: low. Hard cap `maxPages=25` to avoid infinite loops; still best-effort if RC changes its paging shape.

---
Branch: `chore/2026-02-14-rc-outbound-pagination`
Commit: `5428c13`
Files:
- `scripts/tyfys/morning-sales-team-ringcentral-update.mjs`

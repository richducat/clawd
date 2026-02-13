# PR Draft — Second Brain: Full-text search in ⌘K palette (2026-02-02)

## Title
feat(second-brain): full-text doc search in command palette

## Summary
Second Brain’s command palette (⌘K / Ctrl+K) now supports **full-text search** across markdown docs (title + tags + body content). This makes it much faster to jump to the right TYFYS/process doc even when you only remember a phrase from the middle.

## Branch
`feat/2026-02-02-fulltext-search`

## What I built tonight (2–4 bullets)
- Added a Next.js API route that builds/caches a MiniSearch index of `second-brain/docs/**`.
- Updated the command palette to query that API with a small debounce and display doc hits.
- Kept journal + tag matching local so it still works even if search fails.

## Files changed
- `second-brain/src/app/api/search/route.ts` (new)
- `second-brain/src/app/_components/CommandPalette.tsx`

## How to test (step-by-step)
1) `cd second-brain`
2) `pnpm install` (if needed)
3) `pnpm dev`
4) Open http://localhost:3000
5) Press **⌘K** (or Ctrl+K)
6) Type a term that appears in a doc *body* (not just title), e.g. a distinctive word/phrase from `second-brain/docs/tyfys/README.md`.
7) Verify:
   - Docs appear as results.
   - Arrow keys move selection.
   - Enter navigates to the doc.

## Risk assessment
- Low. Adds a read-only API route and client-side fetch.
- Potential minor risk: indexing cost on first search after a doc edit (mitigated by caching and using max mtime for invalidation).

## Rollback plan
- Revert commit `58a4b3f` on branch `feat/2026-02-02-fulltext-search`.

## Compliance & security check
- No client PII/PHI added.
- Search indexes local markdown docs only; no external API calls.

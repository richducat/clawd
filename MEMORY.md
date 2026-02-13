# MEMORY.md

## Identity / Personal
- Single dad with two kids: Everett (11) and Berkeley (5).
- Berkeley (student ID 2409957): Speech-Language Pathologist for 2025–26 at Quest Elementary is Danielle Ryba (Ryba.Danielle@BrevardSchools.org; 321-242-1411 ext. 48837).
- Dogs with dates: 6/13/14 and 1/30/20.
- Timezone: America/New_York.

## Business
- Runs a small business that helps veterans obtain medical evidence from private doctors to support VA disability claims.
- Website: https://tyfys.net
- Team:
  - Devin Ingelido — front-of-house admin; manages onboarding.
  - Sales team — Adam, Amy, Jared.
  - Karen Hallet — business partner/mentor; handles medical work alongside user.

## How the user wants me to operate
- Be highly proactive: keep user organized and prepared; monitor business; take work off their plate.
- Improve workflow and revenue where possible.
- For changes/builds: create PRs for user to review; do not push live; user will test and commit.
- When writing outbound drafts (emails/messages), bundle multiple drafts together when possible (send them “along with any other drafts” going forward).
- **Email rule (2026-02-10): draft-only simple replies for everyone; do NOT email Karen back.**
- **Email sending policy (2026-02-12): revert to draft-first for all outbound emails until explicitly approved to send (even within normal guardrails), due to risk of incorrect/out-of-policy outreach.**
- **Autonomy rule (2026-02-10): default to acting without asking for clarification; make the best safe assumptions and proceed. Only ask when required for safety/permissions/irreversible actions or to avoid likely costly mistakes.**
- Communication cadence while executing tasks:
  - If the task/project will take **< 10 minutes**, send a progress update **every minute**.
  - If the task/project will take **≥ 10 minutes**, send a progress update **every 3 minutes** (and immediately when major milestones/blocks happen).

## LabStudio / Personal Apps (active)
- LabStudio requirement: **NO mock data** in user-visible UI. Only real DB-backed/integration-backed data; seeding is allowed if it writes to the DB.
- For demos: use temporary Google Calendar under `richducat@gmail.com` for bookings (later migrate to the user’s calendar).

### Deploy + continuity runbook (generalized; learned 2026-02-02)
- Generic runbook: `/Users/richardducat/clawd/docs/RUNBOOK_DEPLOY_GENERIC.md`

### LabStudio deploy + continuity runbook (LabStudio-specific; learned 2026-02-02)
- If changes work locally but not on https://app.labstudio.fit, verify Production is updated (Production may be sourced from **"vercel deploy"** instead of Git).
- Common deploy blocker: Vercel CLI error `Git author <...@Mac.lan> must have access to the team ...`.
  - Fix: set git identity and rewrite commit authors to match the Vercel member email.
    - `git config --global user.name "Richard Ducat"`
    - `git config --global user.email "richducat@gmail.com"`
    - Rewrite authors on branch: `git rebase --root --exec "git commit --amend --no-edit --reset-author"`
    - Then `git push --force-with-lease`
- Vercel CLI workflow (preferred when UI automation fails):
  - `cd labstudio-app && npx vercel link` (scope: EB28 LLC's projects, project: labstudio-app)
  - Deploy + alias to production: `npx vercel --prod --yes` (should print `Aliased: https://app.labstudio.fit`)
- Always write the next-day plan into `memory/YYYY-MM-DD.md` to avoid context loss.

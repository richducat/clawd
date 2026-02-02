# LabStudio App — Deploy Runbook

This is the LabStudio-specific version of the generic runbook:
- See: `/Users/richardducat/clawd/docs/RUNBOOK_DEPLOY_GENERIC.md`

## Goal
Get changes from local → GitHub → Vercel production (https://app.labstudio.fit) reliably, without trial-and-error.

## 0) Know what is “live”
- `https://app.labstudio.fit/*` serves **Vercel Production**.
- Production may be sourced from **"vercel deploy"** (Vercel CLI) or from **Git**. Either can be valid, but you must deploy via the same pipeline.

## 1) Local build sanity
```bash
cd /Users/richardducat/clawd/labstudio-app
npm run build
```

## 2) Push code to GitHub (if using Git pipeline)
Ensure the repo has a remote and branch is pushed.

```bash
cd /Users/richardducat/clawd
git remote -v

git push -u origin <branch>
```

## 3) Vercel CLI setup (recommended)
Link once:
```bash
cd /Users/richardducat/clawd/labstudio-app
npx vercel whoami
npx vercel teams ls
npx vercel link
```
- Choose scope/team: **EB28 LLC's projects**
- Link project: **eb28-llcs-projects/labstudio-app**

Deploy to production:
```bash
npx vercel --prod --yes
```
Expected output includes:
- `Production: https://...vercel.app`
- `Aliased: https://app.labstudio.fit`

## 4) If Vercel blocks deploy: “Git author …@Mac.lan must have access …”
This happens when commits have an author email not recognized as a team member.

Fix:
```bash
git config --global user.name "Richard Ducat"
git config --global user.email "richducat@gmail.com"

# rewrite authors on branch history
cd /Users/richardducat/clawd
git rebase --root --exec "git commit --amend --no-edit --reset-author"

# push rewritten history

git push --force-with-lease
```
Then redeploy:
```bash
cd /Users/richardducat/clawd/labstudio-app
npx vercel --prod --yes
```

## 5) Quick live verification (Toby)
This checks the real production API behavior:
```bash
curl -s -i -X POST https://app.labstudio.fit/api/toby/chat \
  -H 'content-type: application/json' \
  -d '{"message":"My knee feels off"}' | sed -n '1,120p'
```
Look for the strict 4-question gate + mandatory closing.

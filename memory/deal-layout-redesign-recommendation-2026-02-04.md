# TYFYS Zoho Deals — layout redesign recommendation (draft)
Generated: 2026-02-04

## What we found (quick audit)
- Deals module has **152 fields** total.
- In a sample of 30 recent pipeline deals (Intake/Ready/Sent), **87 fields** had any non-empty value.
- Many non-empty fields are either:
  - marketing attribution fields (CPC, campaign, GCLID, etc.)
  - legacy intake checkboxes (lots of false values)
  - operational fields mixed with admin/history fields

### Immediate pain drivers
1) **No single “Action Center”**: key operational fields (what’s next, who owns it, what we’re waiting on) are not grouped at top.
2) **Duplicate concepts** across multiple fields (conditions/disabilities, address/state/zip, statuses).
3) **Too many “always visible” fields** that don’t help daily execution.
4) **Stage-specific needs aren’t reflected in the UI** (Intake should not show Provider fields; Sent-to-Provider should).

## Proposed structure: 6 sections + conditional visibility
The goal is that opening a deal answers in 5 seconds:
- Where is it in the process?
- What’s the next action + due date?
- What are we waiting on?

### Section 1 — ACTION CENTER (always visible, top)
**Fields (keep / add):**
- Stage
- Owner (deal owner)
- **Next_Step (Next Step)** (canonical “what happens next”)
- **Next Action Owner** *(new)*
- **Next Action Due Date** *(new)*
- **Blocker / Waiting On** *(new picklist: Client, Provider, TYFYS, Records, Payment, Other)*
- Priority *(new or reuse if exists)*
- Provider (if Stage ≥ Ready)
- Last Activity Time (read-only)

**Why:** this is what Devin/Karen/Richard need constantly.

### Section 2 — CLIENT SNAPSHOT
- Contact Name
- Email Address
- Phone Number
- City/State
- State
- Zip_code
- TimeZone

**Rule:** Address should live in one place. If Contact is the “truth,” sync it into Deal fields automatically.

### Section 3 — NEEDS / CONTENTIONS
**Consolidate/standardize these:**
- Conditions / disabilities (choose ONE canonical field)
- “Primary Need Categories” *(new multi-select: Back/Spine, Neck, Toxic Exposure, PTSD, Mental Health, Sleep Apnea, TBI, Migraines, Ortho/MSK, etc.)*
- Optional: DBQ list (if you track explicit DBQs)

### Section 4 — DOCUMENTS / INTAKE
- Intake call doc link
- DBQ prep doc link
- Evidence packet link
- Required docs checklist (keep only the few that matter operationally)

**Stage visibility:** visible in Intake/Ready; collapsed in Sent-to-Provider.

### Section 5 — PROVIDER (only in Ready/Sent)
- Provider
- Provider assignment date
- Due date / expected turnaround
- Provider notes

### Section 6 — FINANCE + ADMIN (collapsed)
- Invoice/payment status fields
- Ad attribution fields
- System fields

## Blueprint / validation (prevents mess)
- Stage transition “Ready for Provider → Sent to Provider” requires:
  - Provider selected
  - Due date set
  - Next Action Due Date set
  - Blocker set if waiting

## Quick wins we can do this week (low risk)
1) Create **new layout** that reorders/hides fields (no data migration yet).
2) Add **Next Action Owner / Next Action Due Date / Blocker**.
3) Add conditional section visibility based on Stage.
4) Add simple automation to keep Deal State/Zip in sync from Contact when present.

## What I need from you
1) Confirm: is `Next_Step` the canonical next step field? (it’s a text field in Zoho settings).
2) Confirm: who should default as Next Action Owner by stage?
   - Intake: Devin?
   - Ready/Sent: Karen?
   - Exceptions: provider transition tasks already go to Karen.

## Deliverables (next)
- A concrete **field hide/keep list** (exported from Zoho settings) with rationale.
- A proposed Deal layout mock (ordered sections) + which stages show which sections.

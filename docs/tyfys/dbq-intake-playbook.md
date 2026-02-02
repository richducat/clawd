# TYFYS DBQ Intake Playbook (Ops)

**Goal:** every DBQ that arrives by email is (1) attached to the correct Zoho CRM record(s), (2) reflected in readiness, and (3) triggers the next task—**same business day**.

## Compliance + safety
- This playbook supports **coordination + documentation** only.
- Treat all veteran info as sensitive. Avoid copying PHI into notes.
- Use Zoho record IDs where possible; keep email forwarding minimal.

## Roles
- **Devin (default owner):** executes DBQ Intake queue twice daily; updates CRM fields; creates tasks.
- **Karen:** confirms clinical workflow readiness and vendor follow-ups.
- **Richard:** resolves any "can’t match to client" exceptions and sets priority for client-prep days.

## Definition of Done (DoD)
For each inbound DBQ email, within **4 business hours** (or by EOD):
1) Attach DBQ PDF(s) to the right **Lead/Contact/Deal** record in Zoho CRM
2) Set CRM field(s):
   - `DBQ Received = Yes`
   - `DBQ Received Date = YYYY-MM-DD`
   - `DBQ Source/Vendor = <vendor>`
3) Create a task:
   - **Task name:** `Review DBQ + update readiness`
   - **Owner:** Karen
   - **Due:** next business day
4) Internal ping to Karen:
   - “DBQ received + linked (client(s): …). Please review/mark readiness.”

## Intake cadence
- **10:00 AM ET:** process new DBQs
- **3:00 PM ET:** second pass
- **Tue/Thu:** add a **7:45 AM ET** quick pass (client-prep readiness)

## Gmail setup
### Label
Create label: `TYFYS/DBQ Inbound`

### Filter logic
Apply label when:
- From matches known vendor domains/emails (Suntree, Rivers of Hope/Genesis, NeuraHealth, etc.)
- Subject contains `DBQ` OR attachments include `DBQ` in filename

> See: `docs/tyfys/gmail-filter-dbq-inbound.xml` (importable Gmail filter example)

## DBQ Intake SOP (Devin)
1) Open Gmail label **TYFYS/DBQ Inbound**.
2) For each message:
   - Download attachments.
   - Rename locally using:
     - `ClientLast_ClientFirst_DBQ_<Vendor>_YYYY-MM-DD.pdf`
   - Identify correct Zoho record:
     - Search by email/phone or Lead/Contact name.
   - Attach the PDF(s) to the Zoho record.
   - Update CRM fields (see `docs/tyfys/zoho-fields-dbq.md`).
   - Create the Karen review task.
3) If **cannot match** within 5 minutes:
   - Create a task: `DBQ match needed (email received)`
   - Owner: Richard
   - Due: same day
   - Add a short note: vendor + received timestamp (no PHI)

## Exception handling
- **Multiple DBQs in one email:** process each separately; ensure each is attached to the right record.
- **Wrong/unclear client:** do not guess—escalate to Richard.
- **Duplicates:** still attach (if unsure), but note in task “possible duplicate”.

## Metrics (simple)
Track weekly:
- DBQs received
- % attached same day
- Median time from email received → Zoho attached
- # exceptions

## Client-ready signal
Once Karen reviews:
- Update: `Client Prep Ready = Yes` (or equivalent) + next appointment target.

---
**Next automation step (future):** automatically create a Zoho task from Gmail label and parse attachment filenames—only after access is confirmed and PHI handling rules are approved.

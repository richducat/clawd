# Zoho CRM – DBQ Intake Fields (Proposed)

Purpose: make DBQ receipt and readiness **queryable**, not buried in email.

## Recommended fields (Leads and/or Deals)
- **DBQ Received** (boolean)
- **DBQ Received Date** (date)
- **DBQ Vendor / Source** (picklist)
  - Suntree
  - Rivers of Hope / Genesis
  - NeuraHealth
  - Other (free text optional)
- **DBQ Count Received** (number, optional)
- **DBQ Notes (internal)** (short text; avoid PHI)

## Task template
- **Name:** Review DBQ + update readiness
- **Owner:** Karen
- **Due:** next business day
- **Description:** “DBQ received and attached in CRM. Confirm readiness + any missing items.”

## Views / Reports
- "DBQ Received Today"
- "DBQ Received – Needs Karen Review" (DBQ Received = Yes AND Readiness not updated)
- "Client Prep Ready" (Tue/Thu list)

## Minimal change version (if fields already exist)
If you already have `Day 1 SMS Sent`-style fields, mirror that pattern:
- `DBQ_Received` + `DBQ_Received_At`


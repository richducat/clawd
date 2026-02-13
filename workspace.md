# workspace.md — OpenClaw on Richard’s desk (TYFYS + personal)

This file is the "single source of truth" reference for how this OpenClaw instance is set up.

## 0) Hardware + access
- Host machine: Richard’s MacBook Pro (always-on, desk)
- Remote access: Tailscale serve for Gateway; SSH available

## 1) Interfaces (how we talk to OpenClaw)
### Telegram (primary)
- Primary interface for Richard.

### Slack (secondary, narrow)
- Enabled via Socket Mode.
- Only 2 channels are allowlisted:
  - C0AEUS1FYTW
  - C0AEJREP291
- Require @mention.
- DMs disabled.

## 2) Sessions + memory
- Session resets are **idle-based**, not daily:
  - session.reset.mode = idle
  - session.reset.idleMinutes ≈ 1 year
- Durable memory lives in:
  - MEMORY.md (curated long-term)
  - memory/YYYY-MM-DD.md (daily logs)

## 3) Backups
### GitHub
- Hourly auto-sync commits and pushes for repos inside this workspace.

### Google Drive
- Nightly OpenClaw state bundle copied into local Drive sync folder:
  - ~/Library/CloudStorage/GoogleDrive-richducat@gmail.com/My Drive/OpenClaw Backups/

## 4) TYFYS automations (high level)
- Zoho + RingCentral automations live in scripts/tyfys
- Key state files live in memory/

## 5) Guardrails
### Email
- Draft-first by default. Do not auto-send unless Richard explicitly approves.
- Never send for finance/cancel/upset/legal-ish threads.
- Never email Karen back (unless explicitly authorized for a specific campaign).

### REP-SAFE
- Rep-safe outputs exclude financials, internal cashflow, and personal/kids/court content.

## 6) Roadmap (replicate the full transcript system)
Next builds (in order):
1) Daily markdown audit (keep configs/docs aligned)
2) Hybrid DB standard (SQLite + embeddings) for CRM/KB/Ops
3) Daily Gmail+Calendar ingestion → CRM
4) Knowledge base ingestion (URLs/files) → KB DB
5) Meeting prep brief (daily)


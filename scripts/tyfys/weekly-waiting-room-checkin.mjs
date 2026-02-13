#!/usr/bin/env node
/**
 * TYFYS Weekly Waiting Room Check-in
 *
 * Goal: reduce churn during provider wait (2–6 weeks) by sending a calm weekly
 * check-in email to Deals in waiting stages.
 *
 * Stages in scope (per Richard):
 * - Intake (Document Collection)
 * - Ready for Provider
 * - Sent to Provider
 *
 * Throttle:
 * - Skip if Last_Time_Contacted is within the last N days (default 5)
 *
 * Escalation:
 * - If we detect “refund/cancel/chargeback/double charged/why was I charged”
 *   in recent inbound emails from the client, do NOT send check-in; instead
 *   create a Zoho Task assigned to Karen (financial) or Richard (service).
 *
 * Usage:
 *   node scripts/tyfys/weekly-waiting-room-checkin.mjs --dry-run
 *   node scripts/tyfys/weekly-waiting-room-checkin.mjs --send
 *
 * Env:
 * - GMAIL_ACCOUNT (default richard@thankyouforyourservice.co)
 * - KAREN_ZOHO_USER_ID (default from fulfillment-tasker)
 * - RICHARD_ZOHO_USER_ID (required for service escalations)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { loadEnvLocal } from '../lib/load-env-local.mjs';
import { getZohoAccessToken, zohoCrmCoql, zohoCrmPost, zohoCrmPut } from '../lib/zoho.mjs';

loadEnvLocal();
process.stdout.on('error', () => {});

function getArg(name, def) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return def;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return def;
  return v;
}

const send = process.argv.includes('--send');
const dryRun = process.argv.includes('--dry-run') || !send;

const apiDomain = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';
const zohoToken = await getZohoAccessToken();

const GMAIL_ACCOUNT = process.env.GMAIL_ACCOUNT || 'devin@thankyouforyourservice.co';

// CC list (per Richard): always CC Karen + Richard.
const CC_KAREN_EMAIL = process.env.CC_KAREN_EMAIL || 'karen@thankyouforyourservice.co';
const CC_RICHARD_EMAIL = process.env.CC_RICHARD_EMAIL || 'richard@thankyouforyourservice.co';

// Escalation owners in Zoho
const KAREN_ID = process.env.KAREN_ZOHO_USER_ID || '6748611000000782001';
const RICHARD_ID = process.env.RICHARD_ZOHO_USER_ID || '6748611000000588015';

const daysNoContact = Number(getArg('--daysNoContact', '5'));
const lookbackDays = Number(getArg('--lookbackDays', '21'));

const STAGES = [
  'Intake (Document Collection)',
  'Ready for Provider',
  'Sent to Provider',
];

const FINANCE_KWS = [
  'refund',
  'chargeback',
  'double charged',
  'why was i charged',
  'why was i chraged',
  'why was i charged?',
];
const SERVICE_KWS = [
  'cancel',
];

const STATE_PATH = path.resolve('memory/tyfys-weekly-waiting-room-checkin.json');

async function readState() {
  try { return JSON.parse(await fs.readFile(STATE_PATH, 'utf8')); }
  catch { return { sent: {}, escalated: {} }; }
}
async function writeState(s) {
  if (dryRun) return;
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fs.writeFile(STATE_PATH, JSON.stringify(s, null, 2) + '\n', 'utf8');
}

function fmtYmdET(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function sh(cmd, args, { json = false } = {}) {
  const fullArgs = [...args];
  if (json) fullArgs.unshift('--json');
  const res = spawnSync(cmd, fullArgs, { encoding: 'utf8' });
  if (res.status !== 0) {
    const msg = res.stderr || res.stdout || `Command failed: ${cmd} ${fullArgs.join(' ')}`;
    throw new Error(msg);
  }
  return res.stdout;
}

function escZoho(s) {
  return String(s || '').replace(/'/g, "\\'");
}

function daysSince(dateLike) {
  if (!dateLike) return Infinity;
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return Infinity;
  return (Date.now() - d.getTime()) / (24 * 3600 * 1000);
}

function parseLastTimeContactedField(v) {
  // Last_Time_Contacted is a text field (per fulfillment-tasker). It might be yyyy-mm-dd.
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  // Try yyyy-mm-dd first.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00-05:00`);
  // Fallback: Date parse.
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function buildEmail({ firstName }) {
  const name = firstName ? ` ${firstName}` : '';
  const subject = 'Quick check-in — we’re still on it';
  const body = `Hi${name},\n\nJust checking in to let you know we’re still here and actively working on your case. Some appointments and updates can take a few weeks depending on provider availability — as soon as we have the next update and can book your next appointment (or next step), we’ll reach out right away.\n\nIn the meantime, if anything changed on your end (new records, new decision letters, new symptoms, or new contact info), you can reply to this email and send it over — it helps us move faster.\n\nWe appreciate your patience,\nThank You For Your Service\n`;
  return { subject, body };
}

async function writeTempBodyFile({ dealId, body }) {
  const dir = path.resolve('memory/email-out');
  await fs.mkdir(dir, { recursive: true });
  const p = path.join(dir, `waiting-room-checkin-${dealId}-${Date.now()}.txt`);
  await fs.writeFile(p, body, 'utf8');
  return p;
}

function guessFirstNameFromDealName(dealName) {
  const s = String(dealName || '').trim();
  if (!s) return '';
  // Deals often look like “First Last”
  const first = s.split(/\s+/)[0];
  if (!first) return '';
  if (first.length > 25) return '';
  return first;
}

async function createZohoTask({ ownerId, whatId, subject, description }) {
  const dueDate = fmtYmdET(new Date());
  const payload = {
    data: [{
      Subject: subject,
      Due_Date: dueDate,
      Owner: ownerId,
      What_Id: whatId,
      $se_module: 'Deals',
      Description: description,
      Status: 'Not Started',
      Priority: 'High',
    }],
  };

  if (dryRun) {
    process.stdout.write(`[dry-run] create task owner=${ownerId} deal=${whatId} subj=${subject}\n`);
    return { id: 'dry-task' };
  }

  const res = await zohoCrmPost({ accessToken: zohoToken, apiDomain, path: '/crm/v2/Tasks', json: payload });
  const id = res?.data?.[0]?.details?.id;
  if (!id) throw new Error(`Task create failed: ${JSON.stringify(res)}`);
  return { id };
}

async function addDealNote({ dealId, content }) {
  const payload = {
    data: [{
      Note_Title: 'Automation',
      Note_Content: content,
      Parent_Id: dealId,
      se_module: 'Deals',
    }],
  };

  if (dryRun) {
    process.stdout.write(`[dry-run] add note deal=${dealId}: ${content.slice(0, 80)}...\n`);
    return;
  }

  await zohoCrmPost({ accessToken: zohoToken, apiDomain, path: '/crm/v2/Notes', json: payload });
}

async function updateLastTimeContacted({ dealId }) {
  const ymd = fmtYmdET(new Date());
  const payload = { data: [{ id: dealId, Last_Time_Contacted: ymd }] };
  if (dryRun) {
    process.stdout.write(`[dry-run] update deal=${dealId} Last_Time_Contacted=${ymd}\n`);
    return;
  }
  await zohoCrmPut({ accessToken: zohoToken, apiDomain, path: '/crm/v2/Deals', json: payload });
}

function searchRecentInboundKeywords({ clientEmail }) {
  // Return { kind: 'finance'|'service'|null, hits: [...] }
  if (!clientEmail || !String(clientEmail).includes('@')) return { kind: null, hits: [] };

  const newerThan = `newer_than:${Math.max(1, lookbackDays)}d`;
  const from = `from:${clientEmail}`;
  const inInbox = `in:inbox`;

  const financeQuery = `${inInbox} ${from} (${FINANCE_KWS.map(k => `\"${k}\"`).join(' OR ')}) ${newerThan}`;
  const serviceQuery = `${inInbox} ${from} (${SERVICE_KWS.map(k => `\"${k}\"`).join(' OR ')}) ${newerThan}`;

  // Try finance first.
  const financeJson = sh('gog', ['gmail', 'messages', 'search', financeQuery, '--max', '5', '--account', GMAIL_ACCOUNT], { json: true });
  const finance = JSON.parse(financeJson || '{}');
  const financeMsgs = Array.isArray(finance) ? finance : (finance?.messages || []);
  if (financeMsgs.length) return { kind: 'finance', hits: FINANCE_KWS };

  const serviceJson = sh('gog', ['gmail', 'messages', 'search', serviceQuery, '--max', '5', '--account', GMAIL_ACCOUNT], { json: true });
  const service = JSON.parse(serviceJson || '{}');
  const serviceMsgs = Array.isArray(service) ? service : (service?.messages || []);
  if (serviceMsgs.length) return { kind: 'service', hits: SERVICE_KWS };

  return { kind: null, hits: [] };
}

async function main() {
  const state = await readState();

  const stageList = STAGES.map(s => `'${escZoho(s)}'`).join(',');

  // We want to hit as many in-scope deals as possible, so we do NOT restrict
  // by Modified_Time window here. Instead, page through results.
  const pageSize = 200;
  const maxDeals = Number(getArg('--maxDeals', '2000'));

  const deals = [];
  for (let offset = 0; offset < maxDeals; offset += pageSize) {
    const q = `select id, Deal_Name, Stage, Email_Address, Last_Time_Contacted, Last_Activity_Time from Deals where Stage in (${stageList}) order by Modified_Time desc limit ${pageSize} offset ${offset}`;
    const res = await zohoCrmCoql({ accessToken: zohoToken, apiDomain, selectQuery: q });
    const batch = res?.data || [];
    if (!batch.length) break;
    deals.push(...batch);
    if (batch.length < pageSize) break;
  }

  let considered = 0;
  let emailed = 0;
  let skippedRecent = 0;
  let skippedNoEmail = 0;
  let escalated = 0;

  const todayKey = fmtYmdET(new Date());

  for (const d of deals) {
    considered += 1;

    const dealId = String(d.id);
    const email = String(d.Email_Address || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      skippedNoEmail += 1;
      continue;
    }

    // Respect throttle.
    // IMPORTANT: only count *our outbound contact*.
    // Do NOT use Last_Activity_Time because it can reflect inbound client activity
    // (or automation updates) without us responding.
    const lastText = d.Last_Time_Contacted;
    const lastParsed = parseLastTimeContactedField(lastText);
    const days = daysSince(lastParsed);
    if (days < daysNoContact) {
      skippedRecent += 1;
      continue;
    }

    // Avoid double-sending same day.
    const sentKey = `${dealId}:${todayKey}`;
    if (state.sent[sentKey]) continue;

    // Escalation keyword scan.
    const kw = searchRecentInboundKeywords({ clientEmail: email });
    if (kw.kind) {
      const ownerId = kw.kind === 'finance' ? KAREN_ID : RICHARD_ID;
      if (!ownerId) {
        process.stdout.write(`WARN: escalation needed (${kw.kind}) but missing ownerId for deal ${dealId} (${d.Deal_Name})\n`);
      } else {
        const subj = kw.kind === 'finance'
          ? 'Client financial concern email — please review'
          : 'Client service/cancellation concern email — please review';
        const desc = `Deal: ${d.Deal_Name}\nStage: ${d.Stage}\nClient email: ${email}\n\nDetected keywords indicating ${kw.kind} concern in recent inbound email(s). Please open Gmail thread and respond/escalate appropriately.`;

        await createZohoTask({ ownerId, whatId: dealId, subject: subj, description: desc });
        if (!dryRun) state.escalated[sentKey] = { kind: kw.kind, at: new Date().toISOString() };
        escalated += 1;
      }
      continue;
    }

    const firstName = guessFirstNameFromDealName(d.Deal_Name);
    const { subject, body } = buildEmail({ firstName });

    if (dryRun) {
      process.stdout.write(`[dry-run] would email deal=${dealId} to=${email} stage=${d.Stage} subj=${subject}\n`);
    } else {
      const bodyPath = await writeTempBodyFile({ dealId, body });
      sh('gog', [
        'gmail', 'send',
        '--to', email,
        '--cc', CC_KAREN_EMAIL,
        '--cc', CC_RICHARD_EMAIL,
        '--subject', subject,
        '--body-file', bodyPath,
        '--account', GMAIL_ACCOUNT,
      ], { json: false });
    }

    await addDealNote({ dealId, content: `Weekly waiting-room check-in email sent (${todayKey}).` });
    await updateLastTimeContacted({ dealId });

    state.sent[sentKey] = { at: new Date().toISOString(), to: email, stage: d.Stage };
    emailed += 1;
  }

  await writeState(state);

  process.stdout.write(`Done. dryRun=${dryRun} deals_considered=${considered} emailed=${emailed} escalated=${escalated} skipped_recent=${skippedRecent} skipped_no_email=${skippedNoEmail}\n`);

  if (dryRun && !RICHARD_ID) {
    process.stdout.write('NOTE: set env RICHARD_ZOHO_USER_ID to enable service escalations to Richard.\n');
  }
}

await main();

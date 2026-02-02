#!/usr/bin/env node
/**
 * TYFYS Fulfillment Tasker (Devin + Karen)
 *
 * Ensures the 5 top-of-deal fields are filled and creates Zoho Tasks
 * so fulfillment + provider handoffs execute without Richard.
 *
 * Uses Deals module.
 *
 * Fields (confirmed):
 * - Veteran Live Status: Veteran_Live_Status
 * - Next Step: Next_Step
 * - Last Time Contacted: Last_Time_Contacted (text) + Last_Activity_Time (datetime exists)
 * - Appointment Status: Appointment_Status
 * - Provider: Provider (multiselectpicklist)
 *
 * Owners:
 * - Devin Ingelido: 6748611000011254001
 * - Karen Hallet: 6748611000000782001
 *
 * Usage:
 *   node scripts/tyfys/fulfillment-tasker.mjs --dry-run
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { loadEnvLocal } from '../lib/load-env-local.mjs';
import { getZohoAccessToken, zohoCrmCoql, zohoCrmPost } from '../lib/zoho.mjs';

loadEnvLocal();
process.stdout.on('error', () => {});

const dryRun = process.argv.includes('--dry-run');
const apiDomain = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';
const zohoToken = await getZohoAccessToken();

const DEVIN_ID = '6748611000011254001';
const KAREN_ID = '6748611000000782001';

const STATE_PATH = path.resolve('memory/tyfys-fulfillment-tasker.json');

async function readState() {
  try { return JSON.parse(await fs.readFile(STATE_PATH,'utf8')); }
  catch { return { createdTasks: {} }; }
}
async function writeState(s) {
  if (dryRun) return; // never persist dry-run output
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fs.writeFile(STATE_PATH, JSON.stringify(s, null, 2) + '\n', 'utf8');
}

function pickOwnerForDeal(deal) {
  const stage = (deal.Stage || '').toLowerCase();
  const provider = deal.Provider;
  // If provider assigned or stage indicates provider handoff => Karen
  if (provider && Array.isArray(provider) ? provider.length : String(provider||'').trim()) return KAREN_ID;
  if (stage.includes('ready for provider') || stage.includes('sent to provider')) return KAREN_ID;
  // Otherwise Devin
  return DEVIN_ID;
}

function missingFields(deal) {
  const missing = [];
  if (!String(deal.Veteran_Live_Status || '').trim()) missing.push('Veteran Live Status');
  if (!String(deal.Next_Step || '').trim()) missing.push('Next Step');
  if (!String(deal.Last_Time_Contacted || '').trim()) missing.push('Last Time Contacted');
  if (!String(deal.Appointment_Status || '').trim()) missing.push('Appointment Status');
  const prov = deal.Provider;
  const provHas = Array.isArray(prov) ? prov.length > 0 : !!String(prov || '').trim();
  if (!provHas) missing.push('Provider');
  return missing;
}

async function createTask({ subject, dueDate, ownerId, whatId, description }) {
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
    }]
  };

  if (dryRun) {
    process.stdout.write(`[dry-run] create task owner=${ownerId} what=${whatId} due=${dueDate} subj=${subject}\n`);
    return { id: `dry-${Math.random().toString(16).slice(2)}` };
  }

  const res = await zohoCrmPost({ accessToken: zohoToken, apiDomain, path: '/crm/v2/Tasks', json: payload });
  const id = res?.data?.[0]?.details?.id;
  if (!id) throw new Error(`Task create failed: ${JSON.stringify(res)}`);
  return { id };
}

async function main() {
  const state = await readState();

  // Pull relevant deals updated recently.
  const isoZoho = (d) => d.toISOString().replace(/\.\d{3}Z$/, '+00:00');
  const sinceIso = isoZoho(new Date(Date.now() - 14 * 24 * 3600 * 1000));

  // Zoho COQL has strict limits; keep this query narrow.
  const q = `select id, Deal_Name, Stage, Modified_Time, Last_Activity_Time, Veteran_Live_Status, Next_Step, Last_Time_Contacted, Appointment_Status, Provider from Deals where Modified_Time >= '${sinceIso}' limit 200`;
  const res = await zohoCrmCoql({ accessToken: zohoToken, apiDomain, selectQuery: q });
  const deals = res?.data || [];

  let created = 0;

  for (const d of deals) {
    const miss = missingFields(d);
    if (miss.length === 0) continue;

    const ownerId = pickOwnerForDeal(d);
    const dealId = String(d.id);

    // Avoid spamming: one “missing top fields” task per deal per day.
    const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
    const key = `${dealId}:${dayKey}`;
    if (state.createdTasks[key]) continue;

    const subj = `Fill required top fields (${miss.join(', ')})`;
    const due = dayKey; // due today
    const desc = `Deal: ${d.Deal_Name}\nStage: ${d.Stage || ''}\nMissing: ${miss.join(', ')}\n\nRule: these 5 fields must always be filled: Veteran Live Status, Next Step, Last Time Contacted, Appointment Status, Provider.`;

    const t = await createTask({ subject: subj, dueDate: due, ownerId, whatId: dealId, description: desc });
    state.createdTasks[key] = { taskId: t.id, at: new Date().toISOString(), ownerId, missing: miss };
    created += 1;
  }

  await writeState(state);
  process.stdout.write(`Done. dryRun=${dryRun} deals_scanned=${deals.length} tasks_created=${created}\n`);
}

await main();

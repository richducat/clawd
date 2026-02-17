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
 *   node scripts/tyfys/fulfillment-tasker.mjs --sinceDays 14 --limit 200
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { loadEnvLocal } from '../lib/load-env-local.mjs';
import { getZohoAccessToken, zohoCrmCoql, zohoCrmPost } from '../lib/zoho.mjs';

loadEnvLocal();
process.stdout.on('error', () => {});

function getArg(name, def) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return def;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return def;
  return v;
}

const dryRun = process.argv.includes('--dry-run');
const sinceDays = Number(getArg('--sinceDays', '14'));
const limit = Number(getArg('--limit', '200'));

const apiDomain = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';
const zohoToken = await getZohoAccessToken();

const DEVIN_ID = '6748611000011254001';
const KAREN_ID = '6748611000000782001';

const STATE_PATH = path.resolve('memory/tyfys-fulfillment-tasker.json');

async function readState() {
  try {
    const s = JSON.parse(await fs.readFile(STATE_PATH, 'utf8'));

    // Back-compat migration:
    // Old format: createdTasks[`${dealId}:${dayKey}`] = ...
    if (!s.createdTasksByDeal) s.createdTasksByDeal = {};
    if (s.createdTasks && typeof s.createdTasks === 'object') {
      for (const [k, v] of Object.entries(s.createdTasks)) {
        const dealId = String(k).split(':')[0];
        if (!dealId) continue;
        // Keep the most recent entry we see (file is chronological-ish).
        s.createdTasksByDeal[dealId] = v;
      }
    }

    return s;
  } catch {
    return {
      // createdTasksByDeal: dealId -> { taskId, at, ownerId, missing }
      // We track by deal (not by day) to avoid creating repeat tasks day-after-day.
      createdTasksByDeal: {},
    };
  }
}
async function writeState(s) {
  if (dryRun) return; // never persist dry-run output
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fs.writeFile(STATE_PATH, JSON.stringify(s, null, 2) + '\n', 'utf8');
}

function providerIsSet(provider) {
  return Array.isArray(provider) ? provider.length > 0 : !!String(provider || '').trim();
}

function shouldRequireProvider(deal) {
  // Provider should not be required on early-stage deals, otherwise this script
  // spams tasks that can’t be satisfied yet.
  const stage = String(deal.Stage || '').toLowerCase();
  const appt = String(deal.Appointment_Status || '').toLowerCase();

  // If the pipeline stage is explicitly provider-related, require it.
  if (stage.includes('provider')) return true;

  // If appointment is meaningfully scheduled/completed, require provider.
  // (Loose matching; we avoid depending on exact picklist values.)
  if (/(sched|scheduled|confirmed|completed|attended|no show|noshow)/i.test(appt)) return true;

  return false;
}

function pickOwnerForDeal(deal) {
  const stage = String(deal.Stage || '').toLowerCase();
  const provider = deal.Provider;
  const requireProvider = shouldRequireProvider(deal);

  // If provider assigned, or deal is in provider-related stage => Karen
  if (providerIsSet(provider)) return KAREN_ID;
  if (requireProvider || stage.includes('ready for provider') || stage.includes('sent to provider')) return KAREN_ID;

  // Otherwise Devin
  return DEVIN_ID;
}

function missingFields(deal) {
  const missing = [];
  if (!String(deal.Veteran_Live_Status || '').trim()) missing.push('Veteran Live Status');
  if (!String(deal.Next_Step || '').trim()) missing.push('Next Step');
  if (!String(deal.Last_Time_Contacted || '').trim()) missing.push('Last Time Contacted');
  if (!String(deal.Appointment_Status || '').trim()) missing.push('Appointment Status');

  const provHas = providerIsSet(deal.Provider);
  if (shouldRequireProvider(deal) && !provHas) missing.push('Provider');

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
  const sinceIso = isoZoho(new Date(Date.now() - sinceDays * 24 * 3600 * 1000));

  async function findExistingOpenTopFieldsTask(dealId) {
    // Prevent redundant tasks even if local state was lost or the script ran elsewhere.
    // Zoho COQL: keep narrow + safe.
    const q = `select id, Subject, Status, Owner, Created_Time from Tasks where What_Id = '${dealId}' and Subject like 'Fill required top fields (%' and Status != 'Completed' order by Created_Time desc limit 1`;
    const r = await zohoCrmCoql({ accessToken: zohoToken, apiDomain, selectQuery: q }).catch(() => null);
    const t = r?.data?.[0];
    return t ? { id: String(t.id), status: t.Status, subject: t.Subject } : null;
  }

  // Zoho COQL has strict limits; keep this query narrow.
  const q = `select id, Deal_Name, Stage, Modified_Time, Last_Activity_Time, Veteran_Live_Status, Next_Step, Last_Time_Contacted, Appointment_Status, Provider from Deals where Modified_Time >= '${sinceIso}' order by Modified_Time desc limit ${Math.min(limit || 200, 200)}`;
  const res = await zohoCrmCoql({ accessToken: zohoToken, apiDomain, selectQuery: q });
  const deals = res?.data || [];

  const dayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  let created = 0;
  let skippedAlreadyCreated = 0;
  let skippedZohoExisting = 0;
  const createdItems = [];

  for (const d of deals) {
    const miss = missingFields(d);
    if (miss.length === 0) continue;

    const ownerId = pickOwnerForDeal(d);
    const dealId = String(d.id);

    // Avoid spamming: only one open “missing top fields” task per deal.
    if (state.createdTasksByDeal?.[dealId]) {
      skippedAlreadyCreated += 1;
      continue;
    }

    const existing = await findExistingOpenTopFieldsTask(dealId);
    if (existing?.id) {
      state.createdTasksByDeal[dealId] = {
        taskId: existing.id,
        at: new Date().toISOString(),
        ownerId,
        missing: miss,
        note: 'Found existing open task in Zoho (dedupe)'
      };
      skippedZohoExisting += 1;
      continue;
    }

    const subj = `Fill required top fields (${miss.join(', ')})`;
    const due = dayKey; // due today
    const providerRule = shouldRequireProvider(d)
      ? 'Provider is required at this stage.'
      : 'Provider is NOT required yet (until appointment/provider stage).';

    const desc = `Deal: ${d.Deal_Name}\nStage: ${d.Stage || ''}\nMissing: ${miss.join(', ')}\n\nRule: Always fill Veteran Live Status, Next Step, Last Time Contacted, Appointment Status.\n${providerRule}`;

    const t = await createTask({ subject: subj, dueDate: due, ownerId, whatId: dealId, description: desc });
    state.createdTasksByDeal[dealId] = { taskId: t.id, at: new Date().toISOString(), ownerId, missing: miss };
    createdItems.push({ dealName: d.Deal_Name, dealId, ownerId, missing: miss, taskId: t.id });
    created += 1;
  }

  await writeState(state);

  process.stdout.write(
    `Done. dryRun=${dryRun} deals_scanned=${deals.length} tasks_created=${created} skipped_already_created=${skippedAlreadyCreated} skipped_existing_open_task_in_zoho=${skippedZohoExisting} day=${dayKey} sinceDays=${sinceDays}\n`
  );

  for (const item of createdItems.slice(0, 25)) {
    process.stdout.write(
      `- task=${item.taskId} owner=${item.ownerId} deal=${item.dealName} (${item.dealId}) missing=[${item.missing.join(', ')}]\n`
    );
  }
}

await main();

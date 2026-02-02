#!/usr/bin/env node
/**
 * TYFYS Provider Handoff Tasker (Karen)
 *
 * Creates Zoho Tasks to ensure provider assignment + packet send + follow-ups
 * happen without Richard.
 *
 * Stages (exact):
 * - Intake (Document Collection)
 * - Ready for Provider
 * - Sent to Provider
 *
 * Uses Provider field (multiselectpicklist) as assignment signal.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { loadEnvLocal } from '../lib/load-env-local.mjs';
import { getZohoAccessToken, zohoCrmCoql, zohoCrmPost, zohoCrmGet } from '../lib/zoho.mjs';

loadEnvLocal();
process.stdout.on('error', () => {});

const dryRun = process.argv.includes('--dry-run');
const apiDomain = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';
const zohoToken = await getZohoAccessToken();

const KAREN_ID = '6748611000000782001';
const STATE_PATH = path.resolve('memory/tyfys-provider-handoff-tasker.json');

const isoZoho = (d) => d.toISOString().replace(/\.\d{3}Z$/, '+00:00');
const todayEt = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());

async function readState() {
  try { return JSON.parse(await fs.readFile(STATE_PATH,'utf8')); }
  catch { return { createdTasks: {} }; }
}
async function writeState(s) {
  if (dryRun) return;
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  await fs.writeFile(STATE_PATH, JSON.stringify(s, null, 2) + '\n', 'utf8');
}

async function fetchAllRelated({ dealId, rel, perPage = 200, maxPages = 10 }) {
  let page = 1;
  let out = [];
  for (;;) {
    const qs = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    const j = await zohoCrmGet({ accessToken: zohoToken, apiDomain, pathAndQuery: `/crm/v2/Deals/${dealId}/${rel}?${qs.toString()}` });
    const data = j.data || [];
    out = out.concat(data);
    if (!j.info?.more_records) break;
    page += 1;
    if (page > maxPages) break;
  }
  return out;
}

function dealFileHealthSummary({ tasks, notes, attachments }) {
  const openTasks = (tasks || []).filter(t => !['Completed', 'Closed'].includes(String(t.Status || '')));
  const overdue = openTasks.filter(t => t.Due_Date && new Date(t.Due_Date).getTime() < Date.now());
  const lastNote = (notes || []).map(n => n.Modified_Time || n.Created_Time).filter(Boolean).sort().slice(-1)[0] || '';
  const lastAttach = (attachments || []).map(a => a.Modified_Time || a.Created_Time).filter(Boolean).sort().slice(-1)[0] || '';
  return {
    openTasksCount: openTasks.length,
    overdueTasksCount: overdue.length,
    notesCount: (notes || []).length,
    attachmentsCount: (attachments || []).length,
    lastNote,
    lastAttach,
  };
}

async function getDealFileHealth(dealId) {
  const [tasks, notes, attachments] = await Promise.all([
    fetchAllRelated({ dealId, rel: 'Tasks' }),
    fetchAllRelated({ dealId, rel: 'Notes' }),
    fetchAllRelated({ dealId, rel: 'Attachments' }),
  ]);
  return dealFileHealthSummary({ tasks, notes, attachments });
}

async function createTask({ subject, dueDate, whatId, description }) {
  const payload = {
    data: [{
      Subject: subject,
      Due_Date: dueDate,
      Owner: KAREN_ID,
      What_Id: whatId,
      $se_module: 'Deals',
      Description: description,
      Status: 'Not Started',
      Priority: 'High',
    }]
  };

  if (dryRun) {
    process.stdout.write(`[dry-run] create task what=${whatId} due=${dueDate} subj=${subject}\n`);
    return { id: `dry-${Math.random().toString(16).slice(2)}` };
  }

  const res = await zohoCrmPost({ accessToken: zohoToken, apiDomain, path: '/crm/v2/Tasks', json: payload });
  const id = res?.data?.[0]?.details?.id;
  if (!id) throw new Error(`Task create failed: ${JSON.stringify(res)}`);
  return { id };
}

function providerString(providerField) {
  if (Array.isArray(providerField)) return providerField.join(', ');
  return String(providerField || '').trim();
}

async function main() {
  const state = await readState();

  // Narrow scope: deals updated last 21 days in relevant stages.
  const sinceIso = isoZoho(new Date(Date.now() - 21 * 24 * 3600 * 1000));
  const q = `select id, Deal_Name, Stage, Modified_Time, Last_Activity_Time, Last_Time_Contacted, Appointment_Status, Provider from Deals where Modified_Time >= '${sinceIso}' and (Stage = 'Ready for Provider' or Stage = 'Sent to Provider') limit 200`;
  const res = await zohoCrmCoql({ accessToken: zohoToken, apiDomain, selectQuery: q });
  const deals = res?.data || [];

  let created = 0;
  const dayKey = todayEt();

  for (const d of deals) {
    const dealId = String(d.id);
    const stage = String(d.Stage || '');
    const provider = providerString(d.Provider);

    // If provider includes Alina (deprecated), create explicit reassignment task.
    if (/\bAlina\b/i.test(provider)) {
      const key = `${dealId}:${dayKey}:reassign-alina`;
      if (!state.createdTasks[key]) {
        const health = await getDealFileHealth(dealId);
        const subj = 'REASSIGN PROVIDER (Alina deprecated)';
        const desc = [
          `Deal: ${d.Deal_Name}`,
          `Stage: ${stage}`,
          `Provider currently: ${provider}`,
          '',
          `Deal file health: open_tasks=${health.openTasksCount} (overdue=${health.overdueTasksCount}) | notes=${health.notesCount} (last=${health.lastNote || 'n/a'}) | attachments=${health.attachmentsCount} (last=${health.lastAttach || 'n/a'})`,
          '',
          'Do:',
          '- Remove/replace Alina with an active provider (Neura/Rivers/Suntree/Other)',
          '- Then proceed with normal handoff + follow-up tasks',
        ].join('\n');
        await createTask({ subject: subj, dueDate: dayKey, whatId: dealId, description: desc });
        state.createdTasks[key] = { at: new Date().toISOString(), kind: 'reassign-alina' };
        created += 1;
      }
    }

    // Tasks for Ready for Provider: assign provider + send packet
    if (stage === 'Ready for Provider') {
      const key = `${dealId}:${dayKey}:ready-pack`;
      if (!state.createdTasks[key]) {
        const health = await getDealFileHealth(dealId);
        const subj = provider
          ? `Provider handoff: send packet to ${provider}`
          : `Provider handoff: assign Provider + send packet`;
        const desc = [
          `Deal: ${d.Deal_Name}`,
          `Stage: ${stage}`,
          `Provider: ${provider || '(not set)'}`,
          '',
          `Deal file health: open_tasks=${health.openTasksCount} (overdue=${health.overdueTasksCount}) | notes=${health.notesCount} (last=${health.lastNote || 'n/a'}) | attachments=${health.attachmentsCount} (last=${health.lastAttach || 'n/a'})`,
          '',
          'Do:',
          '- Set Provider (field at top) if not set',
          '- Send packet using correct vendor workflow (Neura/Rivers/Suntree/Other)',
          '- Update Appointment Status + Last Time Contacted',
          '- Move stage to Sent to Provider after sending',
        ].join('\n');
        await createTask({ subject: subj, dueDate: dayKey, whatId: dealId, description: desc });
        state.createdTasks[key] = { at: new Date().toISOString(), kind: 'ready-pack' };
        created += 1;
      }
    }

    // Tasks for Sent to Provider: follow up rhythm if stale
    if (stage === 'Sent to Provider') {
      // If Last_Activity_Time is older than ~4 calendar days, create follow-up task.
      const lastActMs = d.Last_Activity_Time ? new Date(d.Last_Activity_Time).getTime() : 0;
      const stale = !lastActMs || (Date.now() - lastActMs > 4 * 24 * 3600 * 1000);
      if (stale) {
        const key = `${dealId}:${dayKey}:provider-followup`;
        if (!state.createdTasks[key]) {
          const health = await getDealFileHealth(dealId);
          const subj = `Provider follow-up${provider ? ` (${provider})` : ''}: get ETA + update`;
          const desc = [
            `Deal: ${d.Deal_Name}`,
            `Stage: ${stage}`,
            `Provider: ${provider || '(not set)'}`,
            `Appointment Status: ${d.Appointment_Status || '(blank)'}`,
            `Last Activity: ${d.Last_Activity_Time || '(none)'}`,
            '',
            `Deal file health: open_tasks=${health.openTasksCount} (overdue=${health.overdueTasksCount}) | notes=${health.notesCount} (last=${health.lastNote || 'n/a'}) | attachments=${health.attachmentsCount} (last=${health.lastAttach || 'n/a'})`,
            '',
            'Do:',
            '- Follow up with provider for ETA / scheduling',
            '- Update Appointment Status',
            '- Update Last Time Contacted + log notes',
            '- Create next follow-up task/date if still pending',
          ].join('\n');
          await createTask({ subject: subj, dueDate: dayKey, whatId: dealId, description: desc });
          state.createdTasks[key] = { at: new Date().toISOString(), kind: 'provider-followup' };
          created += 1;
        }
      }
    }
  }

  await writeState(state);
  process.stdout.write(`Done. dryRun=${dryRun} deals_scanned=${deals.length} tasks_created=${created}\n`);
}

await main();

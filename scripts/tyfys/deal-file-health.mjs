#!/usr/bin/env node
/**
 * TYFYS Deal File Health Scanner
 *
 * Scans Deals in key stages and summarizes "what's on file":
 * - open tasks (deal-linked)
 * - notes
 * - attachments
 *
 * Usage:
 *   node scripts/tyfys/deal-file-health.mjs --hours 168
 *   node scripts/tyfys/deal-file-health.mjs --hours 168 --limit 100 --out zoho_exports/deal-file-health.txt
 *   node scripts/tyfys/deal-file-health.mjs --hours 168 --format json --out-json zoho_exports/deal-file-health.json
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { loadEnvLocal } from '../lib/load-env-local.mjs';
import { getZohoAccessToken, zohoCrmCoql, zohoCrmGet } from '../lib/zoho.mjs';

loadEnvLocal();
process.stdout.on('error', () => {});

const args = process.argv.slice(2);
const hours = Number((() => {
  const i = args.indexOf('--hours');
  return i !== -1 ? args[i + 1] : '168';
})());
const limit = Number((() => {
  const i = args.indexOf('--limit');
  return i !== -1 ? args[i + 1] : '120';
})());
const outPath = (() => {
  const i = args.indexOf('--out');
  return i !== -1 ? args[i + 1] : null;
})();

const format = (() => {
  const i = args.indexOf('--format');
  return i !== -1 ? String(args[i + 1] || 'text') : 'text';
})();

const outJsonPath = (() => {
  const i = args.indexOf('--out-json');
  return i !== -1 ? args[i + 1] : null;
})();

const apiDomain = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';
const token = await getZohoAccessToken();

const isoZoho = (d) => d.toISOString().replace(/\.\d{3}Z$/, '+00:00');

async function fetchAllRelated({ dealId, rel, perPage = 200, maxPages = 10 }) {
  let page = 1;
  let out = [];
  for (;;) {
    const qs = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    const j = await zohoCrmGet({ accessToken: token, apiDomain, pathAndQuery: `/crm/v2/Deals/${dealId}/${rel}?${qs.toString()}` });
    const data = j.data || [];
    out = out.concat(data);
    if (!j.info?.more_records) break;
    page += 1;
    if (page > maxPages) break;
  }
  return out;
}

function normText(v) {
  return String(v || '').toLowerCase();
}

function includesAny(hay, needles) {
  const h = normText(hay);
  return needles.some(n => h.includes(n));
}

function hasIntakeNotes(notes) {
  const n = notes || [];
  // Zoho Notes commonly include fields like Note_Title / Note_Content.
  return n.some(x => (
    includesAny(x.Note_Title, ['intake', 'call notes', 'intake notes']) ||
    includesAny(x.Note_Content, ['intake', 'call notes', 'intake notes'])
  ));
}

function hasCompletedIntakeTask(tasks) {
  const t = tasks || [];
  return t.some(x => {
    const subj = x.Subject || x.Subject_name || x.Task_Subject || '';
    const status = String(x.Status || '');
    return /intake/i.test(String(subj)) && ['Completed', 'Closed'].includes(status);
  });
}

function apptLooksCompleted(apptStatus) {
  return includesAny(apptStatus, ['completed', 'complete', 'done']);
}

function healthSummary({ tasks, notes, attachments, appointmentStatus }) {
  const openTasks = (tasks || []).filter(t => !['Completed', 'Closed'].includes(String(t.Status || '')));
  const overdue = openTasks.filter(t => t.Due_Date && new Date(t.Due_Date).getTime() < Date.now());
  const lastNote = (notes || []).map(n => n.Modified_Time || n.Created_Time).filter(Boolean).sort().slice(-1)[0] || '';
  const lastAttach = (attachments || []).map(a => a.Modified_Time || a.Created_Time).filter(Boolean).sort().slice(-1)[0] || '';

  const intakeNotesPresent = hasIntakeNotes(notes);
  const intakeCompleted = hasCompletedIntakeTask(tasks) || apptLooksCompleted(appointmentStatus);

  return {
    openTasksCount: openTasks.length,
    overdueTasksCount: overdue.length,
    notesCount: (notes || []).length,
    attachmentsCount: (attachments || []).length,
    lastNote,
    lastAttach,
    intakeCompleted,
    intakeNotesPresent,
    missingIntakeNotes: intakeCompleted && !intakeNotesPresent,
  };
}

async function main() {
  const sinceIso = isoZoho(new Date(Date.now() - hours * 3600 * 1000));
  const q = `select id, Deal_Name, Stage, Modified_Time, Last_Activity_Time, Appointment_Status, Provider from Deals where Modified_Time >= '${sinceIso}' and Stage in ('Intake (Document Collection)','Ready for Provider','Sent to Provider') limit ${Math.min(limit, 200)}`;
  const res = await zohoCrmCoql({ accessToken: token, apiDomain, selectQuery: q });
  const deals = res?.data || [];

  const lines = [];
  lines.push(`Deal File Health — window last ${hours}h`);
  lines.push(`Deals scanned: ${deals.length}`);
  lines.push('');

  const jsonRows = [];

  for (const d of deals) {
    const dealId = String(d.id);
    const [tasks, notes, attachments] = await Promise.all([
      fetchAllRelated({ dealId, rel: 'Tasks' }),
      fetchAllRelated({ dealId, rel: 'Notes' }),
      fetchAllRelated({ dealId, rel: 'Attachments' }),
    ]);

    const h = healthSummary({
      tasks,
      notes,
      attachments,
      appointmentStatus: d.Appointment_Status,
    });

    const risk = [
      h.missingIntakeNotes ? 'MISSING_INTAKE_NOTES' : null,
      h.attachmentsCount === 0 ? 'NO_ATTACHMENTS' : null,
      h.overdueTasksCount > 0 ? 'OVERDUE_TASKS' : null,
    ].filter(Boolean);

    jsonRows.push({
      id: dealId,
      name: d.Deal_Name,
      stage: d.Stage,
      provider: d.Provider,
      appointmentStatus: d.Appointment_Status || '',
      modifiedTime: d.Modified_Time || '',
      lastActivityTime: d.Last_Activity_Time || '',
      counts: {
        openTasks: h.openTasksCount,
        overdueTasks: h.overdueTasksCount,
        notes: h.notesCount,
        attachments: h.attachmentsCount,
      },
      last: {
        note: h.lastNote || null,
        attachment: h.lastAttach || null,
      },
      intake: {
        completed: h.intakeCompleted,
        notesPresent: h.intakeNotesPresent,
      },
      risk,
    });

    lines.push(
      `- ${d.Deal_Name} | ${d.Stage} | Provider=${Array.isArray(d.Provider) ? d.Provider.join(', ') : (d.Provider || '')} | Appt=${d.Appointment_Status || ''} | open_tasks=${h.openTasksCount} (overdue=${h.overdueTasksCount}) | notes=${h.notesCount} last_note=${h.lastNote || 'n/a'} | attachments=${h.attachmentsCount} last_attach=${h.lastAttach || 'n/a'} | intake_notes=${h.intakeNotesPresent ? 'yes' : 'no'}${h.missingIntakeNotes ? ' ⚠️MISSING_INTAKE_NOTES' : ''}`
    );
  }

  const outText = lines.join('\n') + '\n';
  const outJson = JSON.stringify({
    windowHours: hours,
    scanned: deals.length,
    stages: ['Intake (Document Collection)','Ready for Provider','Sent to Provider'],
    generatedAt: new Date().toISOString(),
    deals: jsonRows,
  }, null, 2) + '\n';

  if (outPath) {
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, outText, 'utf8');
  }
  if (outJsonPath) {
    await fs.mkdir(path.dirname(outJsonPath), { recursive: true });
    await fs.writeFile(outJsonPath, outJson, 'utf8');
  }

  if (format === 'json') process.stdout.write(outJson);
  else process.stdout.write(outText);
}

await main();

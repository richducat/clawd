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

function healthSummary({ tasks, notes, attachments }) {
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

async function main() {
  const sinceIso = isoZoho(new Date(Date.now() - hours * 3600 * 1000));
  const q = `select id, Deal_Name, Stage, Modified_Time, Last_Activity_Time, Appointment_Status, Provider from Deals where Modified_Time >= '${sinceIso}' and Stage in ('Intake (Document Collection)','Ready for Provider','Sent to Provider') limit ${Math.min(limit, 200)}`;
  const res = await zohoCrmCoql({ accessToken: token, apiDomain, selectQuery: q });
  const deals = res?.data || [];

  const lines = [];
  lines.push(`Deal File Health — window last ${hours}h`);
  lines.push(`Deals scanned: ${deals.length}`);
  lines.push('');

  for (const d of deals) {
    const dealId = String(d.id);
    const [tasks, notes, attachments] = await Promise.all([
      fetchAllRelated({ dealId, rel: 'Tasks' }),
      fetchAllRelated({ dealId, rel: 'Notes' }),
      fetchAllRelated({ dealId, rel: 'Attachments' }),
    ]);
    const h = healthSummary({ tasks, notes, attachments });
    lines.push(
      `- ${d.Deal_Name} | ${d.Stage} | Provider=${Array.isArray(d.Provider) ? d.Provider.join(', ') : (d.Provider || '')} | Appt=${d.Appointment_Status || ''} | open_tasks=${h.openTasksCount} (overdue=${h.overdueTasksCount}) | notes=${h.notesCount} last_note=${h.lastNote || 'n/a'} | attachments=${h.attachmentsCount} last_attach=${h.lastAttach || 'n/a'}`
    );
  }

  const out = lines.join('\n') + '\n';
  if (outPath) {
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, out, 'utf8');
  }
  process.stdout.write(out);
}

await main();

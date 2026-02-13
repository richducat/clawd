#!/usr/bin/env node
/**
 * RingCentral Contacts Migration (OLD → NEW) replicated across team extensions.
 *
 * Source: OLD tenant, authenticated extension's personal address book.
 * Dest: NEW tenant, per-extension personal address book for each rep.
 *
 * Dedupe: by email OR businessPhone OR mobilePhone OR (first+last name).
 *
 * State/checkpoint: memory/ringcentral-contact-migration/team-state.json
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { loadEnvLocal } from '../lib/load-env-local.mjs';
import { ringcentralGetJson, ringcentralPostJson } from '../lib/ringcentral.mjs';

loadEnvLocal();

const OUT_DIR = path.resolve('memory/ringcentral-contact-migration');
const SRC_JSON = path.join(OUT_DIR, 'src-old-contacts.json');
const STATE_JSON = path.join(OUT_DIR, 'team-state.json');

function getArg(name, def) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return def;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return def;
  return v;
}

const dryRun = process.argv.includes('--dry-run');
const limit = Number(getArg('--limit', '0')) || null; // optional cap across all creates
const perExtDelayMs = Number(getArg('--delayMs', '250')); // base delay between creates
const burst = Number(getArg('--burst', '10')); // after N creates, pause longer
const burstSleepMs = Number(getArg('--burstSleepMs', '1500'));

const TEAM = [
  { key: 'richard', display: 'Richard' },
  { key: 'devin', display: 'Devin' },
  { key: 'adam', display: 'Adam' },
  { key: 'amy', display: 'Amy' },
  { key: 'jared', display: 'Jared' },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function tenantOpt(t) {
  return t ? { tenant: t } : {};
}

function normPhone(p) {
  const s = String(p || '').trim();
  if (!s) return '';
  const digits = s.replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return s.startsWith('+') ? s : `+${digits}`;
}

function normEmail(e) {
  return String(e || '').trim().toLowerCase();
}

function normName(first, last) {
  return `${String(first || '').trim().toLowerCase()} ${String(last || '').trim().toLowerCase()}`.trim();
}

async function rcGetWithBackoff(pathAndQuery, opts) {
  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      return await ringcentralGetJson(pathAndQuery, opts);
    } catch (e) {
      const msg = String(e?.message || e);
      if (msg.includes('(429)') && attempt <= 10) {
        const wait = Math.min(60_000, 1000 * Math.pow(2, attempt));
        process.stdout.write(`429 backoff ${wait}ms\n`);
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }
}

async function rcPostWithBackoff(pathAndQuery, body, opts) {
  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      return await ringcentralPostJson(pathAndQuery, body, opts);
    } catch (e) {
      const msg = String(e?.message || e);
      if (msg.includes('(429)') && attempt <= 10) {
        const wait = Math.min(60_000, 1000 * Math.pow(2, attempt));
        process.stdout.write(`429 backoff ${wait}ms\n`);
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }
}

async function listAllContacts({ tenant, extensionId }) {
  const out = [];
  let page = 1;

  while (true) {
    const base = extensionId
      ? `/restapi/v1.0/account/~/extension/${encodeURIComponent(extensionId)}/address-book/contact`
      : '/restapi/v1.0/account/~/extension/~/address-book/contact';

    const res = await rcGetWithBackoff(`${base}?perPage=1000&page=${page}`, tenantOpt(tenant));
    out.push(...(res.records || []));
    const nav = res.navigation || {};
    if (!nav.nextPage) break;
    page += 1;
    if (page > 200) break;
  }

  return out;
}

async function createContact({ tenant, extensionId, payload }) {
  const base = extensionId
    ? `/restapi/v1.0/account/~/extension/${encodeURIComponent(extensionId)}/address-book/contact`
    : '/restapi/v1.0/account/~/extension/~/address-book/contact';

  if (dryRun) return { id: 'dry-run' };
  return rcPostWithBackoff(base, payload, tenantOpt(tenant));
}

async function getNewExtensionIdByRep() {
  const exts = await rcGetWithBackoff('/restapi/v1.0/account/~/extension?perPage=200', { tenant: 'new' });
  const records = exts.records || [];

  function matchId(key) {
    const k = key.toLowerCase();
    const exact = records.find((e) => `${e?.contact?.firstName || ''} ${e?.contact?.lastName || ''}`.trim().toLowerCase().includes(k) || String(e?.name || '').toLowerCase().includes(k));
    return exact?.id || null;
  }

  const map = {};
  for (const rep of TEAM) {
    map[rep.key] = matchId(rep.key);
  }
  return map;
}

async function readState() {
  try {
    return JSON.parse(await fs.readFile(STATE_JSON, 'utf8'));
  } catch {
    return {
      startedAt: new Date().toISOString(),
      createdTotal: 0,
      skippedTotal: 0,
      errorsTotal: 0,
      perExtension: {},
    };
  }
}

async function writeState(state) {
  await fs.mkdir(path.dirname(STATE_JSON), { recursive: true });
  await fs.writeFile(STATE_JSON, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function isDuplicate({ email, bp, mp, name, dstEmail, dstPhone, dstName }) {
  return (email && dstEmail.has(email)) || (bp && dstPhone.has(bp)) || (mp && dstPhone.has(mp)) || (name && dstName.has(name));
}

(async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  // Load source contacts from file (must already exist)
  const srcRaw = await fs.readFile(SRC_JSON, 'utf8');
  const srcContacts = JSON.parse(srcRaw);

  const newExtIds = await getNewExtensionIdByRep();
  for (const rep of TEAM) {
    if (!newExtIds[rep.key]) throw new Error(`Could not find NEW extension id for rep=${rep.key}`);
  }

  const state = await readState();

  // For each extension, build dedupe set and then import.
  for (const rep of TEAM) {
    const extId = newExtIds[rep.key];
    const key = rep.key;

    const st = (state.perExtension[key] ||= {
      extensionId: extId,
      created: 0,
      skipped: 0,
      errors: 0,
      lastIndex: 0,
      updatedAt: null,
    });

    // refresh extension id if changed
    st.extensionId = extId;

    process.stdout.write(`\n=== Dest extension: ${key} (id=${extId}) ===\n`);

    const dstContacts = await listAllContacts({ tenant: 'new', extensionId: extId });
    const dstEmail = new Set();
    const dstPhone = new Set();
    const dstName = new Set();
    for (const c of dstContacts) {
      if (c.email) dstEmail.add(normEmail(c.email));
      if (c.businessPhone) dstPhone.add(normPhone(c.businessPhone));
      if (c.mobilePhone) dstPhone.add(normPhone(c.mobilePhone));
      const n = normName(c.firstName, c.lastName);
      if (n) dstName.add(n);
    }

    let createdSincePause = 0;

    for (let i = st.lastIndex; i < srcContacts.length; i++) {
      const c = srcContacts[i];

      const email = normEmail(c.email);
      const bp = normPhone(c.businessPhone);
      const mp = normPhone(c.mobilePhone);
      const name = normName(c.firstName, c.lastName);

      if (isDuplicate({ email, bp, mp, name, dstEmail, dstPhone, dstName })) {
        st.skipped += 1;
        state.skippedTotal += 1;
        st.lastIndex = i + 1;
        continue;
      }

      const payload = {
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        businessPhone: c.businessPhone,
        mobilePhone: c.mobilePhone,
        company: c.company,
        jobTitle: c.jobTitle,
        businessAddress: c.businessAddress,
        notes: c.notes,
      };

      try {
        await createContact({ tenant: 'new', extensionId: extId, payload });
        st.created += 1;
        state.createdTotal += 1;
        createdSincePause += 1;

        if (email) dstEmail.add(email);
        if (bp) dstPhone.add(bp);
        if (mp) dstPhone.add(mp);
        if (name) dstName.add(name);

        st.lastIndex = i + 1;
        st.updatedAt = new Date().toISOString();

        if (limit && state.createdTotal >= limit) {
          await writeState(state);
          process.stdout.write(`Reached --limit=${limit}. Stopping.\n`);
          return;
        }

        // pacing
        await sleep(perExtDelayMs);
        if (createdSincePause >= burst) {
          createdSincePause = 0;
          await writeState(state);
          process.stdout.write(`progress ${key}: created=${st.created} skipped=${st.skipped} errors=${st.errors} lastIndex=${st.lastIndex}/${srcContacts.length}\n`);
          await sleep(burstSleepMs);
        }
      } catch (e) {
        st.errors += 1;
        state.errorsTotal += 1;
        st.lastIndex = i + 1;
        st.updatedAt = new Date().toISOString();
        await writeState(state);
        process.stdout.write(`ERROR creating contact for ${key} at index=${i}: ${String(e?.message || e)}\n`);
        if (st.errors >= 25) {
          process.stdout.write(`Too many errors for ${key}; moving on.\n`);
          break;
        }
      }
    }

    await writeState(state);
    process.stdout.write(`DONE ${key}: created=${st.created} skipped=${st.skipped} errors=${st.errors} lastIndex=${st.lastIndex}\n`);
  }

  process.stdout.write(`\nALL DONE. totalCreated=${state.createdTotal} totalSkipped=${state.skippedTotal} totalErrors=${state.errorsTotal}\n`);
})().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

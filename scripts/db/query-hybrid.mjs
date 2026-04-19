#!/usr/bin/env node
import { dbPath } from '../lib/db.mjs';
import { loadEnvLocal } from '../lib/env.mjs';
import { openSqlite } from '../lib/sqlite.mjs';

const args = process.argv.slice(2);
const query = cleanLine(getArg(args, '--query') || '');
const limit = toSafeInt(getArg(args, '--limit'), 10, 1, 100);
const domains = dedupeArray(getArgValues(args, '--domain').map((v) => normalizeKey(v)).filter(Boolean));
const types = dedupeArray(getArgValues(args, '--type').map((v) => normalizeKey(v)).filter(Boolean));
const jsonMode = hasFlag(args, '--json');

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

async function main() {
  loadEnvLocal();

  if (!query) {
    throw new Error('Missing required --query value.');
  }

  const queryTokens = tokenize(query);
  if (!queryTokens.length) {
    throw new Error('Query must include at least one alphanumeric token.');
  }

  const db = openSqlite(dbPath('hybrid-core.sqlite'), { readonly: true });
  try {
    assertHybridSchemaReady(db);

    const { sql, bind } = buildSearchSql({ domains, types });
    const rows = db.prepare(sql).all(...bind);

    const scored = rows
      .map((row) => scoreRow(row, queryTokens))
      .filter((row) => row.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.domain !== b.domain) return String(a.domain).localeCompare(String(b.domain));
        if (a.type !== b.type) return String(a.type).localeCompare(String(b.type));
        if (a.entity_id !== b.entity_id) return String(a.entity_id).localeCompare(String(b.entity_id));
        return Number(a.chunk_index) - Number(b.chunk_index);
      })
      .slice(0, limit)
      .map((row, idx) => ({
        rank: idx + 1,
        ...row,
      }));

    const output = {
      ok: true,
      db: dbPath('hybrid-core.sqlite'),
      query,
      filters: {
        domains,
        types,
      },
      total_matches: scored.length,
      results: scored,
    };

    if (jsonMode) {
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    printMarkdown(output);
  } finally {
    db.close();
  }
}

function buildSearchSql({ domains, types }) {
  const where = [];
  const bind = [];

  if (domains.length) {
    where.push(`e.domain IN (${domains.map(() => '?').join(',')})`);
    bind.push(...domains);
  }

  if (types.length) {
    where.push(`e.type IN (${types.map(() => '?').join(',')})`);
    bind.push(...types);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `
    SELECT
      e.id AS entity_id,
      e.domain,
      e.type,
      e.external_ref,
      e.title,
      c.chunk_index,
      c.text AS chunk_text
    FROM entity_chunks c
    JOIN entities e ON e.id = c.entity_id
    ${whereSql}
  `;

  return { sql, bind };
}

function scoreRow(row, queryTokens) {
  const title = cleanLine(row.title || '(untitled)', 200);
  const text = cleanLine(row.chunk_text || '', 12000);

  const titleTokens = tokenize(title);
  const textTokens = tokenize(text);
  const tokenFreq = tokenFrequency(textTokens);

  const querySet = new Set(queryTokens);
  const titleSet = new Set(titleTokens);
  const textSet = new Set(textTokens);

  const matchedTokens = new Set();
  let score = 0;
  for (const token of querySet) {
    if (titleSet.has(token)) {
      matchedTokens.add(token);
      score += 6;
    }

    if (textSet.has(token)) {
      matchedTokens.add(token);
      const freq = tokenFreq.get(token) || 1;
      score += Math.min(4, 1 + Math.log2(freq + 1));
    }
  }

  const coverage = querySet.size ? matchedTokens.size / querySet.size : 0;
  score += coverage * 10;

  const snippet = pickSnippet(text, Array.from(querySet));

  return {
    score: Number(score.toFixed(4)),
    coverage: Number(coverage.toFixed(4)),
    entity_id: row.entity_id,
    domain: row.domain,
    type: row.type,
    external_ref: row.external_ref,
    title,
    chunk_index: row.chunk_index,
    snippet,
  };
}

function pickSnippet(text, queryTokens) {
  if (!text) return '';

  const source = text.replace(/\s+/g, ' ').trim();
  if (!source) return '';

  const lower = source.toLowerCase();
  let idx = -1;
  for (const token of queryTokens) {
    const i = lower.indexOf(token.toLowerCase());
    if (i !== -1 && (idx === -1 || i < idx)) idx = i;
  }

  if (idx === -1) return truncate(source, 220);

  const start = Math.max(0, idx - 70);
  const end = Math.min(source.length, idx + 150);
  const slice = source.slice(start, end).trim();
  if (start > 0 && end < source.length) return `...${slice}...`;
  if (start > 0) return `...${slice}`;
  if (end < source.length) return `${slice}...`;
  return slice;
}

function printMarkdown(result) {
  console.log(`# Hybrid Query Results`);
  console.log('');
  console.log(`- Query: ${result.query}`);
  console.log(`- DB: ${result.db}`);
  console.log(`- Matches: ${result.total_matches}`);
  console.log(`- Filters: domain=${result.filters.domains.join(',') || 'any'}, type=${result.filters.types.join(',') || 'any'}`);
  console.log('');

  if (!result.results.length) {
    console.log('No matches found.');
    return;
  }

  for (const row of result.results) {
    console.log(`## ${row.rank}) [${row.score}] ${row.title}`);
    console.log(`- domain/type: ${row.domain}/${row.type}`);
    console.log(`- entity: ${row.entity_id}`);
    console.log(`- chunk: ${row.chunk_index}`);
    if (row.external_ref) {
      console.log(`- external_ref: ${row.external_ref}`);
    }
    if (row.snippet) {
      console.log(`- snippet: ${row.snippet}`);
    }
    console.log('');
  }
}

function assertHybridSchemaReady(db) {
  const required = ['entities', 'entity_chunks'];
  const rows = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name IN (${required.map(() => '?').join(',')})
  `).all(...required);

  const present = new Set(rows.map((r) => r.name));
  const missing = required.filter((name) => !present.has(name));
  if (missing.length) {
    throw new Error(`Missing required tables: ${missing.join(', ')}. Run npm run db:hybrid:init first.`);
  }
}

function tokenize(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function tokenFrequency(tokens) {
  const map = new Map();
  for (const token of tokens) {
    map.set(token, (map.get(token) || 0) + 1);
  }
  return map;
}

function getArg(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  return argv[i + 1] || null;
}

function getArgValues(argv, name) {
  const values = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name && argv[i + 1]) {
      values.push(argv[i + 1]);
    }
  }
  return values;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function normalizeKey(value) {
  if (!value) return null;
  return String(value).trim().toLowerCase();
}

function cleanLine(value, max = 1000) {
  if (value === null || value === undefined) return '';
  const s = String(value).replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

function truncate(value, max = 220) {
  const s = String(value || '').trim();
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

function dedupeArray(values) {
  return Array.from(new Set(values));
}

function toSafeInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

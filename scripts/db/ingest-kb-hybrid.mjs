#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { dbPath, ensureDbDir } from '../lib/db.mjs';
import { loadEnvLocal } from '../lib/env.mjs';
import { stableId, toEmbeddingJson } from '../lib/hybrid-db.mjs';
import { embedTextOpenAI } from '../lib/openai-embeddings.mjs';
import { openSqlite } from '../lib/sqlite.mjs';

const args = process.argv.slice(2);
const fileArgs = getArgValues(args, '--file');
const urlArgs = getArgValues(args, '--url');
const fromFileArg = getArg(args, '--from-file');
const maxChars = toSafeInt(getArg(args, '--max-chars'), 1200, 200, 8000);
const overlapChars = toSafeInt(getArg(args, '--overlap-chars'), 120, 0, 1000);
const embed = hasFlag(args, '--embed');
const embedModel = getArg(args, '--embedding-model') || 'text-embedding-3-small';

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

async function main() {
  loadEnvLocal();
  await ensureDbDir();
  const runStartedAt = new Date().toISOString();

  const targetPath = dbPath('hybrid-core.sqlite');
  const db = openSqlite(targetPath);

  try {
    assertHybridSchemaReady(db);

    const extra = fromFileArg ? loadSourcesFile(fromFileArg) : { files: [], urls: [] };
    const files = dedupeArray([...fileArgs, ...extra.files].map((s) => String(s || '').trim()).filter(Boolean));
    const urls = dedupeArray([...urlArgs, ...extra.urls].map((s) => normalizeUrl(s)).filter(Boolean));

    if (!files.length && !urls.length) {
      throw new Error(
        'No KB sources provided. Pass one or more --file and/or --url values, or --from-file <json/txt>.',
      );
    }

    const summary = {
      db: targetPath,
      options: {
        maxChars,
        overlapChars,
        embed,
        embeddingModel: embed ? embedModel : null,
      },
      scanned: {
        files: files.length,
        urls: urls.length,
      },
      upserted: {
        entities: 0,
        chunks: 0,
      },
      skippedUnchanged: 0,
      failed: [],
    };

    for (const fileInput of files) {
      await ingestFileSource(db, fileInput, summary, { maxChars, overlapChars, embed, embedModel });
    }

    for (const urlInput of urls) {
      await ingestUrlSource(db, urlInput, summary, { maxChars, overlapChars, embed, embedModel });
    }

    writeCursor(db, 'kb_ingest', {
      last_ingested_at: new Date().toISOString(),
      files,
      urls,
    });

    const runCompletedAt = new Date().toISOString();
    const totalScanned = Number(summary.scanned.files || 0) + Number(summary.scanned.urls || 0);
    const failedCount = Array.isArray(summary.failed) ? summary.failed.length : 0;
    const status = failedCount === 0
      ? 'ok'
      : (summary.upserted.entities > 0 ? 'partial_failure' : 'failed');

    writeIngestionRunMetric(db, {
      run_id: crypto.randomUUID(),
      source: 'kb_ingest',
      status,
      run_started_at: runStartedAt,
      run_completed_at: runCompletedAt,
      records_scanned: totalScanned,
      entities_upserted: Number(summary.upserted.entities || 0),
      chunks_upserted: Number(summary.upserted.chunks || 0),
      links_upserted: 0,
      error_message: failedCount ? cleanLine(summary.failed[0]?.reason || 'kb_source_failure', 300) : null,
      metrics_json: JSON.stringify({
        failed_sources: failedCount,
        skipped_unchanged: Number(summary.skippedUnchanged || 0),
      }),
    });

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    db.close();
  }
}

async function ingestFileSource(db, fileInput, summary, opts) {
  const fullPath = path.resolve(fileInput);
  if (!fs.existsSync(fullPath)) {
    summary.failed.push({ source: fileInput, reason: 'file_not_found' });
    return;
  }

  const stat = fs.statSync(fullPath);
  if (!stat.isFile()) {
    summary.failed.push({ source: fileInput, reason: 'not_a_file' });
    return;
  }

  const raw = fs.readFileSync(fullPath, 'utf8');
  const text = normalizeSourceText(raw);
  if (!text) {
    summary.failed.push({ source: fileInput, reason: 'empty_or_unreadable' });
    return;
  }

  await upsertKbSource(db, {
    canonicalRef: `file:${fullPath}`,
    sourceSystem: 'kb_file',
    sourceUrl: null,
    title: path.basename(fullPath),
    body: text,
    metadata: {
      source_kind: 'file',
      source_path: fullPath,
      mtime_iso: stat.mtime.toISOString(),
    },
  }, summary, opts);
}

async function ingestUrlSource(db, urlInput, summary, opts) {
  const url = normalizeUrl(urlInput);
  if (!url) {
    summary.failed.push({ source: urlInput, reason: 'invalid_url' });
    return;
  }

  let response;
  try {
    response = await fetch(url, { method: 'GET', redirect: 'follow' });
  } catch (err) {
    summary.failed.push({ source: url, reason: `fetch_failed:${String(err?.message || err)}` });
    return;
  }

  if (!response.ok) {
    summary.failed.push({ source: url, reason: `http_${response.status}` });
    return;
  }

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const raw = await response.text();
  const text = normalizeSourceText(contentType.includes('html') ? htmlToText(raw) : raw);
  if (!text) {
    summary.failed.push({ source: url, reason: 'empty_content' });
    return;
  }

  const htmlTitle = contentType.includes('html') ? extractHtmlTitle(raw) : null;

  await upsertKbSource(db, {
    canonicalRef: `url:${url}`,
    sourceSystem: 'kb_url',
    sourceUrl: url,
    title: cleanLine(htmlTitle) || cleanLine(url),
    body: text,
    metadata: {
      source_kind: 'url',
      source_url: url,
      content_type: contentType || null,
    },
  }, summary, opts);
}

async function upsertKbSource(db, source, summary, { maxChars, overlapChars, embed, embedModel }) {
  const contentHash = sha256(source.body);
  const entityId = stableId(`entity:kb:${source.canonicalRef}`);
  const existing = db.prepare('SELECT metadata_json FROM entities WHERE id = ?').get(entityId);
  const existingMeta = safeJson(existing?.metadata_json);

  if (existingMeta?.content_sha256 === contentHash) {
    summary.skippedUnchanged += 1;
    return;
  }

  const chunks = chunkText(source.body, { maxChars, overlapChars });
  upsertEntity(db, {
    id: entityId,
    domain: 'kb',
    type: 'kb_source',
    externalRef: source.canonicalRef,
    title: source.title,
    body: source.body,
    metadata: {
      ...source.metadata,
      canonical_ref: source.canonicalRef,
      content_sha256: contentHash,
      body_char_count: source.body.length,
      chunk_count: chunks.length,
      ingested_at: new Date().toISOString(),
    },
    sourceSystem: source.sourceSystem,
    sourceUrl: source.sourceUrl,
  });

  for (let i = 0; i < chunks.length; i++) {
    const text = chunks[i];
    let embedding = null;
    let embeddingDim = null;
    let embeddingModel = null;

    if (embed) {
      const vector = await embedTextOpenAI(text, { model: embedModel });
      embedding = toEmbeddingJson(vector);
      embeddingDim = Array.isArray(vector) ? vector.length : null;
      embeddingModel = embedModel;
    }

    upsertChunk(db, {
      entityId,
      chunkIndex: i,
      text,
      embeddingModel,
      embeddingDim,
      embeddingJson: embedding,
    });
  }

  db.prepare('DELETE FROM entity_chunks WHERE entity_id = ? AND chunk_index >= ?').run(entityId, chunks.length);
  summary.upserted.entities += 1;
  summary.upserted.chunks += chunks.length;
}

function chunkText(text, { maxChars, overlapChars }) {
  const input = normalizeSourceText(text);
  if (!input) return [];

  const chunks = [];
  let start = 0;
  while (start < input.length) {
    const end = Math.min(start + maxChars, input.length);
    const chunk = input.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= input.length) break;
    start = Math.max(end - overlapChars, start + 1);
  }
  return chunks;
}

function upsertEntity(db, record) {
  db.prepare(`
    INSERT INTO entities (
      id, domain, type, external_ref, title, body,
      metadata_json, source_system, source_url, updated_at
    ) VALUES (
      @id, @domain, @type, @external_ref, @title, @body,
      @metadata_json, @source_system, @source_url, CURRENT_TIMESTAMP
    )
    ON CONFLICT(id) DO UPDATE SET
      domain = excluded.domain,
      type = excluded.type,
      external_ref = excluded.external_ref,
      title = excluded.title,
      body = excluded.body,
      metadata_json = excluded.metadata_json,
      source_system = excluded.source_system,
      source_url = excluded.source_url,
      updated_at = CURRENT_TIMESTAMP
  `).run({
    id: record.id,
    domain: record.domain,
    type: record.type,
    external_ref: record.externalRef || null,
    title: record.title || null,
    body: record.body || null,
    metadata_json: JSON.stringify(record.metadata || {}),
    source_system: record.sourceSystem || null,
    source_url: record.sourceUrl || null,
  });
}

function upsertChunk(db, record) {
  const chunkId = stableId(`chunk:${record.entityId}:${record.chunkIndex}`);
  db.prepare(`
    INSERT INTO entity_chunks (
      id, entity_id, chunk_index, text, token_count,
      embedding_model, embedding_dim, embedding_json
    ) VALUES (
      @id, @entity_id, @chunk_index, @text, @token_count,
      @embedding_model, @embedding_dim, @embedding_json
    )
    ON CONFLICT(entity_id, chunk_index) DO UPDATE SET
      id = excluded.id,
      text = excluded.text,
      token_count = excluded.token_count,
      embedding_model = excluded.embedding_model,
      embedding_dim = excluded.embedding_dim,
      embedding_json = excluded.embedding_json
  `).run({
    id: chunkId,
    entity_id: record.entityId,
    chunk_index: record.chunkIndex,
    text: record.text,
    token_count: estimateTokenCount(record.text),
    embedding_model: record.embeddingModel,
    embedding_dim: record.embeddingDim,
    embedding_json: record.embeddingJson,
  });
}

function writeCursor(db, source, payload) {
  db.prepare(`
    INSERT INTO ingestion_cursors (source, cursor_json, updated_at)
    VALUES (@source, @cursor_json, CURRENT_TIMESTAMP)
    ON CONFLICT(source) DO UPDATE SET
      cursor_json = excluded.cursor_json,
      updated_at = CURRENT_TIMESTAMP
  `).run({ source, cursor_json: JSON.stringify(payload) });
}

function writeIngestionRunMetric(db, metric) {
  db.prepare(`
    INSERT INTO ingestion_run_metrics (
      run_id, source, status, run_started_at, run_completed_at,
      records_scanned, entities_upserted, chunks_upserted, links_upserted,
      error_message, metrics_json
    ) VALUES (
      @run_id, @source, @status, @run_started_at, @run_completed_at,
      @records_scanned, @entities_upserted, @chunks_upserted, @links_upserted,
      @error_message, @metrics_json
    )
  `).run(metric);
}

function loadSourcesFile(filePath) {
  const fullPath = path.resolve(filePath);
  const raw = fs.readFileSync(fullPath, 'utf8');
  const ext = path.extname(fullPath).toLowerCase();

  if (ext === '.json') {
    const parsed = JSON.parse(raw);
    return {
      files: Array.isArray(parsed?.files) ? parsed.files : [],
      urls: Array.isArray(parsed?.urls) ? parsed.urls : [],
    };
  }

  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  const files = [];
  const urls = [];
  for (const line of lines) {
    if (/^https?:\/\//i.test(line)) urls.push(line);
    else files.push(line);
  }
  return { files, urls };
}

function assertHybridSchemaReady(db) {
  const requiredTables = [
    'entities',
    'entity_chunks',
    'entity_links',
    'ingestion_cursors',
    'ingestion_run_metrics',
  ];
  const rows = db
    .prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name IN (${requiredTables.map(() => '?').join(',')})
    `)
    .all(...requiredTables);

  const found = new Set(rows.map((r) => r.name));
  const missing = requiredTables.filter((t) => !found.has(t));

  if (missing.length) {
    throw new Error(
      `Missing required table(s): ${missing.join(', ')}. Run "npm run db:hybrid:init" first.`,
    );
  }
}

function normalizeSourceText(value) {
  if (!value) return '';
  return String(value)
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value).trim());
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function htmlToText(html) {
  return String(html)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractHtmlTitle(html) {
  const match = String(html).match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1] || null;
}

function estimateTokenCount(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

function cleanLine(value, maxLen = 240) {
  if (!value) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function safeJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function dedupeArray(items) {
  return [...new Set(items)];
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function getArg(argv, name) {
  const idx = argv.indexOf(name);
  if (idx === -1) return null;
  return argv[idx + 1] || null;
}

function getArgValues(argv, name) {
  const values = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name && argv[i + 1]) values.push(argv[i + 1]);
  }
  return values;
}

function toSafeInt(raw, fallback, min, max) {
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

import { dbPath } from '../lib/db.mjs';
import { loadEnvLocal } from '../lib/env.mjs';
import { openSqlite } from '../lib/sqlite.mjs';

const args = process.argv.slice(2);
const asOfArg = getArg(args, '--as-of');
const artifactDirArg = getArg(args, '--artifact-dir') || 'artifacts';
const artifactsMax = toSafeInt(getArg(args, '--artifacts-max'), 8, 1, 100);
const jsonMode = hasFlag(args, '--json');
const thresholds = {
  max_lag_hours: readOptionalNumberArg(args, '--max-lag-hours'),
  max_seen_drift_hours: readOptionalNumberArg(args, '--max-seen-drift-hours'),
  max_artifact_issues: readOptionalNumberArg(args, '--max-artifact-issues'),
  max_entity_delta_pct: readOptionalNumberArg(args, '--max-entity-delta-pct'),
  max_chunk_ratio_delta: readOptionalNumberArg(args, '--max-chunk-ratio-delta'),
  max_link_delta_pct: readOptionalNumberArg(args, '--max-link-delta-pct'),
};
const hasThresholds = Object.values(thresholds).some((value) => value !== null);

const DEFAULT_SOURCES = ['gmail', 'google_calendar', 'kb_ingest'];

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

async function main() {
  loadEnvLocal();

  const asOf = asOfArg ? parseIso(asOfArg) : new Date();
  if (!asOf) {
    throw new Error(`Invalid --as-of value: ${asOfArg}`);
  }

  const db = openSqlite(dbPath('hybrid-core.sqlite'), { readonly: true });
  try {
    assertSchemaReady(db);

    const sourceHealth = readSourceHealth(db, asOf);
    const entityTotals = readEntityTotals(db);
    const entityByDomainType = readEntityByDomainType(db);
    const recentEntityUpdates = readRecentEntityUpdates(db);
    const failureSummary = readFailureSummary(artifactDirArg, artifactsMax);
    const reconciliation = readSourceReconciliation(db);
    const breaches = evaluateThresholdBreaches({
      sources: sourceHealth,
      failures: failureSummary,
      reconciliation,
      thresholds,
    });

    const result = {
      ok: hasThresholds ? breaches.length === 0 : true,
      as_of: asOf.toISOString(),
      db: dbPath('hybrid-core.sqlite'),
      sources: sourceHealth,
      totals: entityTotals,
      by_domain_type: entityByDomainType,
      recent_updates: recentEntityUpdates,
      failures: failureSummary,
      reconciliation,
      thresholds: {
        configured: hasThresholds,
        ...thresholds,
      },
      breaches,
    };

    if (jsonMode) {
      console.log(JSON.stringify(result, null, 2));
      if (hasThresholds && breaches.length) {
        process.exitCode = 2;
      }
      return;
    }

    printMarkdown(result, artifactDirArg);
    if (hasThresholds && breaches.length) {
      process.exitCode = 2;
    }
  } finally {
    db.close();
  }
}

function readSourceHealth(db, asOf) {
  const rows = db.prepare(`
    SELECT source, cursor_json, updated_at
    FROM ingestion_cursors
    WHERE source IN (${DEFAULT_SOURCES.map(() => '?').join(',')})
  `).all(...DEFAULT_SOURCES);

  const bySource = new Map(rows.map((row) => [String(row.source), row]));
  const output = [];

  for (const source of DEFAULT_SOURCES) {
    const row = bySource.get(source) || null;
    const cursor = safeJson(row?.cursor_json);

    const lastIngestedAt = toIsoOrNull(cursor?.last_ingested_at) || toIsoOrNull(row?.updated_at);
    const latestSeenAt = toIsoOrNull(cursor?.latest_seen_at);
    const updatedAt = toIsoOrNull(row?.updated_at);

    const lagHours = diffHours(asOf, lastIngestedAt);
    const seenDriftHours = diffHours(asOf, latestSeenAt);

    output.push({
      source,
      status: classifyLag(lagHours, lastIngestedAt),
      lag_hours: lagHours,
      seen_drift_hours: seenDriftHours,
      last_ingested_at: lastIngestedAt,
      latest_seen_at: latestSeenAt,
      cursor_updated_at: updatedAt,
    });
  }

  return output;
}

function readEntityTotals(db) {
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS entity_count,
      COALESCE(SUM(chunk_counts.chunk_count), 0) AS chunk_count
    FROM entities e
    LEFT JOIN (
      SELECT entity_id, COUNT(*) AS chunk_count
      FROM entity_chunks
      GROUP BY entity_id
    ) chunk_counts ON chunk_counts.entity_id = e.id
  `).get();

  return {
    entities: Number(totals?.entity_count || 0),
    chunks: Number(totals?.chunk_count || 0),
  };
}

function readEntityByDomainType(db) {
  const rows = db.prepare(`
    SELECT
      e.domain,
      e.type,
      COUNT(*) AS entity_count,
      COALESCE(SUM(chunk_counts.chunk_count), 0) AS chunk_count,
      MAX(e.updated_at) AS latest_updated_at
    FROM entities e
    LEFT JOIN (
      SELECT entity_id, COUNT(*) AS chunk_count
      FROM entity_chunks
      GROUP BY entity_id
    ) chunk_counts ON chunk_counts.entity_id = e.id
    GROUP BY e.domain, e.type
    ORDER BY e.domain ASC, e.type ASC
  `).all();

  return rows.map((row) => ({
    domain: row.domain,
    type: row.type,
    entities: Number(row.entity_count || 0),
    chunks: Number(row.chunk_count || 0),
    latest_updated_at: toIsoOrNull(row.latest_updated_at),
  }));
}

function readRecentEntityUpdates(db) {
  const rows = db.prepare(`
    SELECT
      id,
      domain,
      type,
      title,
      updated_at
    FROM entities
    ORDER BY updated_at DESC, id ASC
    LIMIT 10
  `).all();

  return rows.map((row) => ({
    id: row.id,
    domain: row.domain,
    type: row.type,
    title: cleanLine(row.title || '(untitled)', 120),
    updated_at: toIsoOrNull(row.updated_at),
  }));
}

function readFailureSummary(artifactDirInput, maxFiles) {
  const artifactDir = path.resolve(artifactDirInput);
  if (!fs.existsSync(artifactDir)) {
    return {
      artifact_dir: artifactDir,
      scanned_files: 0,
      issues: [],
      note: 'artifact directory not found',
    };
  }

  const candidates = fs.readdirSync(artifactDir)
    .filter((name) => /^pipeline-summary-.*\.json$/i.test(name))
    .map((name) => {
      const fullPath = path.join(artifactDir, name);
      const stat = fs.statSync(fullPath);
      return {
        name,
        path: fullPath,
        mtime_ms: Number(stat.mtimeMs || 0),
      };
    })
    .sort((a, b) => b.mtime_ms - a.mtime_ms || a.name.localeCompare(b.name))
    .slice(0, maxFiles);

  const issues = [];
  for (const item of candidates) {
    const parsed = safeJson(readTextFile(item.path));
    if (!parsed || typeof parsed !== 'object') {
      issues.push({
        file: item.name,
        level: 'error',
        message: 'invalid_json',
      });
      continue;
    }

    if (parsed.ok === false) {
      issues.push({
        file: item.name,
        level: 'error',
        message: 'pipeline_not_ok',
      });
    }

    const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
    for (const step of steps) {
      const preview = String(step?.output_preview || '');
      if (!preview.trim()) continue;

      if (/\b(error|failed|exception)\b/i.test(preview)) {
        issues.push({
          file: item.name,
          step: String(step?.name || ''),
          level: 'warn',
          message: truncate(cleanLine(preview, 300), 180),
        });
      }
    }
  }

  return {
    artifact_dir: artifactDir,
    scanned_files: candidates.length,
    issues,
    note: issues.length ? null : 'no failure signals found in scanned artifacts',
  };
}

function printMarkdown(result, artifactDirInput) {
  console.log('# Hybrid Ingestion Health');
  console.log('');
  console.log(`- As of: ${result.as_of}`);
  console.log(`- DB: ${result.db}`);
  console.log(`- Artifacts: ${path.resolve(artifactDirInput)}`);
  console.log('');

  console.log('## Cursor Drift');
  for (const source of result.sources) {
    console.log(`- ${source.source}: status=${source.status}, lag_hours=${formatNumber(source.lag_hours)}, seen_drift_hours=${formatNumber(source.seen_drift_hours)}, last_ingested_at=${source.last_ingested_at || 'n/a'}, latest_seen_at=${source.latest_seen_at || 'n/a'}`);
  }
  console.log('');

  console.log('## Entity Coverage');
  console.log(`- totals: entities=${result.totals.entities}, chunks=${result.totals.chunks}`);
  if (!result.by_domain_type.length) {
    console.log('- no entities found');
  } else {
    for (const row of result.by_domain_type) {
      console.log(`- ${row.domain}/${row.type}: entities=${row.entities}, chunks=${row.chunks}, latest_updated_at=${row.latest_updated_at || 'n/a'}`);
    }
  }
  console.log('');

  console.log('## Recent Entity Updates');
  if (!result.recent_updates.length) {
    console.log('- no recent entities');
  } else {
    for (const row of result.recent_updates) {
      console.log(`- ${row.updated_at || 'n/a'} ${row.domain}/${row.type} ${row.id} :: ${row.title}`);
    }
  }
  console.log('');

  console.log('## Recent Failure Signals');
  console.log(`- scanned artifact files: ${result.failures.scanned_files}`);
  if (!result.failures.issues.length) {
    console.log(`- ${result.failures.note || 'no issues detected'}`);
    return;
  }

  for (const issue of result.failures.issues) {
    const stepText = issue.step ? ` step=${issue.step}` : '';
    console.log(`- [${issue.level}] ${issue.file}${stepText}: ${issue.message}`);
  }
  console.log('');

  console.log('## Reconciliation');
  if (!result.reconciliation?.available) {
    console.log(`- ${result.reconciliation?.note || 'reconciliation unavailable'}`);
  } else {
    console.log(`- compared sources: ${result.reconciliation.sources.length}`);
    for (const source of result.reconciliation.sources) {
      console.log(`- ${source.source}: status=${source.status}, current_run_at=${source.current?.run_completed_at || 'n/a'}, previous_run_at=${source.previous?.run_completed_at || 'n/a'}, entity_delta=${formatNumber(source.deltas.entity_delta)}, entity_delta_pct=${formatNumber(source.deltas.entity_delta_pct)}, chunk_ratio_delta=${formatNumber(source.deltas.chunk_ratio_delta)}, link_delta=${formatNumber(source.deltas.link_delta)}, link_delta_pct=${formatNumber(source.deltas.link_delta_pct)}`);
    }
  }
  console.log('');

  console.log('## Threshold Evaluation');
  if (!result.thresholds?.configured) {
    console.log('- no thresholds configured (report-only mode)');
    return;
  }

  console.log(`- max_lag_hours=${formatNumber(result.thresholds.max_lag_hours)}`);
  console.log(`- max_seen_drift_hours=${formatNumber(result.thresholds.max_seen_drift_hours)}`);
  console.log(`- max_artifact_issues=${formatNumber(result.thresholds.max_artifact_issues)}`);
  console.log(`- max_entity_delta_pct=${formatNumber(result.thresholds.max_entity_delta_pct)}`);
  console.log(`- max_chunk_ratio_delta=${formatNumber(result.thresholds.max_chunk_ratio_delta)}`);
  console.log(`- max_link_delta_pct=${formatNumber(result.thresholds.max_link_delta_pct)}`);
  console.log(`- breaches=${result.breaches.length}`);

  if (!result.breaches.length) {
    console.log('- all configured thresholds passed');
    return;
  }

  for (const breach of result.breaches) {
    if (breach.kind === 'artifact_issues_count') {
      console.log(`- [breach] artifact issues: actual=${breach.actual} > limit=${breach.limit}`);
      continue;
    }
    if (breach.kind === 'reconciliation_unavailable') {
      console.log(`- [breach] reconciliation unavailable: ${breach.message}`);
      continue;
    }
    console.log(`- [breach] ${breach.source} ${breach.kind}: actual=${breach.actual} > limit=${breach.limit}`);
  }
}

function readSourceReconciliation(db) {
  if (!tableExists(db, 'ingestion_run_metrics')) {
    return {
      available: false,
      note: 'ingestion_run_metrics table missing (run npm run db:hybrid:init)',
      sources: [],
    };
  }

  const rows = db.prepare(`
    SELECT
      source,
      run_id,
      status,
      run_completed_at,
      records_scanned,
      entities_upserted,
      chunks_upserted,
      links_upserted,
      error_message
    FROM ingestion_run_metrics
    WHERE source IN (${DEFAULT_SOURCES.map(() => '?').join(',')})
    ORDER BY source ASC, run_completed_at DESC, run_id DESC
  `).all(...DEFAULT_SOURCES);

  const grouped = new Map();
  for (const row of rows) {
    const source = String(row.source);
    if (!grouped.has(source)) grouped.set(source, []);
    const list = grouped.get(source);
    if (list.length < 2) {
      list.push({
        run_id: row.run_id,
        status: row.status,
        run_completed_at: toIsoOrNull(row.run_completed_at),
        records_scanned: Number(row.records_scanned || 0),
        entities_upserted: Number(row.entities_upserted || 0),
        chunks_upserted: Number(row.chunks_upserted || 0),
        links_upserted: Number(row.links_upserted || 0),
        error_message: row.error_message || null,
      });
    }
  }

  const sources = DEFAULT_SOURCES.map((source) => {
    const pair = grouped.get(source) || [];
    const current = pair[0] || null;
    const previous = pair[1] || null;

    if (!current || !previous) {
      return {
        source,
        status: 'insufficient_history',
        current,
        previous,
        deltas: {
          entity_delta: null,
          entity_delta_pct: null,
          chunk_ratio_delta: null,
          link_delta: null,
          link_delta_pct: null,
        },
      };
    }

    const currentRatio = ratio(current.chunks_upserted, current.entities_upserted);
    const previousRatio = ratio(previous.chunks_upserted, previous.entities_upserted);

    const entityDelta = current.entities_upserted - previous.entities_upserted;
    const linkDelta = current.links_upserted - previous.links_upserted;

    return {
      source,
      status: 'ok',
      current,
      previous,
      deltas: {
        entity_delta: entityDelta,
        entity_delta_pct: percentDelta(current.entities_upserted, previous.entities_upserted),
        chunk_ratio_delta: absoluteDelta(currentRatio, previousRatio),
        link_delta: linkDelta,
        link_delta_pct: percentDelta(current.links_upserted, previous.links_upserted),
      },
    };
  });

  return {
    available: true,
    note: rows.length ? null : 'no ingestion run history found yet',
    sources,
  };
}

function assertSchemaReady(db) {
  const required = ['entities', 'entity_chunks', 'ingestion_cursors'];
  const rows = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name IN (${required.map(() => '?').join(',')})
  `).all(...required);

  const present = new Set(rows.map((row) => row.name));
  const missing = required.filter((name) => !present.has(name));
  if (missing.length) {
    throw new Error(`Missing required tables: ${missing.join(', ')}. Run npm run db:hybrid:init first.`);
  }
}

function tableExists(db, tableName) {
  const row = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(tableName);
  return Boolean(row?.name);
}

function classifyLag(lagHours, lastIngestedAt) {
  if (!lastIngestedAt) return 'missing';
  if (lagHours === null) return 'unknown';
  if (lagHours <= 24) return 'healthy';
  if (lagHours <= 72) return 'stale';
  return 'critical';
}

function diffHours(asOf, iso) {
  if (!iso) return null;
  const ts = parseIso(iso);
  if (!ts) return null;
  const diffMs = asOf.getTime() - ts.getTime();
  return Number((diffMs / (60 * 60 * 1000)).toFixed(3));
}

function parseIso(value) {
  const d = new Date(String(value || '').trim());
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function toIsoOrNull(value) {
  if (!value) return null;
  const d = parseIso(value);
  return d ? d.toISOString() : null;
}

function getArg(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  return argv[i + 1] || null;
}

function readOptionalNumberArg(argv, name) {
  const raw = getArg(argv, name);
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid ${name} value: ${raw}. Expected a non-negative number.`);
  }
  return Number(value.toFixed(3));
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function toSafeInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.floor(n);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

function safeJson(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readTextFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function cleanLine(input, maxLen = 300) {
  const value = String(input || '').replace(/\s+/g, ' ').trim();
  return truncate(value, maxLen);
}

function truncate(input, maxLen) {
  if (!input) return '';
  if (input.length <= maxLen) return input;
  return `${input.slice(0, maxLen - 3)}...`;
}

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'n/a';
  return String(value);
}

function evaluateThresholdBreaches({ sources, failures, reconciliation, thresholds }) {
  const breaches = [];

  if (thresholds.max_lag_hours !== null) {
    for (const source of sources) {
      if (source.lag_hours === null || source.lag_hours === undefined) continue;
      if (source.lag_hours > thresholds.max_lag_hours) {
        breaches.push({
          kind: 'lag_hours',
          source: source.source,
          actual: source.lag_hours,
          limit: thresholds.max_lag_hours,
        });
      }
    }
  }

  if (thresholds.max_seen_drift_hours !== null) {
    for (const source of sources) {
      if (source.seen_drift_hours === null || source.seen_drift_hours === undefined) continue;
      if (source.seen_drift_hours > thresholds.max_seen_drift_hours) {
        breaches.push({
          kind: 'seen_drift_hours',
          source: source.source,
          actual: source.seen_drift_hours,
          limit: thresholds.max_seen_drift_hours,
        });
      }
    }
  }

  if (thresholds.max_artifact_issues !== null) {
    const issueCount = Array.isArray(failures?.issues) ? failures.issues.length : 0;
    if (issueCount > thresholds.max_artifact_issues) {
      breaches.push({
        kind: 'artifact_issues_count',
        actual: issueCount,
        limit: thresholds.max_artifact_issues,
      });
    }
  }

  if (!reconciliation?.available) {
    const hasReconciliationThresholds = thresholds.max_entity_delta_pct !== null
      || thresholds.max_chunk_ratio_delta !== null
      || thresholds.max_link_delta_pct !== null;
    if (hasReconciliationThresholds) {
      breaches.push({
        kind: 'reconciliation_unavailable',
        message: reconciliation?.note || 'missing reconciliation data',
      });
    }
    return breaches;
  }

  for (const source of reconciliation.sources || []) {
    if (source.status !== 'ok') continue;

    if (
      thresholds.max_entity_delta_pct !== null
      && source.deltas.entity_delta_pct !== null
      && source.deltas.entity_delta_pct > thresholds.max_entity_delta_pct
    ) {
      breaches.push({
        kind: 'entity_delta_pct',
        source: source.source,
        actual: source.deltas.entity_delta_pct,
        limit: thresholds.max_entity_delta_pct,
      });
    }

    if (
      thresholds.max_chunk_ratio_delta !== null
      && source.deltas.chunk_ratio_delta !== null
      && source.deltas.chunk_ratio_delta > thresholds.max_chunk_ratio_delta
    ) {
      breaches.push({
        kind: 'chunk_ratio_delta',
        source: source.source,
        actual: source.deltas.chunk_ratio_delta,
        limit: thresholds.max_chunk_ratio_delta,
      });
    }

    if (
      thresholds.max_link_delta_pct !== null
      && source.deltas.link_delta_pct !== null
      && source.deltas.link_delta_pct > thresholds.max_link_delta_pct
    ) {
      breaches.push({
        kind: 'link_delta_pct',
        source: source.source,
        actual: source.deltas.link_delta_pct,
        limit: thresholds.max_link_delta_pct,
      });
    }
  }

  return breaches;
}

function ratio(numerator, denominator) {
  if (!denominator) return 0;
  return Number((numerator / denominator).toFixed(6));
}

function percentDelta(current, previous) {
  if (previous === null || previous === undefined) return null;
  if (previous === 0) return current === 0 ? 0 : 100;
  return Number(((Math.abs(current - previous) / previous) * 100).toFixed(3));
}

function absoluteDelta(current, previous) {
  if (current === null || previous === null || current === undefined || previous === undefined) return null;
  return Number(Math.abs(current - previous).toFixed(6));
}

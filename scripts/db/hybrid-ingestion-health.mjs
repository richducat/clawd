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
const trendWindowSnapshots = toSafeInt(getArg(args, '--trend-window-snapshots'), 14, 2, 365);
const trendArtifactDirArg = getArg(args, '--trend-artifact-dir');
const trendArtifactPrefix = sanitizeFileStem(getArg(args, '--trend-artifact-prefix') || 'ingestion-trends');
const trendRetentionDays = readOptionalNumberArg(args, '--trend-retention-days');
const trendRetentionCount = readOptionalNumberArg(args, '--trend-retention-count');
const sloDigestDirArg = getArg(args, '--slo-digest-dir');
const sloDigestPrefix = sanitizeFileStem(getArg(args, '--slo-digest-prefix') || 'ingestion-slo-weekly');
const sloWindowDays = toSafeInt(getArg(args, '--slo-window-days'), 7, 2, 90);
const sloRetentionDays = readOptionalNumberArg(args, '--slo-retention-days');
const sloRetentionCount = readOptionalNumberArg(args, '--slo-retention-count');
const defaultSloTargetPct = toSafeFloat(getArg(args, '--slo-target-default-pct'), 99, 90, 100);
const sourceSloTargets = readSourceSloTargets(args, defaultSloTargetPct);
const sloSeasonalityConfig = {
  window_days: toSafeInt(getArg(args, '--slo-seasonality-window-days'), 56, 14, 365),
  min_runs_per_day: toSafeInt(getArg(args, '--slo-seasonality-min-runs'), 4, 2, 50),
  band_multiplier: toSafeFloat(getArg(args, '--slo-seasonality-band-multiplier'), 1.5, 0.5, 10),
  adaptive_multiplier_min: toSafeFloat(getArg(args, '--slo-adaptive-burn-min-multiplier'), 0.6, 0.1, 1),
  adaptive_multiplier_max: toSafeFloat(getArg(args, '--slo-adaptive-burn-max-multiplier'), 1.8, 1, 10),
  basis: 'utc_weekday',
};
const sloBudgetConfig = {
  window_days: toSafeInt(getArg(args, '--slo-budget-window-days'), 7, 2, 90),
  partial_failure_weight: toSafeFloat(getArg(args, '--slo-partial-failure-weight'), 0.5, 0, 1),
  target_pct_by_source: sourceSloTargets,
  seasonality: sloSeasonalityConfig,
};
const baselineConfig = {
  window_runs: toSafeInt(getArg(args, '--baseline-window-runs'), 14, 3, 180),
  min_samples: toSafeInt(getArg(args, '--baseline-min-samples'), 5, 2, 50),
  sigma_multiplier: toSafeFloat(getArg(args, '--baseline-sigma-multiplier'), 3, 0.5, 10),
};
const thresholds = {
  max_lag_hours: readOptionalNumberArg(args, '--max-lag-hours'),
  max_seen_drift_hours: readOptionalNumberArg(args, '--max-seen-drift-hours'),
  max_artifact_issues: readOptionalNumberArg(args, '--max-artifact-issues'),
  max_entity_delta_pct: readOptionalNumberArg(args, '--max-entity-delta-pct'),
  max_chunk_ratio_delta: readOptionalNumberArg(args, '--max-chunk-ratio-delta'),
  max_link_delta_pct: readOptionalNumberArg(args, '--max-link-delta-pct'),
  max_baseline_anomalies: readOptionalNumberArg(args, '--max-baseline-anomalies'),
  max_slo_budget_burn_pct: readOptionalNumberArg(args, '--max-slo-budget-burn-pct'),
  max_quality_drift_signals: readOptionalNumberArg(args, '--max-quality-drift-signals'),
  max_quality_severity_score: readOptionalNumberArg(args, '--max-quality-severity-score'),
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

  const db = openSqlite(dbPath('hybrid-core.sqlite'));
  try {
    assertSchemaReady(db);

    const sourceHealth = readSourceHealth(db, asOf);
    const entityTotals = readEntityTotals(db);
    const entityByDomainType = readEntityByDomainType(db);
    const recentEntityUpdates = readRecentEntityUpdates(db);
    const failureSummary = readFailureSummary(artifactDirArg, artifactsMax);
    const reconciliation = readSourceReconciliation(db);
    const sloBudgets = readSourceSloBudgets(db, {
      asOf,
      config: sloBudgetConfig,
    });
    const baselines = readSourceBaselines(db, baselineConfig);
    const baselineSnapshots = persistBaselineSnapshots(db, {
      asOfIso: asOf.toISOString(),
      baselines,
    });
    const trends = readBaselineTrends(db, {
      window_snapshots: trendWindowSnapshots,
    });
    const sloDigest = buildWeeklySloDigest(db, {
      asOf,
      windowDays: sloWindowDays,
      artifactDirInput: artifactDirArg,
    });
    const meetingPrepQuality = readMeetingPrepQualityTrends({
      artifactDirInput: artifactDirArg,
    });
    const breaches = evaluateThresholdBreaches({
      sources: sourceHealth,
      failures: failureSummary,
      reconciliation,
      baselines,
      sloBudgets,
      meetingPrepQuality,
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
      slo_budgets: sloBudgets,
      baselines,
      baseline_snapshots: baselineSnapshots,
      trends,
      meeting_prep_quality: meetingPrepQuality,
      trend_config: {
        window_snapshots: trendWindowSnapshots,
      },
      slo_config: {
        window_days: sloWindowDays,
      },
      slo_budget_config: sloBudgetConfig,
      slo_seasonality_config: sloSeasonalityConfig,
      baseline_config: baselineConfig,
      thresholds: {
        configured: hasThresholds,
        ...thresholds,
      },
      breaches,
      slo_digest: sloDigest,
    };

    const trendArtifacts = exportTrendArtifacts(result, {
      dirArg: trendArtifactDirArg,
      prefix: trendArtifactPrefix,
      retentionDays: trendRetentionDays,
      retentionCount: trendRetentionCount,
    });
    result.trend_artifacts = trendArtifacts;
    result.slo_digest_artifacts = exportSloDigestArtifacts(result, {
      dirArg: sloDigestDirArg,
      prefix: sloDigestPrefix,
      retentionDays: sloRetentionDays,
      retentionCount: sloRetentionCount,
    });

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
    console.log('');
  } else {
    for (const issue of result.failures.issues) {
      const stepText = issue.step ? ` step=${issue.step}` : '';
      console.log(`- [${issue.level}] ${issue.file}${stepText}: ${issue.message}`);
    }
    console.log('');
  }

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

  console.log('## Source SLO Budget');
  if (!result.slo_budgets?.available) {
    console.log(`- ${result.slo_budgets?.note || 'source SLO budget unavailable'}`);
  } else {
    console.log(`- window_start=${result.slo_budgets.window_start}, window_end=${result.slo_budgets.window_end}, window_days=${result.slo_budget_config?.window_days}`);
    console.log(`- partial_failure_weight=${formatNumber(result.slo_budget_config?.partial_failure_weight)}`);
    console.log(`- seasonality_window_days=${formatNumber(result.slo_seasonality_config?.window_days)}, seasonality_min_runs_per_day=${formatNumber(result.slo_seasonality_config?.min_runs_per_day)}, seasonality_band_multiplier=${formatNumber(result.slo_seasonality_config?.band_multiplier)}, adaptive_multiplier_min=${formatNumber(result.slo_seasonality_config?.adaptive_multiplier_min)}, adaptive_multiplier_max=${formatNumber(result.slo_seasonality_config?.adaptive_multiplier_max)}, basis=${result.slo_seasonality_config?.basis || 'n/a'}`);
    console.log(`- total_runs=${result.slo_budgets.totals?.total_runs || 0}, over_budget_sources=${result.slo_budgets.totals?.over_budget_sources || 0}, alerted_sources=${result.slo_budgets.totals?.alerted_sources || 0}`);
    for (const source of result.slo_budgets.sources || []) {
      console.log(`- ${source.source}: status=${source.status}, target_pct=${formatNumber(source.target_pct)}, runs=${source.total_runs}, ok=${source.ok_runs}, partial_failure=${source.partial_failure_runs}, failed=${source.failed_runs}, error_rate_pct=${formatNumber(source.actual_error_rate_pct)}, budget_pct=${formatNumber(source.error_budget_pct)}, burn_pct=${formatNumber(source.budget_burn_pct)}, adaptive_burn_pct=${formatNumber(source.adaptive_budget_burn_pct)}, burn_rate=${formatNumber(source.burn_rate)}, adaptive_burn_rate=${formatNumber(source.adaptive_burn_rate)}, seasonal_expected_error_rate_pct=${formatNumber(source.seasonality?.expected_error_rate_pct)}, seasonal_day_error_rate_pct=${formatNumber(source.seasonality?.current_day_error_rate_pct)}, seasonal_day_runs=${formatNumber(source.seasonality?.current_day_runs)}, seasonal_multiplier=${formatNumber(source.seasonality?.adaptive_multiplier)}, remaining_budget_pct=${formatNumber(source.remaining_budget_pct)}, alert=${source.alert}`);
    }
  }
  console.log('');

  console.log('## Rolling Baselines');
  if (!result.baselines?.available) {
    console.log(`- ${result.baselines?.note || 'baseline model unavailable'}`);
  } else {
    console.log(`- baseline window runs=${result.baseline_config?.window_runs}, min samples=${result.baseline_config?.min_samples}, sigma multiplier=${formatNumber(result.baseline_config?.sigma_multiplier)}`);
    console.log(`- total anomalies=${result.baselines?.totals?.anomalies || 0}`);
    for (const source of result.baselines.sources || []) {
      console.log(`- ${source.source}: status=${source.status}, current_run_at=${source.current?.run_completed_at || 'n/a'}, anomalies=${source.anomalies.length}`);
      for (const anomaly of source.anomalies) {
        console.log(`  - [anomaly] ${anomaly.metric}: actual=${formatNumber(anomaly.actual)}, floor=${formatNumber(anomaly.floor)}, ceiling=${formatNumber(anomaly.ceiling)}, direction=${anomaly.direction}`);
      }
    }
  }
  console.log('');

  console.log('## Baseline Snapshot Persistence');
  if (!result.baseline_snapshots?.available) {
    console.log(`- ${result.baseline_snapshots?.note || 'baseline snapshot persistence unavailable'}`);
  } else {
    console.log(`- health_run_at=${result.baseline_snapshots.health_run_at}, written_rows=${result.baseline_snapshots.written_rows}`);
  }
  console.log('');

  console.log('## Baseline Trends');
  if (!result.trends?.available) {
    console.log(`- ${result.trends?.note || 'baseline trends unavailable'}`);
  } else {
    console.log(`- trend window snapshots=${result.trend_config?.window_snapshots}`);
    for (const source of result.trends.sources || []) {
      console.log(`- ${source.source}: status=${source.status}, snapshots=${source.snapshot_count}, latest_health_run_at=${source.latest_health_run_at || 'n/a'}, oldest_health_run_at=${source.oldest_health_run_at || 'n/a'}`);
      if (source.status !== 'ok') continue;
      console.log(`  - anomalies: latest=${formatNumber(source.anomaly_count.latest)}, avg=${formatNumber(source.anomaly_count.avg)}, direction=${source.anomaly_count.direction}, delta_vs_oldest=${formatNumber(source.anomaly_count.delta_vs_oldest)}, delta_vs_oldest_pct=${formatNumber(source.anomaly_count.delta_vs_oldest_pct)}`);
      console.log(`  - records_scanned: latest=${formatNumber(source.metrics.records_scanned.latest)}, avg=${formatNumber(source.metrics.records_scanned.avg)}, direction=${source.metrics.records_scanned.direction}, delta_vs_oldest=${formatNumber(source.metrics.records_scanned.delta_vs_oldest)}, delta_vs_oldest_pct=${formatNumber(source.metrics.records_scanned.delta_vs_oldest_pct)}`);
      console.log(`  - entities_upserted: latest=${formatNumber(source.metrics.entities_upserted.latest)}, avg=${formatNumber(source.metrics.entities_upserted.avg)}, direction=${source.metrics.entities_upserted.direction}, delta_vs_oldest=${formatNumber(source.metrics.entities_upserted.delta_vs_oldest)}, delta_vs_oldest_pct=${formatNumber(source.metrics.entities_upserted.delta_vs_oldest_pct)}`);
      console.log(`  - links_upserted: latest=${formatNumber(source.metrics.links_upserted.latest)}, avg=${formatNumber(source.metrics.links_upserted.avg)}, direction=${source.metrics.links_upserted.direction}, delta_vs_oldest=${formatNumber(source.metrics.links_upserted.delta_vs_oldest)}, delta_vs_oldest_pct=${formatNumber(source.metrics.links_upserted.delta_vs_oldest_pct)}`);
    }
  }
  console.log('');

  console.log('## Meeting Prep Quality Trends');
  if (!result.meeting_prep_quality?.available) {
    console.log(`- ${result.meeting_prep_quality?.note || 'meeting prep quality trend data unavailable'}`);
  } else {
    console.log(`- scanned_artifacts=${result.meeting_prep_quality.scanned_artifacts}, snapshots=${result.meeting_prep_quality.snapshots}, meetings_scored=${result.meeting_prep_quality.meetings_scored}`);
    console.log(`- latest_avg_score=${formatNumber(result.meeting_prep_quality.latest?.avg_score)}, latest_avg_gap_count=${formatNumber(result.meeting_prep_quality.latest?.avg_gap_count)}, latest_severity_score=${formatNumber(result.meeting_prep_quality.latest?.severity_score)}`);
    console.log(`- oldest_avg_score=${formatNumber(result.meeting_prep_quality.oldest?.avg_score)}, oldest_avg_gap_count=${formatNumber(result.meeting_prep_quality.oldest?.avg_gap_count)}, oldest_severity_score=${formatNumber(result.meeting_prep_quality.oldest?.severity_score)}`);

    const driftSignals = Array.isArray(result.meeting_prep_quality.drift_signals) ? result.meeting_prep_quality.drift_signals : [];
    if (!driftSignals.length) {
      console.log('- drift_signals: none');
    } else {
      for (const signal of driftSignals) {
        console.log(`- [drift:${signal.severity}] ${signal.code}: ${signal.message}`);
      }
    }

    const lanes = Array.isArray(result.meeting_prep_quality.escalation_lanes) ? result.meeting_prep_quality.escalation_lanes : [];
    if (!lanes.length) {
      console.log('- escalation_lanes: none');
    } else {
      for (const lane of lanes) {
        console.log(`- [lane:${lane.severity}] ${lane.lane}: trigger=${lane.trigger_count}, message=${lane.message}`);
      }
    }
  }
  console.log('');

  console.log('## Weekly SLO Digest');
  if (!result.slo_digest?.available) {
    console.log(`- ${result.slo_digest?.note || 'weekly SLO digest unavailable'}`);
  } else {
    console.log(`- window_start=${result.slo_digest.window_start}, window_end=${result.slo_digest.window_end}, window_days=${result.slo_config?.window_days}`);
    console.log(`- total_snapshots=${result.slo_digest.total_snapshots}, healthy_snapshots=${result.slo_digest.healthy_snapshots}, anomaly_snapshots=${result.slo_digest.anomaly_snapshots}`);
    for (const source of result.slo_digest.sources || []) {
      console.log(`- ${source.source}: snapshots=${source.snapshots}, healthy=${source.healthy_snapshots}, anomaly=${source.anomaly_snapshots}, anomaly_free_pct=${formatNumber(source.anomaly_free_pct)}, avg_anomalies=${formatNumber(source.avg_anomaly_count)}, latest_anomalies=${formatNumber(source.latest_anomaly_count)}, latest_health_run_at=${source.latest_health_run_at || 'n/a'}`);
    }
  }
  console.log('');

  console.log('## Breach Rollup Feed');
  if (!result.slo_digest?.available) {
    console.log('- breach rollup unavailable (SLO digest unavailable)');
  } else if (!result.slo_digest?.breach_rollup?.total_events) {
    console.log('- no breach events found in digest window');
  } else {
    console.log(`- total_events=${result.slo_digest.breach_rollup.total_events}, scanned_artifacts=${result.slo_digest.breach_rollup.scanned_artifacts}`);
    for (const severity of result.slo_digest.breach_rollup.by_severity || []) {
      console.log(`- severity=${severity.severity}: count=${severity.count}`);
    }
    for (const source of result.slo_digest.breach_rollup.by_source || []) {
      const topKinds = (source.top_kinds || []).map((k) => `${k.kind}:${k.count}`).join(', ');
      console.log(`- source=${source.source}: count=${source.count}, top_kinds=${topKinds || 'n/a'}`);
    }
  }
  console.log('');

  console.log('## Trend Artifact Export');
  if (!result.trend_artifacts?.enabled) {
    console.log(`- ${result.trend_artifacts?.note || 'trend artifact export disabled'}`);
  } else {
    console.log(`- artifact_dir=${result.trend_artifacts.artifact_dir}`);
    if (result.trend_artifacts.written?.length) {
      for (const file of result.trend_artifacts.written) {
        console.log(`- [written] ${file.file}`);
      }
    } else {
      console.log('- no files written');
    }

    if (result.trend_artifacts.pruned?.length) {
      for (const file of result.trend_artifacts.pruned) {
        const reason = file.reason ? ` reason=${file.reason}` : '';
        console.log(`- [pruned] ${file.file}${reason}`);
      }
    } else {
      console.log('- no files pruned');
    }
  }
  console.log('');

  console.log('## SLO Digest Artifact Export');
  if (!result.slo_digest_artifacts?.enabled) {
    console.log(`- ${result.slo_digest_artifacts?.note || 'SLO digest artifact export disabled'}`);
  } else {
    console.log(`- artifact_dir=${result.slo_digest_artifacts.artifact_dir}`);
    if (result.slo_digest_artifacts.written?.length) {
      for (const file of result.slo_digest_artifacts.written) {
        console.log(`- [written] ${file.file}`);
      }
    } else {
      console.log('- no files written');
    }

    if (result.slo_digest_artifacts.pruned?.length) {
      for (const file of result.slo_digest_artifacts.pruned) {
        const reason = file.reason ? ` reason=${file.reason}` : '';
        console.log(`- [pruned] ${file.file}${reason}`);
      }
    } else {
      console.log('- no files pruned');
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
  console.log(`- max_baseline_anomalies=${formatNumber(result.thresholds.max_baseline_anomalies)}`);
  console.log(`- max_slo_budget_burn_pct=${formatNumber(result.thresholds.max_slo_budget_burn_pct)}`);
  console.log(`- max_quality_drift_signals=${formatNumber(result.thresholds.max_quality_drift_signals)}`);
  console.log(`- max_quality_severity_score=${formatNumber(result.thresholds.max_quality_severity_score)}`);
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
    if (breach.kind === 'baseline_anomalies_count') {
      console.log(`- [breach] baseline anomalies: actual=${breach.actual} > limit=${breach.limit}`);
      continue;
    }
    if (breach.kind === 'slo_budget_unavailable') {
      console.log(`- [breach] source SLO budget unavailable: ${breach.message}`);
      continue;
    }
    if (breach.kind === 'slo_budget_burn_pct') {
      console.log(`- [breach] ${breach.source} SLO budget burn: actual=${breach.actual} > limit=${breach.limit}`);
      continue;
    }
    if (breach.kind === 'meeting_prep_quality_unavailable') {
      console.log(`- [breach] meeting prep quality unavailable: ${breach.message}`);
      continue;
    }
    if (breach.kind === 'quality_drift_signals_count') {
      console.log(`- [breach] quality drift signals: actual=${breach.actual} > limit=${breach.limit}`);
      continue;
    }
    if (breach.kind === 'quality_severity_score') {
      console.log(`- [breach] quality severity score: actual=${breach.actual} > limit=${breach.limit}`);
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

function readSourceSloBudgets(db, { asOf, config }) {
  if (!tableExists(db, 'ingestion_run_metrics')) {
    return {
      available: false,
      note: 'ingestion_run_metrics table missing (run npm run db:hybrid:init)',
      sources: [],
      totals: {
        total_runs: 0,
        ok_runs: 0,
        partial_failure_runs: 0,
        failed_runs: 0,
        over_budget_sources: 0,
        alerted_sources: 0,
      },
    };
  }

  const windowEnd = asOf.toISOString();
  const windowStartDate = new Date(asOf.getTime() - config.window_days * 24 * 60 * 60 * 1000);
  const windowStart = windowStartDate.toISOString();
  const seasonalityWindowDays = Number(config.seasonality?.window_days || config.window_days);
  const seasonalityWindowStartDate = new Date(asOf.getTime() - seasonalityWindowDays * 24 * 60 * 60 * 1000);
  const seasonalityWindowStart = seasonalityWindowStartDate.toISOString();
  const currentWeekday = asOf.getUTCDay();

  const rows = db.prepare(`
    SELECT source, status, run_completed_at
    FROM ingestion_run_metrics
    WHERE source IN (${DEFAULT_SOURCES.map(() => '?').join(',')})
      AND run_completed_at >= ?
      AND run_completed_at <= ?
    ORDER BY source ASC, run_completed_at DESC, run_id DESC
  `).all(...DEFAULT_SOURCES, seasonalityWindowStart, windowEnd);

  const statusBySource = new Map();
  const seasonalityBySource = new Map();
  for (const source of DEFAULT_SOURCES) {
    statusBySource.set(source, []);
    seasonalityBySource.set(source, []);
  }

  for (const row of rows) {
    const source = String(row.source || '');
    if (!statusBySource.has(source)) continue;
    const status = String(row.status || 'failed');
    const completedAt = toIsoOrNull(row.run_completed_at);
    const ts = completedAt ? parseIso(completedAt) : null;
    const weekday = ts ? ts.getUTCDay() : null;
    seasonalityBySource.get(source).push({
      status,
      run_completed_at: completedAt,
      weekday,
    });
    if (completedAt && completedAt >= windowStart) {
      statusBySource.get(source).push(status);
    }
  }

  const sources = DEFAULT_SOURCES.map((source) => {
    const statuses = statusBySource.get(source) || [];
    const seasonalityRuns = seasonalityBySource.get(source) || [];
    const totalRuns = statuses.length;
    const okRuns = statuses.filter((status) => status === 'ok').length;
    const partialFailureRuns = statuses.filter((status) => status === 'partial_failure').length;
    const failedRuns = statuses.filter((status) => status === 'failed').length;

    const targetPct = Number(config.target_pct_by_source[source] ?? defaultSloTargetPct);
    const errorBudgetPct = Number((100 - targetPct).toFixed(3));
    const weightedErrorUnits = Number((failedRuns + (partialFailureRuns * config.partial_failure_weight)).toFixed(6));

    let actualErrorRatePct = null;
    let budgetBurnPct = null;
    let burnRate = null;
    let adaptiveBudgetBurnPct = null;
    let adaptiveBurnRate = null;
    let remainingBudgetPct = null;
    let status = 'no_runs';
    let alert = 'none';
    let seasonality = {
      basis: config.seasonality?.basis || 'utc_weekday',
      current_weekday: currentWeekday,
      min_runs_per_day: Number(config.seasonality?.min_runs_per_day || 0),
      window_days: seasonalityWindowDays,
      day_profiles: [],
      current_day_runs: 0,
      current_day_error_rate_pct: null,
      expected_error_rate_pct: null,
      expected_error_rate_floor_pct: null,
      expected_error_rate_ceiling_pct: null,
      adaptive_multiplier: 1,
      model_status: 'insufficient_history',
    };

    if (totalRuns > 0) {
      actualErrorRatePct = Number(((weightedErrorUnits / totalRuns) * 100).toFixed(3));
      const seasonalityModel = computeSeasonalityModel({
        runs: seasonalityRuns,
        currentWeekday,
        minRunsPerDay: Number(config.seasonality?.min_runs_per_day || 0),
        bandMultiplier: Number(config.seasonality?.band_multiplier || 1),
        partialFailureWeight: Number(config.partial_failure_weight ?? 0.5),
      });
      seasonality = {
        ...seasonality,
        ...seasonalityModel,
      };

      const expectedErrorRatePct = seasonalityModel.expected_error_rate_pct ?? actualErrorRatePct;
      const adaptiveMultiplier = clamp(
        Number((expectedErrorRatePct > 0 ? (expectedErrorRatePct / Math.max(actualErrorRatePct, 0.001)) : 1).toFixed(3)),
        Number(config.seasonality?.adaptive_multiplier_min || 0.1),
        Number(config.seasonality?.adaptive_multiplier_max || 10),
      );
      seasonality.adaptive_multiplier = adaptiveMultiplier;

      if (errorBudgetPct > 0) {
        budgetBurnPct = Number(((actualErrorRatePct / errorBudgetPct) * 100).toFixed(3));
        burnRate = Number((actualErrorRatePct / errorBudgetPct).toFixed(3));
        adaptiveBudgetBurnPct = Number((budgetBurnPct / adaptiveMultiplier).toFixed(3));
        adaptiveBurnRate = Number((burnRate / adaptiveMultiplier).toFixed(3));
        remainingBudgetPct = Number(Math.max(0, errorBudgetPct - actualErrorRatePct).toFixed(3));
      } else {
        budgetBurnPct = weightedErrorUnits > 0 ? 1000 : 0;
        burnRate = weightedErrorUnits > 0 ? 10 : 0;
        adaptiveBudgetBurnPct = Number((budgetBurnPct / adaptiveMultiplier).toFixed(3));
        adaptiveBurnRate = Number((burnRate / adaptiveMultiplier).toFixed(3));
        remainingBudgetPct = 0;
      }

      const statusBurnPct = adaptiveBudgetBurnPct ?? budgetBurnPct;
      if (statusBurnPct > 200) {
        status = 'critical_over_budget';
        alert = 'high';
      } else if (statusBurnPct > 100) {
        status = 'over_budget';
        alert = 'medium';
      } else if (statusBurnPct >= 80) {
        status = 'near_budget';
        alert = 'watch';
      } else {
        status = 'within_budget';
      }
    }

    return {
      source,
      status,
      alert,
      target_pct: targetPct,
      error_budget_pct: errorBudgetPct,
      total_runs: totalRuns,
      ok_runs: okRuns,
      partial_failure_runs: partialFailureRuns,
      failed_runs: failedRuns,
      weighted_error_units: weightedErrorUnits,
      actual_error_rate_pct: actualErrorRatePct,
      budget_burn_pct: budgetBurnPct,
      burn_rate: burnRate,
      adaptive_budget_burn_pct: adaptiveBudgetBurnPct,
      adaptive_burn_rate: adaptiveBurnRate,
      remaining_budget_pct: remainingBudgetPct,
      seasonality,
    };
  });

  return {
    available: true,
    note: rows.length ? null : 'no ingestion runs found in source SLO window',
    window_start: windowStart,
    window_end: windowEnd,
    seasonality_window_start: seasonalityWindowStart,
    seasonality_window_end: windowEnd,
    totals: {
      total_runs: sources.reduce((sum, source) => sum + source.total_runs, 0),
      ok_runs: sources.reduce((sum, source) => sum + source.ok_runs, 0),
      partial_failure_runs: sources.reduce((sum, source) => sum + source.partial_failure_runs, 0),
      failed_runs: sources.reduce((sum, source) => sum + source.failed_runs, 0),
      over_budget_sources: sources.filter((source) => source.total_runs > 0 && Number((source.adaptive_budget_burn_pct ?? source.budget_burn_pct) || 0) > 100).length,
      alerted_sources: sources.filter((source) => source.alert !== 'none').length,
    },
    sources,
  };
}

function computeSeasonalityModel({ runs, currentWeekday, minRunsPerDay, bandMultiplier, partialFailureWeight }) {
  const groups = new Map();
  for (let i = 0; i < 7; i += 1) {
    groups.set(i, []);
  }
  for (const row of runs || []) {
    if (row.weekday === null || row.weekday === undefined) continue;
    if (!groups.has(row.weekday)) continue;
    groups.get(row.weekday).push(row.status);
  }

  const dayProfiles = [];
  const dailyErrorRates = [];
  for (let day = 0; day < 7; day += 1) {
    const statuses = groups.get(day) || [];
    const totalRuns = statuses.length;
    const partialFailureRuns = statuses.filter((status) => status === 'partial_failure').length;
    const failedRuns = statuses.filter((status) => status === 'failed').length;
    const weightedErrorUnits = Number((failedRuns + (partialFailureRuns * partialFailureWeight)).toFixed(6));
    const errorRatePct = totalRuns
      ? Number(((weightedErrorUnits / totalRuns) * 100).toFixed(3))
      : null;
    if (errorRatePct !== null) dailyErrorRates.push(errorRatePct);
    dayProfiles.push({
      weekday: day,
      runs: totalRuns,
      error_rate_pct: errorRatePct,
    });
  }

  const currentDay = dayProfiles.find((row) => row.weekday === currentWeekday) || null;
  const sampledRates = dailyErrorRates.filter((value) => Number.isFinite(value));
  const medianRate = sampledRates.length
    ? Number(percentile([...sampledRates].sort((a, b) => a - b), 50).toFixed(3))
    : null;
  const madRaw = sampledRates.length
    ? percentile(sampledRates.map((v) => Math.abs(v - medianRate)).sort((a, b) => a - b), 50)
    : null;
  const madScaled = madRaw === null ? null : Number((madRaw * 1.4826).toFixed(3));
  const band = madScaled === null ? null : Number((madScaled * bandMultiplier).toFixed(3));
  const floor = band === null || medianRate === null ? null : Number(Math.max(0, medianRate - band).toFixed(3));
  const ceiling = band === null || medianRate === null ? null : Number((medianRate + band).toFixed(3));
  const expected = currentDay && currentDay.runs >= minRunsPerDay && currentDay.error_rate_pct !== null
    ? currentDay.error_rate_pct
    : medianRate;

  return {
    day_profiles: dayProfiles,
    current_day_runs: Number(currentDay?.runs || 0),
    current_day_error_rate_pct: currentDay?.error_rate_pct ?? null,
    expected_error_rate_pct: expected,
    expected_error_rate_floor_pct: floor,
    expected_error_rate_ceiling_pct: ceiling,
    model_status: currentDay && currentDay.runs >= minRunsPerDay ? 'trained' : 'fallback_median',
  };
}

function readSourceBaselines(db, config) {
  if (!tableExists(db, 'ingestion_run_metrics')) {
    return {
      available: false,
      note: 'ingestion_run_metrics table missing (run npm run db:hybrid:init)',
      totals: { anomalies: 0 },
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
      links_upserted
    FROM ingestion_run_metrics
    WHERE source IN (${DEFAULT_SOURCES.map(() => '?').join(',')})
    ORDER BY source ASC, run_completed_at DESC, run_id DESC
  `).all(...DEFAULT_SOURCES);

  if (!rows.length) {
    return {
      available: true,
      note: 'no ingestion run history found yet',
      totals: { anomalies: 0 },
      sources: DEFAULT_SOURCES.map((source) => ({
        source,
        status: 'insufficient_history',
        current: null,
        sample_runs: 0,
        baselines: {},
        anomalies: [],
      })),
    };
  }

  const grouped = new Map();
  for (const row of rows) {
    const source = String(row.source);
    if (!grouped.has(source)) grouped.set(source, []);
    grouped.get(source).push({
      run_id: row.run_id,
      status: row.status,
      run_completed_at: toIsoOrNull(row.run_completed_at),
      records_scanned: Number(row.records_scanned || 0),
      entities_upserted: Number(row.entities_upserted || 0),
      links_upserted: Number(row.links_upserted || 0),
    });
  }

  const metricDefs = [
    { key: 'records_scanned', label: 'records_scanned' },
    { key: 'entities_upserted', label: 'entities_upserted' },
    { key: 'links_upserted', label: 'links_upserted' },
  ];

  const sources = DEFAULT_SOURCES.map((source) => {
    const history = grouped.get(source) || [];
    const current = history[0] || null;
    const window = history.slice(1).filter((row) => row.status !== 'failed').slice(0, config.window_runs);

    const baselines = {};
    const anomalies = [];
    for (const metric of metricDefs) {
      const values = window.map((row) => Number(row[metric.key] || 0));
      const baseline = computeBaselineBand(values, config.sigma_multiplier);
      baselines[metric.label] = baseline;

      if (!current || values.length < config.min_samples) continue;

      const actual = Number(current[metric.key] || 0);
      if (actual < baseline.floor || actual > baseline.ceiling) {
        anomalies.push({
          metric: metric.label,
          actual,
          floor: baseline.floor,
          ceiling: baseline.ceiling,
          direction: actual < baseline.floor ? 'below_floor' : 'above_ceiling',
        });
      }
    }

    return {
      source,
      status: current && window.length >= config.min_samples ? 'ok' : 'insufficient_history',
      current,
      sample_runs: window.length,
      baselines,
      anomalies,
    };
  });

  return {
    available: true,
    note: null,
    totals: {
      anomalies: sources.reduce((sum, source) => sum + source.anomalies.length, 0),
    },
    sources,
  };
}

function persistBaselineSnapshots(db, { asOfIso, baselines }) {
  if (!tableExists(db, 'ingestion_baseline_snapshots')) {
    return {
      available: false,
      note: 'ingestion_baseline_snapshots table missing (run npm run db:hybrid:init)',
      written_rows: 0,
      health_run_at: asOfIso,
    };
  }

  if (!baselines?.available) {
    return {
      available: true,
      note: baselines?.note || 'baseline model unavailable; snapshot write skipped',
      written_rows: 0,
      health_run_at: asOfIso,
    };
  }

  const insert = db.prepare(`
    INSERT INTO ingestion_baseline_snapshots (
      source,
      health_run_at,
      current_run_id,
      current_run_completed_at,
      sample_runs,
      records_actual,
      records_floor,
      records_ceiling,
      entities_actual,
      entities_floor,
      entities_ceiling,
      links_actual,
      links_floor,
      links_ceiling,
      anomaly_count,
      anomalies_json
    )
    VALUES (
      @source,
      @health_run_at,
      @current_run_id,
      @current_run_completed_at,
      @sample_runs,
      @records_actual,
      @records_floor,
      @records_ceiling,
      @entities_actual,
      @entities_floor,
      @entities_ceiling,
      @links_actual,
      @links_floor,
      @links_ceiling,
      @anomaly_count,
      @anomalies_json
    )
    ON CONFLICT (source, health_run_at) DO UPDATE SET
      current_run_id = excluded.current_run_id,
      current_run_completed_at = excluded.current_run_completed_at,
      sample_runs = excluded.sample_runs,
      records_actual = excluded.records_actual,
      records_floor = excluded.records_floor,
      records_ceiling = excluded.records_ceiling,
      entities_actual = excluded.entities_actual,
      entities_floor = excluded.entities_floor,
      entities_ceiling = excluded.entities_ceiling,
      links_actual = excluded.links_actual,
      links_floor = excluded.links_floor,
      links_ceiling = excluded.links_ceiling,
      anomaly_count = excluded.anomaly_count,
      anomalies_json = excluded.anomalies_json
  `);

  const tx = db.transaction(() => {
    for (const source of baselines.sources || []) {
      const payload = {
        source: source.source,
        health_run_at: asOfIso,
        current_run_id: source.current?.run_id || null,
        current_run_completed_at: source.current?.run_completed_at || null,
        sample_runs: Number(source.sample_runs || 0),
        records_actual: source.current ? Number(source.current.records_scanned || 0) : null,
        records_floor: source.baselines?.records_scanned?.floor ?? null,
        records_ceiling: source.baselines?.records_scanned?.ceiling ?? null,
        entities_actual: source.current ? Number(source.current.entities_upserted || 0) : null,
        entities_floor: source.baselines?.entities_upserted?.floor ?? null,
        entities_ceiling: source.baselines?.entities_upserted?.ceiling ?? null,
        links_actual: source.current ? Number(source.current.links_upserted || 0) : null,
        links_floor: source.baselines?.links_upserted?.floor ?? null,
        links_ceiling: source.baselines?.links_upserted?.ceiling ?? null,
        anomaly_count: Number(source.anomalies?.length || 0),
        anomalies_json: JSON.stringify(source.anomalies || []),
      };
      insert.run(payload);
    }
  });
  tx();

  return {
    available: true,
    note: null,
    written_rows: Array.isArray(baselines.sources) ? baselines.sources.length : 0,
    health_run_at: asOfIso,
  };
}

function readBaselineTrends(db, config) {
  if (!tableExists(db, 'ingestion_baseline_snapshots')) {
    return {
      available: false,
      note: 'ingestion_baseline_snapshots table missing (run npm run db:hybrid:init)',
      sources: [],
    };
  }

  const rows = db.prepare(`
    SELECT
      source,
      health_run_at,
      anomaly_count,
      records_actual,
      entities_actual,
      links_actual
    FROM ingestion_baseline_snapshots
    WHERE source IN (${DEFAULT_SOURCES.map(() => '?').join(',')})
    ORDER BY source ASC, health_run_at DESC
  `).all(...DEFAULT_SOURCES);

  if (!rows.length) {
    return {
      available: true,
      note: 'no baseline snapshots recorded yet',
      sources: DEFAULT_SOURCES.map((source) => ({
        source,
        status: 'insufficient_history',
        snapshot_count: 0,
        latest_health_run_at: null,
        oldest_health_run_at: null,
        anomaly_count: null,
        metrics: null,
      })),
    };
  }

  const grouped = new Map();
  for (const row of rows) {
    const source = String(row.source);
    if (!grouped.has(source)) grouped.set(source, []);
    const list = grouped.get(source);
    if (list.length >= config.window_snapshots) continue;
    list.push({
      health_run_at: toIsoOrNull(row.health_run_at),
      anomaly_count: Number(row.anomaly_count || 0),
      records_actual: toNumberOrNull(row.records_actual),
      entities_actual: toNumberOrNull(row.entities_actual),
      links_actual: toNumberOrNull(row.links_actual),
    });
  }

  const sources = DEFAULT_SOURCES.map((source) => {
    const history = grouped.get(source) || [];
    if (history.length < 2) {
      return {
        source,
        status: 'insufficient_history',
        snapshot_count: history.length,
        latest_health_run_at: history[0]?.health_run_at || null,
        oldest_health_run_at: history[history.length - 1]?.health_run_at || null,
        anomaly_count: null,
        metrics: null,
      };
    }

    return {
      source,
      status: 'ok',
      snapshot_count: history.length,
      latest_health_run_at: history[0]?.health_run_at || null,
      oldest_health_run_at: history[history.length - 1]?.health_run_at || null,
      anomaly_count: summarizeTrend(history, 'anomaly_count'),
      metrics: {
        records_scanned: summarizeTrend(history, 'records_actual'),
        entities_upserted: summarizeTrend(history, 'entities_actual'),
        links_upserted: summarizeTrend(history, 'links_actual'),
      },
    };
  });

  return {
    available: true,
    note: null,
    sources,
  };
}

function summarizeTrend(history, key) {
  const values = history
    .map((row) => row[key])
    .filter((value) => value !== null && value !== undefined && Number.isFinite(value));

  if (!values.length) {
    return {
      latest: null,
      avg: null,
      oldest: null,
      delta_vs_oldest: null,
      delta_vs_oldest_pct: null,
      direction: 'flat',
    };
  }

  const latest = values[0];
  const oldest = values[values.length - 1];
  const avg = Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3));
  const deltaVsOldest = Number((latest - oldest).toFixed(3));

  return {
    latest,
    avg,
    oldest,
    delta_vs_oldest: deltaVsOldest,
    delta_vs_oldest_pct: signedPercentDelta(latest, oldest),
    direction: deltaVsOldest > 0 ? 'up' : deltaVsOldest < 0 ? 'down' : 'flat',
  };
}

function readMeetingPrepQualityTrends({ artifactDirInput }) {
  const artifactDir = path.resolve(artifactDirInput || 'artifacts');
  if (!fs.existsSync(artifactDir)) {
    return {
      available: false,
      note: 'artifact directory not found',
    };
  }

  const candidates = fs.readdirSync(artifactDir)
    .filter((name) => /^(meeting-prep-quality-.*|meeting-prep-phase\d+-.*)\.json$/i.test(name))
    .map((name) => {
      const fullPath = path.join(artifactDir, name);
      const stat = fs.statSync(fullPath);
      return {
        name,
        path: fullPath,
        mtimeMs: Number(stat.mtimeMs || 0),
      };
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name));

  if (!candidates.length) {
    return {
      available: true,
      note: 'no meeting-prep quality artifacts found',
      scanned_artifacts: 0,
      snapshots: 0,
      meetings_scored: 0,
      latest: null,
      oldest: null,
      drift_signals: [],
      escalation_lanes: [],
    };
  }

  const snapshots = [];
  let meetingsScored = 0;
  for (const candidate of candidates) {
    const parsed = parseJsonDocument(readTextFile(candidate.path));
    if (!parsed || typeof parsed !== 'object') continue;
    const meetings = Array.isArray(parsed.meetings) ? parsed.meetings : [];
    const scored = meetings
      .map((meeting) => meeting?.prepQuality || null)
      .filter((quality) => quality && Number.isFinite(Number(quality.score)));
    if (!scored.length) continue;

    meetingsScored += scored.length;
    const avgScore = Number((scored.reduce((sum, row) => sum + Number(row.score || 0), 0) / scored.length).toFixed(3));
    const avgGapCount = Number((scored.reduce((sum, row) => sum + Number(row.gapCount || 0), 0) / scored.length).toFixed(3));
    const levelCounts = countByKey(scored.map((row) => String(row.level || 'unknown').toLowerCase()));
    const failingChecks = scored
      .flatMap((row) => Array.isArray(row.coverageChecks) ? row.coverageChecks : [])
      .filter((check) => String(check?.status || '').toLowerCase() !== 'pass');
    const severityCounts = countByKey(failingChecks.map((check) => String(check?.severity || 'medium').toLowerCase()));
    const severityScore = Number(
      ((Number(severityCounts.high || 0) * 3) + (Number(severityCounts.medium || 0) * 2) + Number(severityCounts.low || 0)).toFixed(3)
    );

    snapshots.push({
      artifact: candidate.name,
      generated_at: new Date(candidate.mtimeMs).toISOString(),
      scored_meetings: scored.length,
      avg_score: avgScore,
      avg_gap_count: avgGapCount,
      severity_score: severityScore,
      levels: levelCounts,
      failing_check_severity: severityCounts,
    });
  }

  if (!snapshots.length) {
    return {
      available: true,
      note: 'meeting-prep quality artifacts found but no prepQuality payloads detected',
      scanned_artifacts: candidates.length,
      snapshots: 0,
      meetings_scored: 0,
      latest: null,
      oldest: null,
      drift_signals: [],
      escalation_lanes: [],
    };
  }

  const oldest = snapshots[0];
  const latest = snapshots[snapshots.length - 1];
  const driftSignals = buildMeetingPrepQualityDriftSignals({ oldest, latest });
  const escalationLanes = buildMeetingPrepQualityEscalationLanes(latest);

  return {
    available: true,
    note: null,
    scanned_artifacts: candidates.length,
    snapshots: snapshots.length,
    meetings_scored: meetingsScored,
    latest,
    oldest,
    drift_signals: driftSignals,
    escalation_lanes: escalationLanes,
  };
}

function buildMeetingPrepQualityDriftSignals({ oldest, latest }) {
  if (!oldest || !latest) return [];

  const signals = [];
  const scoreDelta = Number((Number(latest.avg_score || 0) - Number(oldest.avg_score || 0)).toFixed(3));
  const gapDelta = Number((Number(latest.avg_gap_count || 0) - Number(oldest.avg_gap_count || 0)).toFixed(3));
  const severityDelta = Number((Number(latest.severity_score || 0) - Number(oldest.severity_score || 0)).toFixed(3));
  const highDelta = Number((Number(latest.failing_check_severity?.high || 0) - Number(oldest.failing_check_severity?.high || 0)).toFixed(3));

  if (scoreDelta <= -5) {
    const severity = scoreDelta <= -20 ? 'high' : scoreDelta <= -10 ? 'medium' : 'low';
    signals.push({
      code: 'quality_score_drop',
      severity,
      delta: scoreDelta,
      message: `Average prep-quality score dropped by ${Math.abs(scoreDelta)} points vs oldest snapshot.`,
    });
  }

  if (gapDelta >= 1) {
    signals.push({
      code: 'quality_gap_growth',
      severity: gapDelta >= 3 ? 'high' : gapDelta >= 2 ? 'medium' : 'low',
      delta: gapDelta,
      message: `Average prep-quality gap count increased by ${gapDelta} vs oldest snapshot.`,
    });
  }

  if (severityDelta >= 2) {
    signals.push({
      code: 'gap_severity_growth',
      severity: severityDelta >= 6 ? 'high' : severityDelta >= 4 ? 'medium' : 'low',
      delta: severityDelta,
      message: `Failing-check severity score increased by ${severityDelta} vs oldest snapshot.`,
    });
  }

  if (highDelta >= 1) {
    signals.push({
      code: 'high_severity_gap_growth',
      severity: highDelta >= 2 ? 'high' : 'medium',
      delta: highDelta,
      message: `High-severity coverage check gaps increased by ${highDelta} vs oldest snapshot.`,
    });
  }

  return signals;
}

function buildMeetingPrepQualityEscalationLanes(latestSnapshot) {
  if (!latestSnapshot) return [];

  const highCount = Number(latestSnapshot.failing_check_severity?.high || 0);
  const mediumCount = Number(latestSnapshot.failing_check_severity?.medium || 0);
  const lowCount = Number(latestSnapshot.failing_check_severity?.low || 0);
  const lanes = [];

  if (highCount > 0) {
    lanes.push({
      lane: 'immediate_owner_escalation',
      severity: 'high',
      trigger_count: highCount,
      message: 'Escalate to meeting owner immediately and require same-day remediation plan for high-severity prep gaps.',
    });
  }
  if (mediumCount > 0) {
    lanes.push({
      lane: 'same_day_quality_remediation',
      severity: 'medium',
      trigger_count: mediumCount,
      message: 'Route medium-severity prep gaps into same-day remediation checklist before outbound follow-up.',
    });
  }
  if (lowCount > 0) {
    lanes.push({
      lane: 'next_cycle_hardening',
      severity: 'low',
      trigger_count: lowCount,
      message: 'Track low-severity prep gaps in next-cycle hardening queue for deterministic cleanup.',
    });
  }
  if (!lanes.length) {
    lanes.push({
      lane: 'monitor_only',
      severity: 'low',
      trigger_count: 0,
      message: 'No prep-quality escalation needed; keep monitoring trendline drift.',
    });
  }

  return lanes;
}

function computeBaselineBand(values, sigmaMultiplier) {
  if (!values.length) {
    return {
      samples: 0,
      min: null,
      max: null,
      mean: null,
      median: null,
      mad: null,
      floor: 0,
      ceiling: 0,
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const median = percentile(sorted, 50);
  const madRaw = percentile(sorted.map((v) => Math.abs(v - median)).sort((a, b) => a - b), 50);
  const madScaled = Number((madRaw * 1.4826).toFixed(3));

  let band = madScaled * sigmaMultiplier;
  if (band <= 0) {
    const fallback = Math.max(1, median * 0.25);
    band = Number(fallback.toFixed(3));
  }

  const floor = Number(Math.max(0, median - band).toFixed(3));
  const ceiling = Number((median + band).toFixed(3));
  const mean = Number((sorted.reduce((sum, v) => sum + v, 0) / sorted.length).toFixed(3));

  return {
    samples: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean,
    median: Number(median.toFixed(3)),
    mad: madScaled,
    floor,
    ceiling,
  };
}

function countByKey(values) {
  const out = { high: 0, medium: 0, low: 0 };
  for (const value of values || []) {
    const key = String(value || '').toLowerCase();
    if (!key) continue;
    out[key] = Number(out[key] || 0) + 1;
  }
  return out;
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return 0;
  const n = sortedValues.length;
  const rank = (p / 100) * (n - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sortedValues[lower];
  const weight = rank - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
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

function readOptionalPercentArg(argv, name) {
  const raw = getArg(argv, name);
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`Invalid ${name} value: ${raw}. Expected a number between 0 and 100.`);
  }
  return Number(value.toFixed(3));
}

function readSourceSloTargets(argv, defaultTargetPct) {
  return {
    gmail: readOptionalPercentArg(argv, '--slo-target-gmail-pct') ?? defaultTargetPct,
    google_calendar: readOptionalPercentArg(argv, '--slo-target-google-calendar-pct') ?? defaultTargetPct,
    kb_ingest: readOptionalPercentArg(argv, '--slo-target-kb-ingest-pct') ?? defaultTargetPct,
  };
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function toSafeInt(value, fallback, min, max) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const rounded = Math.floor(n);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

function toSafeFloat(value, fallback, min, max) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Number(n.toFixed(3));
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function safeJson(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseJsonDocument(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;

  if (text.startsWith('{')) {
    return safeJson(text);
  }

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  return safeJson(text.slice(start, end + 1));
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

function evaluateThresholdBreaches({ sources, failures, reconciliation, baselines, sloBudgets, meetingPrepQuality, thresholds }) {
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

  if (thresholds.max_slo_budget_burn_pct !== null) {
    if (!sloBudgets?.available) {
      breaches.push({
        kind: 'slo_budget_unavailable',
        message: sloBudgets?.note || 'missing source SLO budget data',
      });
    } else {
      for (const source of sloBudgets.sources || []) {
        const effectiveBurnPct = source.adaptive_budget_burn_pct ?? source.budget_burn_pct;
        if (effectiveBurnPct === null || effectiveBurnPct === undefined) continue;
        if (effectiveBurnPct > thresholds.max_slo_budget_burn_pct) {
          breaches.push({
            kind: 'slo_budget_burn_pct',
            source: source.source,
            actual: effectiveBurnPct,
            limit: thresholds.max_slo_budget_burn_pct,
          });
        }
      }
    }
  }

  if (thresholds.max_quality_drift_signals !== null || thresholds.max_quality_severity_score !== null) {
    if (!meetingPrepQuality?.available) {
      breaches.push({
        kind: 'meeting_prep_quality_unavailable',
        message: meetingPrepQuality?.note || 'missing meeting prep quality trend data',
      });
    } else {
      if (thresholds.max_quality_drift_signals !== null) {
        const driftSignals = Array.isArray(meetingPrepQuality.drift_signals) ? meetingPrepQuality.drift_signals.length : 0;
        if (driftSignals > thresholds.max_quality_drift_signals) {
          breaches.push({
            kind: 'quality_drift_signals_count',
            actual: driftSignals,
            limit: thresholds.max_quality_drift_signals,
          });
        }
      }

      if (thresholds.max_quality_severity_score !== null) {
        const severityScore = Number(meetingPrepQuality?.latest?.severity_score || 0);
        if (severityScore > thresholds.max_quality_severity_score) {
          breaches.push({
            kind: 'quality_severity_score',
            actual: severityScore,
            limit: thresholds.max_quality_severity_score,
          });
        }
      }
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

  if (thresholds.max_baseline_anomalies !== null) {
    const anomalyCount = Number(baselines?.totals?.anomalies || 0);
    if (anomalyCount > thresholds.max_baseline_anomalies) {
      breaches.push({
        kind: 'baseline_anomalies_count',
        actual: anomalyCount,
        limit: thresholds.max_baseline_anomalies,
      });
    }
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

function exportTrendArtifacts(result, options) {
  const dirArg = options?.dirArg;
  if (!dirArg) {
    return {
      enabled: false,
      note: 'set --trend-artifact-dir to enable trend artifact export',
    };
  }

  const artifactDir = path.resolve(dirArg);
  fs.mkdirSync(artifactDir, { recursive: true });

  const stamped = toStamp(result.as_of);
  const stem = `${options.prefix}-${stamped}`;
  const jsonFile = `${stem}.json`;
  const mdFile = `${stem}.md`;
  const jsonPath = path.join(artifactDir, jsonFile);
  const mdPath = path.join(artifactDir, mdFile);

  const payload = buildTrendArtifactPayload(result);
  fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.writeFileSync(mdPath, `${buildTrendArtifactMarkdown(payload)}\n`, 'utf8');

  const pruned = pruneTrendArtifacts({
    artifactDir,
    prefix: options.prefix,
    retentionDays: options.retentionDays,
    retentionCount: options.retentionCount,
  });

  return {
    enabled: true,
    note: null,
    artifact_dir: artifactDir,
    written: [
      { file: jsonFile, path: jsonPath },
      { file: mdFile, path: mdPath },
    ],
    retention: {
      days: options.retentionDays,
      count: options.retentionCount,
    },
    pruned,
  };
}

function buildWeeklySloDigest(db, { asOf, windowDays, artifactDirInput }) {
  if (!tableExists(db, 'ingestion_baseline_snapshots')) {
    return {
      available: false,
      note: 'ingestion_baseline_snapshots table missing (run npm run db:hybrid:init)',
    };
  }

  const windowEnd = asOf.toISOString();
  const windowStartDate = new Date(asOf.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const windowStart = windowStartDate.toISOString();

  const rows = db.prepare(`
    SELECT source, health_run_at, anomaly_count
    FROM ingestion_baseline_snapshots
    WHERE source IN (${DEFAULT_SOURCES.map(() => '?').join(',')})
      AND health_run_at >= ?
      AND health_run_at <= ?
    ORDER BY source ASC, health_run_at DESC
  `).all(...DEFAULT_SOURCES, windowStart, windowEnd);

  const grouped = new Map();
  for (const row of rows) {
    const source = String(row.source);
    if (!grouped.has(source)) grouped.set(source, []);
    grouped.get(source).push({
      health_run_at: toIsoOrNull(row.health_run_at),
      anomaly_count: Number(row.anomaly_count || 0),
    });
  }

  const sources = DEFAULT_SOURCES.map((source) => {
    const history = grouped.get(source) || [];
    const snapshots = history.length;
    const anomalySnapshots = history.filter((row) => Number(row.anomaly_count || 0) > 0).length;
    const healthySnapshots = snapshots - anomalySnapshots;
    const avgAnomalyCount = snapshots
      ? Number((history.reduce((sum, row) => sum + Number(row.anomaly_count || 0), 0) / snapshots).toFixed(3))
      : null;
    const latestAnomalyCount = snapshots ? Number(history[0].anomaly_count || 0) : null;

    return {
      source,
      snapshots,
      healthy_snapshots: healthySnapshots,
      anomaly_snapshots: anomalySnapshots,
      anomaly_free_pct: snapshots ? Number(((healthySnapshots / snapshots) * 100).toFixed(3)) : null,
      avg_anomaly_count: avgAnomalyCount,
      latest_anomaly_count: latestAnomalyCount,
      latest_health_run_at: history[0]?.health_run_at || null,
    };
  });

  const totalSnapshots = sources.reduce((sum, source) => sum + source.snapshots, 0);
  const healthySnapshots = sources.reduce((sum, source) => sum + source.healthy_snapshots, 0);
  const anomalySnapshots = sources.reduce((sum, source) => sum + source.anomaly_snapshots, 0);

  const breachRollup = readBreachRollupFeed({
    artifactDirInput,
    windowStart,
    windowEnd,
  });

  return {
    available: true,
    note: totalSnapshots ? null : 'no baseline snapshots found in digest window',
    window_start: windowStart,
    window_end: windowEnd,
    total_snapshots: totalSnapshots,
    healthy_snapshots: healthySnapshots,
    anomaly_snapshots: anomalySnapshots,
    anomaly_free_pct: totalSnapshots ? Number(((healthySnapshots / totalSnapshots) * 100).toFixed(3)) : null,
    sources,
    breach_rollup: breachRollup,
  };
}

function readBreachRollupFeed({ artifactDirInput, windowStart, windowEnd }) {
  const artifactDir = path.resolve(artifactDirInput || 'artifacts');
  if (!fs.existsSync(artifactDir)) {
    return {
      total_events: 0,
      scanned_artifacts: 0,
      by_severity: [],
      by_source: [],
      note: 'artifact directory not found',
    };
  }

  const startMs = Date.parse(windowStart);
  const endMs = Date.parse(windowEnd);
  const candidates = fs.readdirSync(artifactDir)
    .filter((name) => /^ingestion-(trends|health)-.*\.json$/i.test(name))
    .sort((a, b) => a.localeCompare(b));

  const events = [];
  let scanned = 0;
  for (const name of candidates) {
    const fullPath = path.join(artifactDir, name);
    const parsed = safeJson(readTextFile(fullPath));
    if (!parsed || typeof parsed !== 'object') continue;

    const ts = toIsoOrNull(parsed.generated_at || parsed.as_of);
    if (!ts) continue;
    const tsMs = Date.parse(ts);
    if (!Number.isFinite(tsMs) || tsMs < startMs || tsMs > endMs) continue;

    scanned += 1;
    const breaches = Array.isArray(parsed.breaches) ? parsed.breaches : [];
    for (const breach of breaches) {
      const kind = String(breach?.kind || 'unknown');
      const source = String(breach?.source || 'global');
      events.push({
        occurred_at: ts,
        source,
        kind,
        severity: severityForBreachKind(kind),
      });
    }
  }

  const severityCounts = new Map();
  const sourceCounts = new Map();
  for (const event of events) {
    severityCounts.set(event.severity, (severityCounts.get(event.severity) || 0) + 1);
    if (!sourceCounts.has(event.source)) {
      sourceCounts.set(event.source, { source: event.source, count: 0, kinds: new Map() });
    }
    const bucket = sourceCounts.get(event.source);
    bucket.count += 1;
    bucket.kinds.set(event.kind, (bucket.kinds.get(event.kind) || 0) + 1);
  }

  const bySeverity = ['high', 'medium', 'low']
    .map((severity) => ({
      severity,
      count: Number(severityCounts.get(severity) || 0),
    }))
    .filter((row) => row.count > 0);

  const bySource = Array.from(sourceCounts.values())
    .map((bucket) => ({
      source: bucket.source,
      count: bucket.count,
      top_kinds: Array.from(bucket.kinds.entries())
        .map(([kind, count]) => ({ kind, count }))
        .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind))
        .slice(0, 5),
    }))
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));

  return {
    total_events: events.length,
    scanned_artifacts: scanned,
    by_severity: bySeverity,
    by_source: bySource,
    note: events.length ? null : 'no breaches found in scanned digest window artifacts',
  };
}

function severityForBreachKind(kind) {
  const k = String(kind || '').toLowerCase();
  if (['lag_hours', 'seen_drift_hours', 'baseline_anomalies_count', 'reconciliation_unavailable', 'slo_budget_unavailable', 'slo_budget_burn_pct', 'meeting_prep_quality_unavailable', 'quality_severity_score'].includes(k)) {
    return 'high';
  }
  if (['entity_delta_pct', 'chunk_ratio_delta', 'link_delta_pct', 'artifact_issues_count', 'quality_drift_signals_count'].includes(k)) {
    return 'medium';
  }
  return 'low';
}

function buildTrendArtifactPayload(result) {
  return {
    generated_at: result.as_of,
    db: result.db,
    trend_config: result.trend_config,
    baseline_config: result.baseline_config,
    slo_budget_config: result.slo_budget_config || null,
    slo_seasonality_config: result.slo_seasonality_config || null,
    totals: {
      entities: Number(result.totals?.entities || 0),
      chunks: Number(result.totals?.chunks || 0),
      failures_scanned_files: Number(result.failures?.scanned_files || 0),
      failures_issue_count: Array.isArray(result.failures?.issues) ? result.failures.issues.length : 0,
      baseline_anomalies: Number(result.baselines?.totals?.anomalies || 0),
      slo_over_budget_sources: Number(result.slo_budgets?.totals?.over_budget_sources || 0),
      breach_count: Array.isArray(result.breaches) ? result.breaches.length : 0,
    },
    sources: result.sources || [],
    reconciliation: result.reconciliation || null,
    slo_budgets: result.slo_budgets || null,
    baselines: result.baselines || null,
    meeting_prep_quality: result.meeting_prep_quality || null,
    trends: result.trends || null,
    thresholds: result.thresholds || null,
    breaches: result.breaches || [],
  };
}

function exportSloDigestArtifacts(result, options) {
  const dirArg = options?.dirArg;
  if (!dirArg) {
    return {
      enabled: false,
      note: 'set --slo-digest-dir to enable weekly SLO digest artifact export',
    };
  }

  const artifactDir = path.resolve(dirArg);
  fs.mkdirSync(artifactDir, { recursive: true });

  const stamped = toStamp(result.as_of);
  const stem = `${options.prefix}-${stamped}`;
  const jsonFile = `${stem}.json`;
  const mdFile = `${stem}.md`;
  const jsonPath = path.join(artifactDir, jsonFile);
  const mdPath = path.join(artifactDir, mdFile);

  const payload = buildSloDigestArtifactPayload(result);
  fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.writeFileSync(mdPath, `${buildSloDigestArtifactMarkdown(payload)}\n`, 'utf8');

  const pruned = pruneTrendArtifacts({
    artifactDir,
    prefix: options.prefix,
    retentionDays: options.retentionDays,
    retentionCount: options.retentionCount,
  });

  return {
    enabled: true,
    note: null,
    artifact_dir: artifactDir,
    written: [
      { file: jsonFile, path: jsonPath },
      { file: mdFile, path: mdPath },
    ],
    retention: {
      days: options.retentionDays,
      count: options.retentionCount,
    },
    pruned,
  };
}

function buildSloDigestArtifactPayload(result) {
  return {
    generated_at: result.as_of,
    db: result.db,
    slo_config: result.slo_config || null,
    digest: result.slo_digest || null,
  };
}

function buildSloDigestArtifactMarkdown(payload) {
  const digest = payload.digest || {};
  const lines = [];
  lines.push('# Weekly SLO Digest');
  lines.push('');
  lines.push(`- generated_at: ${payload.generated_at}`);
  lines.push(`- db: ${payload.db}`);
  lines.push(`- window_start: ${digest.window_start || 'n/a'}`);
  lines.push(`- window_end: ${digest.window_end || 'n/a'}`);
  lines.push(`- window_days: ${payload.slo_config?.window_days ?? 'n/a'}`);
  lines.push(`- total_snapshots: ${digest.total_snapshots ?? 0}`);
  lines.push(`- healthy_snapshots: ${digest.healthy_snapshots ?? 0}`);
  lines.push(`- anomaly_snapshots: ${digest.anomaly_snapshots ?? 0}`);
  lines.push(`- anomaly_free_pct: ${formatNumber(digest.anomaly_free_pct)}`);
  lines.push('');

  lines.push('## Sources');
  const sources = Array.isArray(digest.sources) ? digest.sources : [];
  if (!sources.length) {
    lines.push('- no source snapshots in window');
  } else {
    for (const source of sources) {
      lines.push(`- ${source.source}: snapshots=${source.snapshots}, healthy=${source.healthy_snapshots}, anomaly=${source.anomaly_snapshots}, anomaly_free_pct=${formatNumber(source.anomaly_free_pct)}, avg_anomaly_count=${formatNumber(source.avg_anomaly_count)}, latest_anomaly_count=${formatNumber(source.latest_anomaly_count)}`);
    }
  }
  lines.push('');

  lines.push('## Breach Rollup');
  const rollup = digest.breach_rollup || {};
  lines.push(`- total_events: ${rollup.total_events ?? 0}`);
  lines.push(`- scanned_artifacts: ${rollup.scanned_artifacts ?? 0}`);
  const bySeverity = Array.isArray(rollup.by_severity) ? rollup.by_severity : [];
  if (!bySeverity.length) {
    lines.push('- severities: none');
  } else {
    for (const row of bySeverity) {
      lines.push(`- severity=${row.severity}: count=${row.count}`);
    }
  }
  const bySource = Array.isArray(rollup.by_source) ? rollup.by_source : [];
  if (!bySource.length) {
    lines.push('- sources: none');
  } else {
    for (const row of bySource) {
      const topKinds = (row.top_kinds || []).map((k) => `${k.kind}:${k.count}`).join(', ');
      lines.push(`- source=${row.source}: count=${row.count}, top_kinds=${topKinds || 'n/a'}`);
    }
  }

  return lines.join('\n');
}

function buildTrendArtifactMarkdown(payload) {
  const lines = [];
  lines.push('# Ingestion Trend Audit Snapshot');
  lines.push('');
  lines.push(`- generated_at: ${payload.generated_at}`);
  lines.push(`- db: ${payload.db}`);
  lines.push(`- trend_window_snapshots: ${payload.trend_config?.window_snapshots ?? 'n/a'}`);
  lines.push(`- baseline_window_runs: ${payload.baseline_config?.window_runs ?? 'n/a'}`);
  lines.push(`- baseline_anomalies: ${payload.totals?.baseline_anomalies ?? 0}`);
  lines.push(`- slo_over_budget_sources: ${payload.totals?.slo_over_budget_sources ?? 0}`);
  lines.push(`- breaches: ${payload.totals?.breach_count ?? 0}`);
  lines.push('');

  lines.push('## Source Trends');
  const trendSources = Array.isArray(payload.trends?.sources) ? payload.trends.sources : [];
  if (!trendSources.length) {
    lines.push('- no trend sources available');
  } else {
    for (const source of trendSources) {
      lines.push(`- ${source.source}: status=${source.status}, snapshots=${source.snapshot_count}, latest_health_run_at=${source.latest_health_run_at || 'n/a'}, oldest_health_run_at=${source.oldest_health_run_at || 'n/a'}`);
      if (source.status !== 'ok') continue;
      lines.push(`  - anomalies_latest=${formatNumber(source.anomaly_count?.latest)}, anomalies_direction=${source.anomaly_count?.direction || 'flat'}, anomalies_delta_vs_oldest=${formatNumber(source.anomaly_count?.delta_vs_oldest)}`);
      lines.push(`  - records_latest=${formatNumber(source.metrics?.records_scanned?.latest)}, records_direction=${source.metrics?.records_scanned?.direction || 'flat'}, records_delta_vs_oldest=${formatNumber(source.metrics?.records_scanned?.delta_vs_oldest)}`);
      lines.push(`  - entities_latest=${formatNumber(source.metrics?.entities_upserted?.latest)}, entities_direction=${source.metrics?.entities_upserted?.direction || 'flat'}, entities_delta_vs_oldest=${formatNumber(source.metrics?.entities_upserted?.delta_vs_oldest)}`);
      lines.push(`  - links_latest=${formatNumber(source.metrics?.links_upserted?.latest)}, links_direction=${source.metrics?.links_upserted?.direction || 'flat'}, links_delta_vs_oldest=${formatNumber(source.metrics?.links_upserted?.delta_vs_oldest)}`);
    }
  }
  lines.push('');

  lines.push('## Meeting Prep Quality');
  const prep = payload.meeting_prep_quality || {};
  if (!prep.available) {
    lines.push(`- ${prep.note || 'meeting prep quality trend data unavailable'}`);
  } else {
    lines.push(`- scanned_artifacts=${prep.scanned_artifacts ?? 0}, snapshots=${prep.snapshots ?? 0}, meetings_scored=${prep.meetings_scored ?? 0}`);
    lines.push(`- latest_avg_score=${formatNumber(prep.latest?.avg_score)}, latest_avg_gap_count=${formatNumber(prep.latest?.avg_gap_count)}, latest_severity_score=${formatNumber(prep.latest?.severity_score)}`);
    const driftSignals = Array.isArray(prep.drift_signals) ? prep.drift_signals : [];
    if (!driftSignals.length) {
      lines.push('- drift_signals=none');
    } else {
      for (const signal of driftSignals) {
        lines.push(`- drift ${signal.code}: severity=${signal.severity}, delta=${formatNumber(signal.delta)}`);
      }
    }
  }
  lines.push('');

  lines.push('## Breaches');
  if (!Array.isArray(payload.breaches) || !payload.breaches.length) {
    lines.push('- none');
  } else {
    for (const breach of payload.breaches) {
      const source = breach.source ? `${breach.source} ` : '';
      const actual = breach.actual === undefined ? 'n/a' : breach.actual;
      const limit = breach.limit === undefined ? 'n/a' : breach.limit;
      lines.push(`- ${source}${breach.kind}: actual=${actual}, limit=${limit}`);
    }
  }

  return lines.join('\n');
}

function pruneTrendArtifacts({ artifactDir, prefix, retentionDays, retentionCount }) {
  if (retentionDays === null && retentionCount === null) {
    return [];
  }

  const nowMs = Date.now();
  const extPattern = /\.(json|md)$/i;
  const files = fs.readdirSync(artifactDir)
    .filter((name) => name.startsWith(`${prefix}-`) && extPattern.test(name))
    .map((name) => {
      const fullPath = path.join(artifactDir, name);
      const stat = fs.statSync(fullPath);
      return {
        name,
        path: fullPath,
        mtimeMs: Number(stat.mtimeMs || 0),
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));

  const groups = new Map();
  for (const file of files) {
    const snapshotStem = file.name.replace(extPattern, '');
    if (!groups.has(snapshotStem)) {
      groups.set(snapshotStem, {
        stem: snapshotStem,
        latestMtimeMs: file.mtimeMs,
        files: [],
      });
    }
    const group = groups.get(snapshotStem);
    group.latestMtimeMs = Math.max(group.latestMtimeMs, file.mtimeMs);
    group.files.push(file);
  }

  const snapshots = Array.from(groups.values())
    .sort((a, b) => b.latestMtimeMs - a.latestMtimeMs || a.stem.localeCompare(b.stem));

  const pruneMap = new Map();
  if (retentionCount !== null) {
    snapshots.slice(retentionCount).forEach((snapshot) => {
      for (const file of snapshot.files) {
        pruneMap.set(file.path, { ...file, reason: 'retention_count' });
      }
    });
  }

  if (retentionDays !== null) {
    const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
    for (const snapshot of snapshots) {
      if (nowMs - snapshot.latestMtimeMs <= maxAgeMs) continue;
      for (const file of snapshot.files) {
        if (!pruneMap.has(file.path)) {
          pruneMap.set(file.path, { ...file, reason: 'retention_days' });
        }
      }
    }
  }

  const pruned = [];
  for (const file of pruneMap.values()) {
    try {
      fs.unlinkSync(file.path);
      pruned.push({
        file: file.name,
        path: file.path,
        reason: file.reason,
      });
    } catch {
      // Ignore failed prune to keep report generation resilient.
    }
  }

  return pruned;
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

function signedPercentDelta(current, previous) {
  if (previous === null || previous === undefined) return null;
  if (previous === 0) return current === 0 ? 0 : 100;
  return Number((((current - previous) / previous) * 100).toFixed(3));
}

function toNumberOrNull(value) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toStamp(iso) {
  const d = parseIso(iso) || new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function sanitizeFileStem(value) {
  const cleaned = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'ingestion-trends';
}

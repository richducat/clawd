#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    canaryJson: "",
    liveJson: "",
    outDir: "artifacts",
    runDate: "",
    maxDriftSignals: null,
    maxDriftSeverityScore: null,
    maxSourceLagDeltaHours: 2,
    maxSourceSeenDriftDeltaHours: 4,
    maxTotalsDeltaPct: 25,
  };

  for (let idx = 0; idx < argv.length; idx += 1) {
    const token = argv[idx];
    const next = argv[idx + 1];
    if (token === "--canary-json") {
      args.canaryJson = String(next || "").trim();
      idx += 1;
    } else if (token === "--live-json") {
      args.liveJson = String(next || "").trim();
      idx += 1;
    } else if (token === "--out-dir") {
      args.outDir = String(next || "").trim() || "artifacts";
      idx += 1;
    } else if (token === "--run-date") {
      args.runDate = String(next || "").trim();
      idx += 1;
    } else if (token === "--max-drift-signals") {
      const value = Number(next);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Invalid --max-drift-signals value: ${next}`);
      }
      args.maxDriftSignals = Math.floor(value);
      idx += 1;
    } else if (token === "--max-drift-severity-score") {
      const value = Number(next);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Invalid --max-drift-severity-score value: ${next}`);
      }
      args.maxDriftSeverityScore = Math.floor(value);
      idx += 1;
    } else if (token === "--max-source-lag-delta-hours") {
      const value = Number(next);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Invalid --max-source-lag-delta-hours value: ${next}`);
      }
      args.maxSourceLagDeltaHours = value;
      idx += 1;
    } else if (token === "--max-source-seen-drift-delta-hours") {
      const value = Number(next);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Invalid --max-source-seen-drift-delta-hours value: ${next}`);
      }
      args.maxSourceSeenDriftDeltaHours = value;
      idx += 1;
    } else if (token === "--max-totals-delta-pct") {
      const value = Number(next);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Invalid --max-totals-delta-pct value: ${next}`);
      }
      args.maxTotalsDeltaPct = value;
      idx += 1;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }

  if (!args.liveJson) {
    throw new Error("--live-json is required");
  }
  return args;
}

function toNumberOrNull(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function percentDelta(current, baseline) {
  const c = toNumberOrNull(current);
  const b = toNumberOrNull(baseline);
  if (c == null || b == null) return null;
  if (b === 0) return c === 0 ? 0 : 100;
  return ((c - b) / Math.abs(b)) * 100;
}

function safeReadJson(filePath) {
  const payload = fs.readFileSync(filePath, "utf8");
  return JSON.parse(payload);
}

function appendGitHubOutput(kvPairs) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;
  const lines = Object.entries(kvPairs).map(([key, value]) => `${key}=${value}`);
  fs.appendFileSync(outputFile, `${lines.join("\n")}\n`, "utf8");
}

function sourceMap(doc) {
  const entries = Array.isArray(doc?.sources) ? doc.sources : [];
  const map = new Map();
  for (const row of entries) {
    const key = String(row?.source || "").trim();
    if (!key) continue;
    map.set(key, row);
  }
  return map;
}

function severityRank(level) {
  if (level === "high") return 3;
  if (level === "medium") return 2;
  return 1;
}

function severityWeight(level) {
  if (level === "high") return 5;
  if (level === "medium") return 3;
  return 1;
}

function categoryForCode(code) {
  const map = {
    source_missing: "coverage",
    source_status_changed: "status",
    source_lag_delta_exceeded: "latency",
    source_seen_drift_delta_exceeded: "cursor_freshness",
    failure_issues_increased: "artifacts",
    threshold_breaches_increased: "thresholds",
    baseline_anomalies_increased: "baselines",
    entity_totals_delta_exceeded: "volume",
    chunk_totals_delta_exceeded: "volume",
  };
  return map[code] || "general";
}

function withTaxonomy(signal) {
  const severity = String(signal?.severity || "low");
  const code = String(signal?.code || "unknown");
  return {
    ...signal,
    severity,
    category: String(signal?.category || categoryForCode(code)),
    severity_weight: severityWeight(severity),
  };
}

function compare(canary, live, thresholds) {
  const signals = [];
  function addSignal(signal) {
    signals.push(withTaxonomy(signal));
  }
  const canarySources = sourceMap(canary);
  const liveSources = sourceMap(live);
  const allSources = [...new Set([...canarySources.keys(), ...liveSources.keys()])].sort();

  for (const source of allSources) {
    const c = canarySources.get(source) || null;
    const l = liveSources.get(source) || null;
    if (!c || !l) {
      addSignal({
        code: "source_missing",
        severity: "high",
        source,
        message: `Source "${source}" missing in ${!c ? "canary" : "live"} report.`,
      });
      continue;
    }

    const cStatus = String(c.status || "unknown");
    const lStatus = String(l.status || "unknown");
    if (cStatus !== lStatus) {
      addSignal({
        code: "source_status_changed",
        severity: "medium",
        source,
        canary: cStatus,
        live: lStatus,
        message: `Source "${source}" status changed: canary=${cStatus}, live=${lStatus}.`,
      });
    }

    const lagDelta = toNumberOrNull(l.lag_hours) != null && toNumberOrNull(c.lag_hours) != null ? Number((l.lag_hours - c.lag_hours).toFixed(3)) : null;
    if (lagDelta != null && lagDelta > thresholds.max_source_lag_delta_hours) {
      addSignal({
        code: "source_lag_delta_exceeded",
        severity: "medium",
        source,
        canary_lag_hours: c.lag_hours,
        live_lag_hours: l.lag_hours,
        lag_delta_hours: lagDelta,
        threshold_hours: thresholds.max_source_lag_delta_hours,
        message: `Source "${source}" lag delta ${lagDelta}h exceeds threshold ${thresholds.max_source_lag_delta_hours}h.`,
      });
    }

    const seenDriftDelta =
      toNumberOrNull(l.seen_drift_hours) != null && toNumberOrNull(c.seen_drift_hours) != null
        ? Number((l.seen_drift_hours - c.seen_drift_hours).toFixed(3))
        : null;
    if (seenDriftDelta != null && seenDriftDelta > thresholds.max_source_seen_drift_delta_hours) {
      addSignal({
        code: "source_seen_drift_delta_exceeded",
        severity: "medium",
        source,
        canary_seen_drift_hours: c.seen_drift_hours,
        live_seen_drift_hours: l.seen_drift_hours,
        seen_drift_delta_hours: seenDriftDelta,
        threshold_hours: thresholds.max_source_seen_drift_delta_hours,
        message: `Source "${source}" seen drift delta ${seenDriftDelta}h exceeds threshold ${thresholds.max_source_seen_drift_delta_hours}h.`,
      });
    }
  }

  const canaryFailures = Array.isArray(canary?.failures?.issues) ? canary.failures.issues.length : 0;
  const liveFailures = Array.isArray(live?.failures?.issues) ? live.failures.issues.length : 0;
  if (liveFailures > canaryFailures) {
    addSignal({
      code: "failure_issues_increased",
      severity: "high",
      canary_failures: canaryFailures,
      live_failures: liveFailures,
      message: `Live artifact issues (${liveFailures}) exceeded canary (${canaryFailures}).`,
    });
  }

  const canaryBreaches = Array.isArray(canary?.breaches) ? canary.breaches.length : 0;
  const liveBreaches = Array.isArray(live?.breaches) ? live.breaches.length : 0;
  if (liveBreaches > canaryBreaches) {
    addSignal({
      code: "threshold_breaches_increased",
      severity: "high",
      canary_breaches: canaryBreaches,
      live_breaches: liveBreaches,
      message: `Live threshold breaches (${liveBreaches}) exceeded canary (${canaryBreaches}).`,
    });
  }

  const canaryAnomalies = toNumberOrNull(canary?.baselines?.totals?.anomalies) || 0;
  const liveAnomalies = toNumberOrNull(live?.baselines?.totals?.anomalies) || 0;
  if (liveAnomalies > canaryAnomalies) {
    addSignal({
      code: "baseline_anomalies_increased",
      severity: "medium",
      canary_anomalies: canaryAnomalies,
      live_anomalies: liveAnomalies,
      message: `Live baseline anomalies (${liveAnomalies}) exceeded canary (${canaryAnomalies}).`,
    });
  }

  const canaryEntities = toNumberOrNull(canary?.totals?.entities) || 0;
  const liveEntities = toNumberOrNull(live?.totals?.entities) || 0;
  const canaryChunks = toNumberOrNull(canary?.totals?.chunks) || 0;
  const liveChunks = toNumberOrNull(live?.totals?.chunks) || 0;
  const entityDeltaPct = percentDelta(liveEntities, canaryEntities);
  const chunkDeltaPct = percentDelta(liveChunks, canaryChunks);
  if (entityDeltaPct != null && Math.abs(entityDeltaPct) > thresholds.max_totals_delta_pct) {
    addSignal({
      code: "entity_totals_delta_exceeded",
      severity: "medium",
      canary_entities: canaryEntities,
      live_entities: liveEntities,
      entity_delta_pct: Number(entityDeltaPct.toFixed(3)),
      threshold_pct: thresholds.max_totals_delta_pct,
      message: `Entity totals delta ${entityDeltaPct.toFixed(2)}% exceeded threshold ${thresholds.max_totals_delta_pct}%.`,
    });
  }
  if (chunkDeltaPct != null && Math.abs(chunkDeltaPct) > thresholds.max_totals_delta_pct) {
    addSignal({
      code: "chunk_totals_delta_exceeded",
      severity: "medium",
      canary_chunks: canaryChunks,
      live_chunks: liveChunks,
      chunk_delta_pct: Number(chunkDeltaPct.toFixed(3)),
      threshold_pct: thresholds.max_totals_delta_pct,
      message: `Chunk totals delta ${chunkDeltaPct.toFixed(2)}% exceeded threshold ${thresholds.max_totals_delta_pct}%.`,
    });
  }

  const highestSeverity = signals
    .map((signal) => signal.severity || "low")
    .sort((left, right) => severityRank(right) - severityRank(left))[0];

  const severity_counts = { low: 0, medium: 0, high: 0 };
  const category_counts = {};
  let total_severity_score = 0;
  for (const signal of signals) {
    if (signal.severity in severity_counts) {
      severity_counts[signal.severity] += 1;
    }
    const category = signal.category || "general";
    category_counts[category] = (category_counts[category] || 0) + 1;
    total_severity_score += toNumberOrNull(signal.severity_weight) || 0;
  }

  return {
    signals,
    highest_severity: highestSeverity || "none",
    severity_counts,
    category_counts,
    total_severity_score,
    canary_metrics: {
      failures: canaryFailures,
      breaches: canaryBreaches,
      anomalies: canaryAnomalies,
      totals: { entities: canaryEntities, chunks: canaryChunks },
    },
    live_metrics: {
      failures: liveFailures,
      breaches: liveBreaches,
      anomalies: liveAnomalies,
      totals: { entities: liveEntities, chunks: liveChunks },
    },
  };
}

function toMarkdown(report) {
  const lines = [
    "# Canary vs Live Drift Report",
    "",
    `- Status: ${report.status}`,
    `- Generated (UTC): ${report.generated_at_utc}`,
    `- Run date: ${report.run_date}`,
    `- Canary baseline: ${report.inputs.canary_json || "unavailable"}`,
    `- Live health file: ${report.inputs.live_json}`,
    `- Signal count: ${report.summary.signal_count}`,
    `- Total severity score: ${report.summary.total_severity_score}`,
    `- Highest severity: ${report.summary.highest_severity}`,
    "",
    "## Thresholds",
    "",
    `- max_source_lag_delta_hours: ${report.thresholds.max_source_lag_delta_hours}`,
    `- max_source_seen_drift_delta_hours: ${report.thresholds.max_source_seen_drift_delta_hours}`,
    `- max_totals_delta_pct: ${report.thresholds.max_totals_delta_pct}`,
    `- max_drift_signals: ${report.thresholds.max_drift_signals ?? "report_only"}`,
    `- max_drift_severity_score: ${report.thresholds.max_drift_severity_score ?? "report_only"}`,
    "",
  ];

  if (!report.inputs.canary_json) {
    lines.push("## Note", "", "- Canary baseline artifact for this date was not available; drift comparison skipped.");
    return `${lines.join("\n")}\n`;
  }

  lines.push("## Signals", "");
  if (!report.signals.length) {
    lines.push("- none");
  } else {
    lines.push(
      `- Severity counts: high=${report.summary.severity_counts.high}, medium=${report.summary.severity_counts.medium}, low=${report.summary.severity_counts.low}`,
    );
    const categoryPairs = Object.entries(report.summary.category_counts || {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([category, count]) => `${category}=${count}`);
    lines.push(`- Category counts: ${categoryPairs.length ? categoryPairs.join(", ") : "none"}`);
    lines.push("");
    for (const signal of report.signals) {
      lines.push(
        `- [${signal.severity}] [${signal.category}] (weight=${signal.severity_weight}) ${signal.code}: ${signal.message}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(args.outDir);
  fs.mkdirSync(outDir, { recursive: true });

  const runDate = args.runDate || new Date().toISOString().slice(0, 10);
  const livePath = path.resolve(args.liveJson);
  if (!fs.existsSync(livePath)) {
    throw new Error(`Live health JSON not found: ${livePath}`);
  }
  const liveDoc = safeReadJson(livePath);

  const canaryPath = args.canaryJson ? path.resolve(args.canaryJson) : "";
  const canaryAvailable = !!canaryPath && fs.existsSync(canaryPath);
  const thresholds = {
    max_source_lag_delta_hours: args.maxSourceLagDeltaHours,
    max_source_seen_drift_delta_hours: args.maxSourceSeenDriftDeltaHours,
    max_totals_delta_pct: args.maxTotalsDeltaPct,
    max_drift_signals: args.maxDriftSignals,
    max_drift_severity_score: args.maxDriftSeverityScore,
  };

  const report = {
    generated_at_utc: new Date().toISOString(),
    run_date: runDate,
    status: "baseline_unavailable",
    inputs: {
      canary_json: canaryAvailable ? path.relative(process.cwd(), canaryPath) : "",
      live_json: path.relative(process.cwd(), livePath),
    },
    thresholds,
    summary: {
      signal_count: 0,
      total_severity_score: 0,
      highest_severity: "none",
      gate_breached: false,
      gate_breached_by_signal_count: false,
      gate_breached_by_severity_score: false,
      severity_counts: { low: 0, medium: 0, high: 0 },
      category_counts: {},
    },
    signals: [],
    metrics: {},
  };

  if (canaryAvailable) {
    const canaryDoc = safeReadJson(canaryPath);
    const comparison = compare(canaryDoc, liveDoc, thresholds);
    report.signals = comparison.signals;
    report.summary.signal_count = comparison.signals.length;
    report.summary.total_severity_score = comparison.total_severity_score;
    report.summary.highest_severity = comparison.highest_severity;
    report.summary.severity_counts = comparison.severity_counts;
    report.summary.category_counts = comparison.category_counts;
    report.metrics = {
      canary: comparison.canary_metrics,
      live: comparison.live_metrics,
    };
    report.status = comparison.signals.length > 0 ? "drift" : "ok";
  } else {
    report.metrics = {
      live: {
        failures: Array.isArray(liveDoc?.failures?.issues) ? liveDoc.failures.issues.length : 0,
        breaches: Array.isArray(liveDoc?.breaches) ? liveDoc.breaches.length : 0,
        anomalies: toNumberOrNull(liveDoc?.baselines?.totals?.anomalies) || 0,
      },
    };
  }

  report.summary.gate_breached_by_signal_count =
    args.maxDriftSignals != null && report.summary.signal_count > args.maxDriftSignals;
  report.summary.gate_breached_by_severity_score =
    args.maxDriftSeverityScore != null && report.summary.total_severity_score > args.maxDriftSeverityScore;
  report.summary.gate_breached =
    report.summary.gate_breached_by_signal_count || report.summary.gate_breached_by_severity_score;

  const stem = `canary-live-drift-${runDate}`;
  const jsonPath = path.join(outDir, `${stem}.json`);
  const mdPath = path.join(outDir, `${stem}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, toMarkdown(report), "utf8");

  const output = {
    status: report.status,
    signal_count: report.summary.signal_count,
    total_severity_score: report.summary.total_severity_score,
    gate_breached: report.summary.gate_breached,
    gate_breached_by_signal_count: report.summary.gate_breached_by_signal_count,
    gate_breached_by_severity_score: report.summary.gate_breached_by_severity_score,
    json_path: path.relative(process.cwd(), jsonPath),
    md_path: path.relative(process.cwd(), mdPath),
  };
  appendGitHubOutput({
    drift_status: output.status,
    drift_signal_count: String(output.signal_count),
    drift_total_severity_score: String(output.total_severity_score),
    drift_gate_breached: String(output.gate_breached),
    drift_gate_breached_by_signal_count: String(output.gate_breached_by_signal_count),
    drift_gate_breached_by_severity_score: String(output.gate_breached_by_severity_score),
    drift_json_path: output.json_path,
    drift_md_path: output.md_path,
  });
  console.log(JSON.stringify(output, null, 2));

  if (report.summary.gate_breached) {
    process.exit(2);
  }
}

main();

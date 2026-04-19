#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {
    outDir: "artifacts",
    runDate: "",
    evidenceDir: "",
    staleAfterMinutes: null,
  };

  for (let idx = 0; idx < argv.length; idx += 1) {
    const token = argv[idx];
    if (token === "--out-dir") {
      args.outDir = String(argv[idx + 1] || "").trim() || "artifacts";
      idx += 1;
      continue;
    }
    if (token === "--run-date") {
      args.runDate = String(argv[idx + 1] || "").trim();
      idx += 1;
      continue;
    }
    if (token === "--evidence-dir") {
      args.evidenceDir = String(argv[idx + 1] || "").trim();
      idx += 1;
      continue;
    }
    if (token === "--stale-after-minutes") {
      args.staleAfterMinutes = toPositiveIntegerOrNull(argv[idx + 1]);
      idx += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

function toPositiveIntegerOrNull(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed <= 0) return null;
  return Math.floor(parsed);
}

function toIsoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeDateToken(value) {
  const token = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  return new Date().toISOString().slice(0, 10);
}

function parseList(value) {
  if (!value) return [];
  return String(value)
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseJsonList(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed.map((item) => String(item).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function unique(items) {
  return [...new Set(items)];
}

function parseTokens(value) {
  return unique([...parseList(value), ...parseJsonList(value)]).filter(Boolean);
}

function normalizeEvidenceItem(raw, sourcePath) {
  if (typeof raw === "string") {
    const token = raw.trim();
    if (!token) return null;
    if (token.startsWith("ack-")) {
      return { ack_marker: token, ack_key: "", acknowledged_at_utc: null, source: sourcePath };
    }
    return { ack_marker: "", ack_key: token, acknowledged_at_utc: null, source: sourcePath };
  }

  if (typeof raw !== "object" || raw == null) return null;
  const ackMarker = String(raw.ack_marker || raw.marker || "").trim();
  const ackKey = String(raw.ack_key || raw.key || "").trim();
  if (!ackMarker && !ackKey) return null;

  return {
    ack_marker: ackMarker,
    ack_key: ackKey,
    acknowledged_at_utc: toIsoOrNull(raw.acknowledged_at_utc || raw.ack_at || raw.ts),
    source: String(raw.source || sourcePath || "").trim() || sourcePath,
  };
}

function collectEvidenceFromJson(payload, sourcePath) {
  const items = [];

  if (Array.isArray(payload)) {
    for (const raw of payload) {
      const item = normalizeEvidenceItem(raw, sourcePath);
      if (item) items.push(item);
    }
    return items;
  }

  if (typeof payload !== "object" || payload == null) return items;

  const direct = normalizeEvidenceItem(payload, sourcePath);
  if (direct) items.push(direct);

  for (const marker of Array.isArray(payload.ack_markers) ? payload.ack_markers : []) {
    const item = normalizeEvidenceItem({ ack_marker: marker }, sourcePath);
    if (item) items.push(item);
  }
  for (const key of Array.isArray(payload.ack_keys) ? payload.ack_keys : []) {
    const item = normalizeEvidenceItem({ ack_key: key }, sourcePath);
    if (item) items.push(item);
  }
  for (const raw of Array.isArray(payload.acknowledgements) ? payload.acknowledgements : []) {
    const item = normalizeEvidenceItem(raw, sourcePath);
    if (item) items.push(item);
  }

  return items;
}

function readEvidenceFiles(evidenceDir) {
  if (!evidenceDir) return [];
  const resolvedDir = path.resolve(evidenceDir);
  if (!fs.existsSync(resolvedDir)) return [];
  if (!fs.statSync(resolvedDir).isDirectory()) return [];

  const files = fs
    .readdirSync(resolvedDir)
    .filter((name) => name.toLowerCase().endsWith(".json"))
    .sort((a, b) => a.localeCompare(b));

  const items = [];
  for (const file of files) {
    const fullPath = path.join(resolvedDir, file);
    try {
      const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      items.push(...collectEvidenceFromJson(parsed, path.relative(process.cwd(), fullPath)));
    } catch (error) {
      items.push({
        ack_marker: "",
        ack_key: "",
        acknowledged_at_utc: null,
        source: path.relative(process.cwd(), fullPath),
        parse_error: String(error?.message || error),
      });
    }
  }
  return items;
}

function minutesSince(iso) {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return Math.floor((Date.now() - date.getTime()) / (60 * 1000));
}

function appendGitHubOutput(kvPairs) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;
  const lines = [];
  for (const [key, value] of Object.entries(kvPairs)) {
    const normalized = String(value ?? "");
    if (normalized.includes("\n")) {
      lines.push(`${key}<<EOF`);
      lines.push(normalized);
      lines.push("EOF");
    } else {
      lines.push(`${key}=${normalized}`);
    }
  }
  fs.appendFileSync(outputFile, `${lines.join("\n")}\n`, "utf8");
}

function toMarkdown(summary) {
  const lines = [
    "# ACK Evidence Ingestion Summary",
    "",
    `- Generated (UTC): \`${summary.generated_at_utc}\``,
    `- Run date: \`${summary.run_date}\``,
    `- Evidence dir: \`${summary.evidence_dir || "n/a"}\``,
    `- Stale after minutes: \`${summary.stale_after_minutes}\``,
    `- Active markers: \`${summary.active_marker_count}\``,
    `- Active keys: \`${summary.active_key_count}\``,
    `- Stale evidence entries: \`${summary.stale_entry_count}\``,
    `- Parse errors: \`${summary.parse_error_count}\``,
  ];

  if (summary.stale_entry_samples.length > 0) {
    lines.push("", "## Stale Entry Samples");
    for (const entry of summary.stale_entry_samples) {
      lines.push(`- source=\`${entry.source}\`, marker=\`${entry.ack_marker || "n/a"}\`, key=\`${entry.ack_key || "n/a"}\`, acknowledged_at_utc=\`${entry.acknowledged_at_utc || "n/a"}\``);
    }
  }

  if (summary.parse_error_samples.length > 0) {
    lines.push("", "## Parse Error Samples");
    for (const entry of summary.parse_error_samples) {
      lines.push(`- source=\`${entry.source}\`, error=\`${entry.parse_error}\``);
    }
  }

  return `${lines.join("\n")}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const runDate = normalizeDateToken(args.runDate || process.env.RUN_DATE);
  const outDir = path.resolve(args.outDir);
  const evidenceDir = args.evidenceDir || process.env.ALERT_ACK_EVIDENCE_DIR || "";
  const staleAfterMinutes =
    args.staleAfterMinutes ?? toPositiveIntegerOrNull(process.env.ALERT_ACK_EVIDENCE_STALE_AFTER_MINUTES) ?? 10080;

  const envMarkerTokens = parseTokens(process.env.ALERT_ACK_EVIDENCE_MARKERS).map((marker) => ({
    ack_marker: marker,
    ack_key: "",
    acknowledged_at_utc: null,
    source: "env:ALERT_ACK_EVIDENCE_MARKERS",
  }));
  const envKeyTokens = parseTokens(process.env.ALERT_ACK_EVIDENCE_KEYS).map((key) => ({
    ack_marker: "",
    ack_key: key,
    acknowledged_at_utc: null,
    source: "env:ALERT_ACK_EVIDENCE_KEYS",
  }));

  const fileEvidence = readEvidenceFiles(evidenceDir);
  const rawEntries = [...envMarkerTokens, ...envKeyTokens, ...fileEvidence];

  const activeEntries = [];
  const staleEntries = [];
  const parseErrors = [];

  for (const entry of rawEntries) {
    if (entry.parse_error) {
      parseErrors.push(entry);
      continue;
    }

    if (!entry.ack_marker && !entry.ack_key) continue;

    const ageMinutes = minutesSince(entry.acknowledged_at_utc);
    const staleByAge = ageMinutes != null && ageMinutes > staleAfterMinutes;
    if (staleByAge) {
      staleEntries.push(entry);
      continue;
    }

    activeEntries.push(entry);
  }

  const activeMarkers = unique(activeEntries.map((entry) => entry.ack_marker).filter(Boolean));
  const activeKeys = unique(activeEntries.map((entry) => entry.ack_key).filter(Boolean));

  const summary = {
    schema_version: 1,
    generated_at_utc: new Date().toISOString(),
    run_date: runDate,
    evidence_dir: evidenceDir ? path.relative(process.cwd(), path.resolve(evidenceDir)) : "",
    stale_after_minutes: staleAfterMinutes,
    raw_entry_count: rawEntries.length,
    active_entry_count: activeEntries.length,
    stale_entry_count: staleEntries.length,
    parse_error_count: parseErrors.length,
    active_marker_count: activeMarkers.length,
    active_key_count: activeKeys.length,
    active_markers: activeMarkers,
    active_keys: activeKeys,
    stale_entry_samples: staleEntries.slice(0, 10),
    parse_error_samples: parseErrors.slice(0, 10),
  };

  fs.mkdirSync(outDir, { recursive: true });
  const stem = `ack-evidence-${runDate}`;
  const jsonPath = path.join(outDir, `${stem}.json`);
  const mdPath = path.join(outDir, `${stem}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, toMarkdown(summary), "utf8");

  appendGitHubOutput({
    ack_evidence_markers: activeMarkers.join(","),
    ack_evidence_keys: activeKeys.join(","),
    ack_evidence_json_path: path.relative(process.cwd(), jsonPath),
    ack_evidence_md_path: path.relative(process.cwd(), mdPath),
    ack_evidence_active_marker_count: String(activeMarkers.length),
    ack_evidence_active_key_count: String(activeKeys.length),
    ack_evidence_stale_entry_count: String(staleEntries.length),
    ack_evidence_parse_error_count: String(parseErrors.length),
    ack_evidence_stale_after_minutes: String(staleAfterMinutes),
  });

  console.log(JSON.stringify(summary, null, 2));
}

main();

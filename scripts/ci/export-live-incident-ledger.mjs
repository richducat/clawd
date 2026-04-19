#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = { outDir: "artifacts" };
  for (let idx = 0; idx < argv.length; idx += 1) {
    const token = argv[idx];
    if (token === "--out-dir") {
      args.outDir = String(argv[idx + 1] || "").trim() || "artifacts";
      idx += 1;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function normalizeBoolean(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function trimOrEmpty(value) {
  return String(value || "").trim();
}

function normalizeDateToken(value) {
  const token = trimOrEmpty(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return token;
  return new Date().toISOString().slice(0, 10);
}

function writeExclusive(filePath, contents) {
  try {
    fs.writeFileSync(filePath, contents, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error && error.code === "EEXIST") {
      throw new Error(`Immutable ledger write blocked: file already exists (${filePath})`);
    }
    throw error;
  }
}

function appendGitHubOutput(kvPairs) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;
  const lines = Object.entries(kvPairs).map(([key, value]) => `${key}=${value}`);
  fs.appendFileSync(outputFile, `${lines.join("\n")}\n`, "utf8");
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function buildLedgerEntry() {
  const runId = trimOrEmpty(process.env.GITHUB_RUN_ID) || "unknown";
  const runAttempt = trimOrEmpty(process.env.GITHUB_RUN_ATTEMPT) || "unknown";
  const runDate = normalizeDateToken(process.env.RUN_DATE);
  const breakGlass = normalizeBoolean(process.env.BREAK_GLASS_INPUT);
  const breakGlassReason = trimOrEmpty(process.env.BREAK_GLASS_REASON_INPUT);

  return {
    schema_version: 1,
    generated_at_utc: new Date().toISOString(),
    run: {
      mode: "live",
      date: runDate,
      id: runId,
      attempt: runAttempt,
      url:
        trimOrEmpty(process.env.RUN_URL) ||
        `https://github.com/${trimOrEmpty(process.env.GITHUB_REPOSITORY)}/actions/runs/${runId}`,
      workflow: trimOrEmpty(process.env.GITHUB_WORKFLOW),
      repository: trimOrEmpty(process.env.GITHUB_REPOSITORY),
      branch: trimOrEmpty(process.env.GITHUB_REF_NAME),
      commit_sha: trimOrEmpty(process.env.GITHUB_SHA),
    },
    approval_context: {
      environment: trimOrEmpty(process.env.LIVE_APPROVAL_ENVIRONMENT) || "hybrid-live",
      required: true,
      triggering_actor:
        trimOrEmpty(process.env.TRIGGER_ACTOR) || trimOrEmpty(process.env.GITHUB_TRIGGERING_ACTOR),
      dispatch_actor: trimOrEmpty(process.env.GITHUB_ACTOR),
      approved_actor_allowlist: trimOrEmpty(process.env.LIVE_ALLOWED_ACTORS_INPUT),
    },
    emergency_controls: {
      emergency_stop: normalizeBoolean(process.env.LIVE_EMERGENCY_STOP_INPUT),
      break_glass: breakGlass,
      break_glass_reason: breakGlass ? breakGlassReason : "",
    },
  };
}

function toMarkdown(entry, entrySha256) {
  const lines = [
    "# Live Incident Ledger Entry",
    "",
    `- Entry SHA256: \`${entrySha256}\``,
    `- Generated (UTC): \`${entry.generated_at_utc}\``,
    `- Run mode: \`${entry.run.mode}\``,
    `- Run date: \`${entry.run.date}\``,
    `- Run id: \`${entry.run.id}\``,
    `- Run attempt: \`${entry.run.attempt}\``,
    `- Run URL: ${entry.run.url}`,
    `- Workflow: \`${entry.run.workflow}\``,
    `- Repository: \`${entry.run.repository}\``,
    `- Branch: \`${entry.run.branch}\``,
    `- Commit SHA: \`${entry.run.commit_sha}\``,
    `- Approval environment: \`${entry.approval_context.environment}\``,
    `- Approval required: \`${entry.approval_context.required}\``,
    `- Triggering actor: \`${entry.approval_context.triggering_actor}\``,
    `- Dispatch actor: \`${entry.approval_context.dispatch_actor}\``,
    `- Approved actor allowlist: \`${entry.approval_context.approved_actor_allowlist}\``,
    `- Emergency stop flag: \`${entry.emergency_controls.emergency_stop}\``,
    `- Break glass: \`${entry.emergency_controls.break_glass}\``,
    `- Break glass reason: \`${entry.emergency_controls.break_glass_reason || "n/a"}\``,
  ];
  return `${lines.join("\n")}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(args.outDir);
  fs.mkdirSync(outDir, { recursive: true });

  const runDate = normalizeDateToken(process.env.RUN_DATE);
  const runId = trimOrEmpty(process.env.GITHUB_RUN_ID) || "unknown";
  const runAttempt = trimOrEmpty(process.env.GITHUB_RUN_ATTEMPT) || "unknown";
  const ledgerStem = `live-incident-ledger-${runDate}-run-${runId}-attempt-${runAttempt}`;

  const entry = buildLedgerEntry();
  const canonical = JSON.stringify(entry, null, 2);
  const entrySha256 = sha256(canonical);

  const jsonPath = path.join(outDir, `${ledgerStem}.json`);
  const mdPath = path.join(outDir, `${ledgerStem}.md`);

  const jsonOutput = `${JSON.stringify({ ...entry, entry_sha256: entrySha256 }, null, 2)}\n`;
  const mdOutput = toMarkdown(entry, entrySha256);

  writeExclusive(jsonPath, jsonOutput);
  writeExclusive(mdPath, mdOutput);

  appendGitHubOutput({
    ledger_json_path: path.relative(process.cwd(), jsonPath),
    ledger_md_path: path.relative(process.cwd(), mdPath),
    ledger_entry_sha256: entrySha256,
  });

  console.log(
    JSON.stringify(
      {
        status: "ok",
        json_path: path.relative(process.cwd(), jsonPath),
        md_path: path.relative(process.cwd(), mdPath),
        entry_sha256: entrySha256,
      },
      null,
      2
    )
  );
}

main();

#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);

main().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

async function main() {
  const account = getArg(args, '--account');
  const date = getArg(args, '--date');
  const days = getArg(args, '--days');
  const max = getArg(args, '--max');
  const calendarId = getArg(args, '--calendarId');
  const gmailJson = getArg(args, '--gmail-json');
  const calendarJson = getArg(args, '--calendar-json');
  const allowPartialSources = hasFlag(args, '--allow-partial-sources');
  const connectorRetries = getArg(args, '--connector-retries');
  const connectorBackoffMs = getArg(args, '--connector-backoff-ms');
  const connectorBackoffFactor = getArg(args, '--connector-backoff-factor');

  const skipKb = hasFlag(args, '--skip-kb');
  const kbFromFile = getArg(args, '--kb-from-file');
  const kbFiles = getArgValues(args, '--kb-file');
  const kbUrls = getArgValues(args, '--kb-url');
  const kbMaxChars = getArg(args, '--kb-max-chars');
  const kbOverlapChars = getArg(args, '--kb-overlap-chars');
  const kbEmbed = hasFlag(args, '--kb-embed');
  const kbEmbeddingModel = getArg(args, '--kb-embedding-model');

  const briefJson = hasFlag(args, '--brief-json');
  const briefOut = getArg(args, '--brief-out');
  const internalDomains = getArgValues(args, '--internal-domain');

  const steps = [];
  let pipelineStatus = 'ok';
  let fatalError = null;

  const initStep = runStep('init', path.join('scripts', 'db', 'init-hybrid-db.mjs'), []);
  steps.push(initStep);
  if (initStep.status === 'failed') {
    pipelineStatus = 'failed';
    fatalError = initStep.error_message;
  }

  const ingestArgs = [];
  pushArg(ingestArgs, '--account', account);
  pushArg(ingestArgs, '--days', days);
  pushArg(ingestArgs, '--max', max);
  pushArg(ingestArgs, '--calendarId', calendarId);
  pushArg(ingestArgs, '--gmail-json', gmailJson);
  pushArg(ingestArgs, '--calendar-json', calendarJson);
  if (allowPartialSources) ingestArgs.push('--allow-partial-sources');
  pushArg(ingestArgs, '--connector-retries', connectorRetries);
  pushArg(ingestArgs, '--connector-backoff-ms', connectorBackoffMs);
  pushArg(ingestArgs, '--connector-backoff-factor', connectorBackoffFactor);

  if (pipelineStatus !== 'failed') {
    const ingestStep = runStep(
      'crm_ingest',
      path.join('scripts', 'db', 'ingest-gmail-calendar-hybrid.mjs'),
      ingestArgs,
    );
    steps.push(ingestStep);
    if (ingestStep.status === 'partial_failure') {
      pipelineStatus = 'partial_failure';
    } else if (ingestStep.status === 'failed') {
      pipelineStatus = 'failed';
      fatalError = ingestStep.error_message;
    }
  }

  const kbRequested = Boolean(kbFromFile || kbFiles.length || kbUrls.length);
  if (!skipKb && kbRequested) {
    const kbArgs = [];
    pushArg(kbArgs, '--from-file', kbFromFile);
    for (const file of kbFiles) {
      pushArg(kbArgs, '--file', file);
    }
    for (const url of kbUrls) {
      pushArg(kbArgs, '--url', url);
    }
    pushArg(kbArgs, '--max-chars', kbMaxChars);
    pushArg(kbArgs, '--overlap-chars', kbOverlapChars);
    if (kbEmbed) kbArgs.push('--embed');
    pushArg(kbArgs, '--embedding-model', kbEmbeddingModel);

    if (pipelineStatus !== 'failed') {
      const kbStep = runStep('kb_ingest', path.join('scripts', 'db', 'ingest-kb-hybrid.mjs'), kbArgs);
      steps.push(kbStep);
      if (kbStep.status === 'failed') {
        pipelineStatus = 'failed';
        fatalError = kbStep.error_message;
      }
    }
  }

  const prepArgs = [];
  pushArg(prepArgs, '--account', account);
  pushArg(prepArgs, '--date', date);
  if (briefJson) prepArgs.push('--json');
  for (const domain of internalDomains) {
    pushArg(prepArgs, '--internal-domain', domain);
  }
  let prepOutput = null;
  if (pipelineStatus !== 'failed') {
    prepOutput = runStep('meeting_prep', path.join('scripts', 'db', 'meeting-prep-hybrid.mjs'), prepArgs);
    steps.push(prepOutput);
    if (prepOutput.status === 'failed') {
      pipelineStatus = 'failed';
      fatalError = prepOutput.error_message;
    }
  }

  if (briefOut && prepOutput?.status !== 'failed') {
    const outPath = path.resolve(briefOut);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, prepOutput.output, 'utf8');
  }

  const result = {
    ok: pipelineStatus !== 'failed',
    status: pipelineStatus,
    ran_at: new Date().toISOString(),
    brief_written_to: briefOut ? path.resolve(briefOut) : null,
    kb: {
      requested: kbRequested,
      skipped: skipKb,
    },
    crm_ingest: {
      allow_partial_sources: allowPartialSources,
      connector_retries: connectorRetries !== null ? Number(connectorRetries) : null,
      connector_backoff_ms: connectorBackoffMs !== null ? Number(connectorBackoffMs) : null,
      connector_backoff_factor: connectorBackoffFactor !== null ? Number(connectorBackoffFactor) : null,
    },
    steps: steps.map((step) => ({
      name: step.name,
      status: step.status,
      script: step.script,
      args: step.args,
      exit_code: step.exit_code,
      output_preview: previewOutput(step.output),
      error_preview: previewOutput(step.error_output),
      details: step.details || null,
      error_message: step.error_message || null,
    })),
    failure: fatalError
      ? {
          message: fatalError,
        }
      : null,
  };

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

function runStep(name, scriptPath, scriptArgs) {
  const absoluteScript = path.resolve(scriptPath);
  try {
    const output = execFileSync(process.execPath, [absoluteScript, ...scriptArgs], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const details = parseStepOutput(output);
    const status = details?.status === 'partial_failure' ? 'partial_failure' : 'ok';

    return {
      name,
      script: scriptPath,
      args: scriptArgs,
      status,
      exit_code: 0,
      output,
      error_output: '',
      details: sanitizeStepDetails(details),
      error_message: null,
    };
  } catch (err) {
    const output = err?.stdout ? String(err.stdout) : '';
    const errorOutput = err?.stderr ? String(err.stderr) : '';
    return {
      name,
      script: scriptPath,
      args: scriptArgs,
      status: 'failed',
      exit_code: Number.isInteger(err?.status) ? err.status : 1,
      output,
      error_output: errorOutput,
      details: sanitizeStepDetails(parseStepOutput(output)),
      error_message: errorOutput.trim() || err?.message || `Step ${name} failed`,
    };
  }
}

function previewOutput(output) {
  if (!output) return '';
  const trimmed = String(output).trim();
  if (!trimmed) return '';

  const maxChars = 280;
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 3)}...`;
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

function pushArg(target, name, value) {
  if (value === null || value === undefined || value === '') return;
  target.push(name, String(value));
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function parseStepOutput(output) {
  const trimmed = String(output || '').trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function sanitizeStepDetails(details) {
  if (!details || typeof details !== 'object') return null;

  if (details.status === 'partial_failure' || details.status === 'failed') {
    return {
      status: details.status,
      failures: Array.isArray(details.failures) ? details.failures : [],
    };
  }

  return null;
}

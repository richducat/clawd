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

  steps.push(runStep('init', path.join('scripts', 'db', 'init-hybrid-db.mjs'), []));

  const ingestArgs = [];
  pushArg(ingestArgs, '--account', account);
  pushArg(ingestArgs, '--days', days);
  pushArg(ingestArgs, '--max', max);
  pushArg(ingestArgs, '--calendarId', calendarId);
  pushArg(ingestArgs, '--gmail-json', gmailJson);
  pushArg(ingestArgs, '--calendar-json', calendarJson);
  steps.push(runStep('crm_ingest', path.join('scripts', 'db', 'ingest-gmail-calendar-hybrid.mjs'), ingestArgs));

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

    steps.push(runStep('kb_ingest', path.join('scripts', 'db', 'ingest-kb-hybrid.mjs'), kbArgs));
  }

  const prepArgs = [];
  pushArg(prepArgs, '--account', account);
  pushArg(prepArgs, '--date', date);
  if (briefJson) prepArgs.push('--json');
  for (const domain of internalDomains) {
    pushArg(prepArgs, '--internal-domain', domain);
  }
  const prepOutput = runStep('meeting_prep', path.join('scripts', 'db', 'meeting-prep-hybrid.mjs'), prepArgs);
  steps.push(prepOutput);

  if (briefOut) {
    const outPath = path.resolve(briefOut);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, prepOutput.output, 'utf8');
  }

  const result = {
    ok: true,
    ran_at: new Date().toISOString(),
    brief_written_to: briefOut ? path.resolve(briefOut) : null,
    kb: {
      requested: kbRequested,
      skipped: skipKb,
    },
    steps: steps.map((step) => ({
      name: step.name,
      script: step.script,
      args: step.args,
      output_preview: previewOutput(step.output),
    })),
  };

  console.log(JSON.stringify(result, null, 2));
}

function runStep(name, scriptPath, scriptArgs) {
  const absoluteScript = path.resolve(scriptPath);
  const output = execFileSync(process.execPath, [absoluteScript, ...scriptArgs], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return {
    name,
    script: scriptPath,
    args: scriptArgs,
    output,
  };
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

#!/usr/bin/env node
/**
 * Poll Solana A+ scanner and print any new candidates.
 *
 * v0: stdout only (we'll wire WhatsApp send + GO approval next).
 */

import { spawn } from 'node:child_process';

function getArg(name, def) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return def;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return def;
  return v;
}

const minutes = Number(getArg('--minutes', '60'));
const query = getArg('--query', 'raydium');
const intervalSec = Number(getArg('--intervalSec', '60'));

const seen = new Set();

function runOnce() {
  return new Promise((resolve) => {
    const child = spawn('node', ['scripts/solana/solana-a-plus-scanner.mjs', '--minutes', String(minutes), '--limit', '30', '--query', query], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

function extractMints(text) {
  const mints = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^Mint:\s+(\S+)/);
    if (m) mints.push(m[1]);
  }
  return mints;
}

(async function main() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { out, err } = await runOnce();
    if (err && err.trim()) process.stderr.write(err);

    const mints = extractMints(out);
    const isNoCandidates = out.includes('No A+ candidates found');

    if (!isNoCandidates && mints.length) {
      for (const mint of mints) {
        if (seen.has(mint)) continue;
        seen.add(mint);
        process.stdout.write(`\n=== NEW A+ CANDIDATE @ ${new Date().toLocaleString()} ===\n`);
        process.stdout.write(out.trimEnd() + '\n');
      }
    }

    await new Promise((r) => setTimeout(r, intervalSec * 1000));
  }
})().catch((e) => {
  console.error(e?.stack || String(e));
  process.exit(1);
});

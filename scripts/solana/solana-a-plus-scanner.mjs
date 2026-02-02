#!/usr/bin/env node
/**
 * Solana A+ Launch Scanner (Dexscreener -> Jupiter link)
 *
 * Goal: surface a small number of high-signal, early Solana pairs
 * (new-ish, liquid enough, non-zero volume) and output WhatsApp-friendly
 * pings with a Jupiter swap link.
 *
 * NOTE: This is v0. It is deliberately conservative and does NOT execute trades.
 * You still approve and sign in Phantom.
 *
 * Usage:
 *   node scripts/solana/solana-a-plus-scanner.mjs --minutes 5 --limit 30
 */

import { loadEnvLocal } from '../lib/load-env-local.mjs';

loadEnvLocal();

function getArg(name, def) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return def;
  const v = process.argv[idx + 1];
  if (!v || v.startsWith('--')) return def;
  return v;
}

const maxAgeMin = Number(getArg('--minutes', '5'));
const limit = Number(getArg('--limit', '30'));

// Conservative defaults — tweak later.
const MIN_LIQ_USD = Number(getArg('--minLiqUsd', '8000'));
const MIN_VOL5M_USD = Number(getArg('--minVol5mUsd', '2000'));
const MAX_FDV_LIQ_RATIO = Number(getArg('--maxFdvLiqRatio', '250')); // fdv/liquidity

function nowMs() {
  return Date.now();
}

function fmtUsd(n) {
  const x = Number(n) || 0;
  if (x >= 1_000_000) return `$${(x / 1_000_000).toFixed(2)}m`;
  if (x >= 1_000) return `$${(x / 1_000).toFixed(1)}k`;
  return `$${x.toFixed(0)}`;
}

function safeStr(v) {
  return (v ?? '').toString();
}

function parsePairAgeMinutes(pair) {
  const createdAt = Number(pair?.pairCreatedAt);
  if (!createdAt) return null;
  return (nowMs() - createdAt) / 60000;
}

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

function jupiterSwapUrl({ inputMint = SOL_MINT, outputMint }) {
  // Jupiter supports /swap/<input>-<output>
  // We intentionally do not pre-fill amount.
  return `https://jup.ag/swap/${encodeURIComponent(inputMint)}-${encodeURIComponent(outputMint)}`;
}

async function fetchDexscreenerLatestSolanaPairs({ limit }) {
  // Dexscreener does not expose a simple "latest pairs on chain" endpoint.
  // For v0, we use the public search endpoint with a query that returns
  // predominantly Solana/Raydium pairs, then filter by pairCreatedAt.
  //
  // This is imperfect (Dexscreener's ranking isn't purely chronological),
  // but it's enough to build + validate our A+ filtering pipeline.
  const q = encodeURIComponent(getArg('--query', 'raydium'));
  const url = `https://api.dexscreener.com/latest/dex/search?q=${q}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Dexscreener search failed (${res.status}): ${t.slice(0, 200)}`);
  }
  const json = await res.json();
  const pairs = Array.isArray(json?.pairs) ? json.pairs : [];
  return pairs.filter(p => p.chainId === 'solana').slice(0, limit);
}

function scorePair(pair) {
  // Light scoring that prefers liquidity + short age + 5m volume.
  const ageMin = parsePairAgeMinutes(pair);
  const liq = Number(pair?.liquidity?.usd) || 0;
  const vol5m = Number(pair?.volume?.m5) || 0;
  const priceChg5m = Number(pair?.priceChange?.m5) || 0;
  const fdv = Number(pair?.fdv) || 0;
  const fdvLiq = liq > 0 ? fdv / liq : Infinity;

  // Clamp/normalize
  const ageScore = ageMin == null ? 0 : Math.max(0, (maxAgeMin - ageMin) / maxAgeMin);
  const liqScore = Math.min(1, liq / (MIN_LIQ_USD * 3));
  const volScore = Math.min(1, vol5m / (MIN_VOL5M_USD * 3));
  const chgScore = Math.min(1, Math.max(0, (priceChg5m + 20) / 40)); // favor non-negative, but not too strict
  const fdvPenalty = fdvLiq > MAX_FDV_LIQ_RATIO ? 0.4 : 1;

  const score = (0.45 * liqScore + 0.35 * volScore + 0.15 * ageScore + 0.05 * chgScore) * fdvPenalty;
  return { score, ageMin, liq, vol5m, priceChg5m, fdv, fdvLiq };
}

function formatPing(pair, meta) {
  const base = pair?.baseToken;
  const name = safeStr(base?.name) || safeStr(base?.symbol) || 'Unknown';
  const symbol = safeStr(base?.symbol);
  const mint = safeStr(base?.address);

  const liq = fmtUsd(meta.liq);
  const vol = fmtUsd(meta.vol5m);
  const chg = Number.isFinite(meta.priceChg5m) ? `${meta.priceChg5m.toFixed(1)}%` : '—';
  const age = meta.ageMin == null ? '—' : `${meta.ageMin.toFixed(1)}m`;

  const dexUrl = safeStr(pair?.url);
  const jupUrl = mint ? jupiterSwapUrl({ inputMint: USDC_MINT, outputMint: mint }) : '';

  // WhatsApp-friendly, no markdown headers.
  return [
    `A+ Candidate (paper mode)`,
    `${name}${symbol ? ` (${symbol})` : ''}`,
    `Age: ${age} | Liq: ${liq} | Vol(5m): ${vol} | Chg(5m): ${chg}`,
    mint ? `Mint: ${mint}` : null,
    dexUrl ? `Dexscreener: ${dexUrl}` : null,
    jupUrl ? `Jupiter: ${jupUrl}` : null,
    `Proposed buy: $5 from USDC (you choose amount)`,
    `Reply GO and open the Jupiter link to sign in Phantom.`,
  ].filter(Boolean).join('\n');
}

(async function main() {
  const pairs = await fetchDexscreenerLatestSolanaPairs({ limit });

  const filtered = [];
  for (const p of pairs) {
    const { score, ageMin, liq, vol5m, fdvLiq } = scorePair(p);

    // Basic gates.
    if (ageMin == null || ageMin > maxAgeMin) continue;
    if (liq < MIN_LIQ_USD) continue;
    if (vol5m < MIN_VOL5M_USD) continue;
    if (!p?.baseToken?.address) continue;
    if (Number.isFinite(fdvLiq) && fdvLiq > MAX_FDV_LIQ_RATIO) continue;

    filtered.push({ p, score, meta: { score, ageMin, liq, vol5m, priceChg5m: Number(p?.priceChange?.m5) || 0, fdv: Number(p?.fdv) || 0, fdvLiq } });
  }

  filtered.sort((a, b) => b.score - a.score);

  if (!filtered.length) {
    process.stdout.write(`No A+ candidates found (age<=${maxAgeMin}m, liq>=${MIN_LIQ_USD}, vol5m>=${MIN_VOL5M_USD}).\n`);
    return;
  }

  // Print top 5 as pings.
  const top = filtered.slice(0, 5);
  for (const item of top) {
    process.stdout.write('\n' + formatPing(item.p, item.meta) + '\n');
  }
})().catch(err => {
  console.error(err?.stack || String(err));
  process.exit(1);
});

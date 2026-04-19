#!/usr/bin/env node
/**
 * Repo hygiene audit
 * - Detect embedded .git directories under repo subdirectories
 * - Detect suspicious nested app folders (branch-path drift heuristic)
 * - Check origin/HEAD points to main
 *
 * Usage: node scripts/maintenance/repo-hygiene-audit.mjs /path/to/repo
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const pexecFile = promisify(execFile);

const ROOT = path.resolve(process.argv[2] || '.');

function rel(p) {
  return path.relative(ROOT, p) || '.';
}

async function pathExists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function isDir(p) {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function walkDirs(start, { maxDepth = 8, skipNames = new Set() } = {}) {
  const out = [];
  async function rec(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (skipNames.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      out.push(full);
      await rec(full, depth + 1);
    }
  }
  await rec(start, 0);
  return out;
}

async function isGitIgnored(p) {
  // Returns true if path is ignored by git at ROOT.
  // Note: git check-ignore does not reliably report "ignored" for a bare directory path,
  // even when all its contents are ignored. So we also probe a child entry when needed.
  const tryCheck = async (candidate) => {
    try {
      await pexecFile('git', ['check-ignore', '-q', candidate], { cwd: ROOT });
      return true;
    } catch {
      return false;
    }
  };

  // Direct check (works for files)
  if (await tryCheck(p)) return true;

  // If it's a directory, probe a child file
  const abs = path.join(ROOT, p);
  if (await isDir(abs)) {
    try {
      const entries = await fs.readdir(abs);
      for (const name of entries) {
        const childRel = path.posix.join(p.replaceAll('\\', '/'), name);
        if (await tryCheck(childRel)) return true;
      }
    } catch {
      // ignore
    }
  }

  return false;
}

async function auditEmbeddedGit() {
  const findings = [];
  const rootGit = path.join(ROOT, '.git');
  const skip = new Set(['node_modules', '.next', 'dist', 'build', 'out', '.turbo', '.cache']);
  const dirs = await walkDirs(ROOT, { maxDepth: 10, skipNames: skip });
  for (const d of dirs) {
    const gitDir = path.join(d, '.git');
    if (gitDir === rootGit) continue;
    if (await isDir(gitDir)) {
      // If the parent directory is ignored, this is usually a safe local clone.
      const ignored = await isGitIgnored(rel(d));
      if (ignored) continue;
      findings.push({
        type: 'embedded_git',
        severity: 'HIGH',
        path: rel(gitDir),
        note: 'Nested .git directory found inside a non-ignored path; likely an embedded repo/submodule clone in the tracked workspace.'
      });
    }
  }
  return findings;
}

async function auditOriginHead() {
  const findings = [];
  // Only if this is a git repo
  if (!(await pathExists(path.join(ROOT, '.git')))) return findings;
  try {
    const { stdout } = await pexecFile('git', ['symbolic-ref', '-q', 'refs/remotes/origin/HEAD'], { cwd: ROOT });
    const ref = stdout.trim();
    if (!ref) return findings;
    const branch = ref.replace('refs/remotes/origin/', '');
    if (branch !== 'main') {
      findings.push({
        type: 'origin_head_not_main',
        severity: 'HIGH',
        value: branch,
        note: 'origin/HEAD does not point to main; can indicate default branch mismatch or misconfigured remote.'
      });
    }
  } catch (e) {
    // If origin/HEAD isn't set, this is usually LOW
    findings.push({
      type: 'origin_head_missing',
      severity: 'LOW',
      note: 'origin/HEAD symbolic-ref not set or not accessible.'
    });
  }
  return findings;
}

async function auditBranchPathDrift() {
  const findings = [];
  const repoBase = path.basename(ROOT);
  const suspiciousNames = new Set([
    repoBase,
    `${repoBase}-app`,
    `${repoBase}_app`,
    'app',
    'apps',
    'client',
    'frontend',
    'web',
    'labstudio-app',
    'labstudio',
  ]);

  const skip = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', '.turbo', '.cache']);
  const dirs = await walkDirs(ROOT, { maxDepth: 4, skipNames: skip });

  for (const d of dirs) {
    const name = path.basename(d);
    if (!suspiciousNames.has(name)) continue;

    // If the whole folder is ignored, treat it as out-of-scope scratch.
    if (await isGitIgnored(rel(d))) continue;

    const srcDir = path.join(d, 'src');
    if (!(await isDir(srcDir))) continue;

    // confirm src has at least one entry
    let srcEntries = [];
    try {
      srcEntries = await fs.readdir(srcDir);
    } catch {}
    if (!srcEntries.length) continue;

    // if nested app is not root itself
    if (path.resolve(d) !== ROOT) {
      findings.push({
        type: 'branch_path_drift',
        severity: 'HIGH',
        path: rel(d),
        note: 'Nested folder matches common app/repo name and contains src/ and is NOT git-ignored. Might be working code off the main build path.'
      });
    }
  }

  return findings;
}

async function main() {
  const repoName = path.basename(ROOT);
  const findings = [
    ...(await auditEmbeddedGit()),
    ...(await auditOriginHead()),
    ...(await auditBranchPathDrift()),
  ];

  const result = {
    repo: repoName,
    root: ROOT,
    ok: findings.length === 0,
    findings,
    ts: new Date().toISOString(),
  };

  // Human-friendly output
  if (result.ok) {
    console.log('OK');
    return;
  }

  for (const f of findings) {
    const loc = f.path ? ` @ ${f.path}` : '';
    const val = f.value ? ` (${f.value})` : '';
    console.log(`[${f.severity}] ${f.type}${val}${loc} — ${f.note}`);
  }
}

main().catch((err) => {
  console.error('ERROR', err?.stack || err);
  process.exitCode = 2;
});

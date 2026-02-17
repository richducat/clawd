import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.argv[2] || process.env.VETERAN_FILES_ROOT;
if (!ROOT) {
  console.error('Usage: node scripts/tyfys/veteran-files-scan-index.mjs <VETERAN_FILES_ROOT>');
  process.exit(2);
}

const MAX_FOLDERS = Number(process.env.MAX_FOLDERS || 300);
const MAX_FILES_PER_FOLDER = Number(process.env.MAX_FILES_PER_FOLDER || 5000);

async function listDir(p) {
  return await fs.readdir(p, { withFileTypes: true });
}

function extOf(name) {
  const b = String(name || '');
  const i = b.lastIndexOf('.');
  return i >= 0 ? b.slice(i + 1).toLowerCase() : '';
}

async function folderStat(p) {
  const st = await fs.stat(p);
  return { mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs };
}

async function scanFolder(absFolder) {
  const out = { path: absFolder, files: [], skipped: false, error: null };
  try {
    const stack = [absFolder];
    let fileCount = 0;
    while (stack.length) {
      const cur = stack.pop();
      const entries = await listDir(cur);
      for (const e of entries) {
        const abs = path.join(cur, e.name);
        if (e.isDirectory()) {
          stack.push(abs);
          continue;
        }
        if (!e.isFile()) continue;
        fileCount++;
        if (fileCount > MAX_FILES_PER_FOLDER) {
          out.skipped = true;
          return out;
        }
        const st = await fs.stat(abs);
        out.files.push({
          rel: path.relative(absFolder, abs),
          name: e.name,
          ext: extOf(e.name),
          size: st.size,
          mtimeMs: st.mtimeMs,
        });
      }
    }
    return out;
  } catch (err) {
    out.error = String(err?.message || err);
    return out;
  }
}

const absRoot = path.resolve(ROOT);
const rootEntries = await listDir(absRoot);
const folders = rootEntries.filter((e) => e.isDirectory()).map((e) => e.name);

const folderInfos = [];
for (const name of folders.slice(0, MAX_FOLDERS)) {
  const abs = path.join(absRoot, name);
  const st = await folderStat(abs);
  folderInfos.push({ name, abs, ...st });
}

folderInfos.sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));

const index = {
  root: absRoot,
  scannedAt: new Date().toISOString(),
  folderCount: folders.length,
  folders: [],
};

// Scan newest first (most likely active)
for (const f of folderInfos) {
  const scanned = await scanFolder(f.abs);
  index.folders.push({
    name: f.name,
    mtimeMs: f.mtimeMs,
    ctimeMs: f.ctimeMs,
    fileCount: scanned.files.length,
    skipped: scanned.skipped,
    error: scanned.error,
    files: scanned.files,
  });
  // small progress
  if (index.folders.length % 10 === 0) {
    console.error(`scannedFolders=${index.folders.length}/${folderInfos.length}`);
  }
}

await fs.mkdir(path.resolve('memory/tyfys'), { recursive: true });
const outPath = path.resolve('memory/tyfys/veteran-files-index.json');
await fs.writeFile(outPath, JSON.stringify(index, null, 2) + '\n', 'utf8');
console.log(`Wrote ${outPath} folders=${index.folders.length} totalFolders=${index.folderCount}`);

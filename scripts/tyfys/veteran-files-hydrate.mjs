import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.argv[2];
if (!ROOT) {
  console.error('Usage: node scripts/tyfys/veteran-files-hydrate.mjs <VETERAN_FILES_ROOT> [--limitFolders N]');
  process.exit(2);
}
const limitFolders = (() => {
  const i = process.argv.indexOf('--limitFolders');
  return i === -1 ? 30 : Number(process.argv[i + 1] || 30);
})();

async function sleep(ms){ await new Promise(r=>setTimeout(r,ms)); }

async function readTry(p, attempts=10){
  let last;
  for(let i=0;i<attempts;i++){
    try{
      const f=await fs.open(p,'r');
      const buf=Buffer.alloc(1024);
      await f.read(buf,0,1024,0);
      await f.close();
      return true;
    }catch(e){
      last=e;
      const errno=e?.errno;
      if(errno===11 || String(e?.message||'').includes('Resource deadlock avoided')){
        await sleep(800*(i+1));
        continue;
      }
      return false;
    }
  }
  return false;
}

async function listDir(p){
  return await fs.readdir(p,{withFileTypes:true});
}

const absRoot=path.resolve(ROOT);
const entries=(await listDir(absRoot)).filter(e=>e.isDirectory()).map(e=>e.name);
// Sort by mtime desc
const infos=[];
for(const name of entries){
  const st=await fs.stat(path.join(absRoot,name));
  infos.push({name,mtimeMs:st.mtimeMs});
}
infos.sort((a,b)=>b.mtimeMs-a.mtimeMs);
const target=infos.slice(0,limitFolders).map(x=>x.name);

let files=0, ok=0, fail=0;
for(const folder of target){
  const folderAbs=path.join(absRoot,folder);
  const stack=[folderAbs];
  while(stack.length){
    const cur=stack.pop();
    const kids=await listDir(cur);
    for(const k of kids){
      const p=path.join(cur,k.name);
      if(k.isDirectory()) { stack.push(p); continue; }
      if(!k.isFile()) continue;
      files++;
      const good=await readTry(p,10);
      if(good) ok++; else fail++;
    }
  }
  console.error(`hydrated folder: ${folder}`);
}
console.log(JSON.stringify({folders:target.length, files, ok, fail},null,2));

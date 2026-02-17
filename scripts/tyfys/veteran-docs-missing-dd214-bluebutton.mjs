/**
 * For recent Veteran Files folders, find matching Zoho Deal and determine whether we have DD214 + Blue Button records.
 * If missing, create Gmail DRAFT requesting ONLY DD214 and/or Blue Button.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { loadEnvLocal } from '../lib/load-env-local.mjs';
import { getZohoAccessToken, zohoCrmCoql, zohoCrmGet } from '../lib/zoho.mjs';

loadEnvLocal();

const args = new Set(process.argv.slice(2));
function argVal(flag, fallback=null){
  const i=process.argv.indexOf(flag);
  return i===-1? fallback : (process.argv[i+1] ?? fallback);
}

const indexPath = argVal('--index','memory/tyfys/veteran-files-index.json');
const limit = Number(argVal('--limit','30'));
const makeDrafts = args.has('--draft');
const gmailAccount = argVal('--gmail', 'richard@thankyouforyourservice.co');

const apiDomain = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.com';

function esc(s){ return String(s||'').replace(/'/g,"\\'"); }
function norm(raw){
  let s=String(raw||'').trim().replace(/\s+/g,' ');
  const m=s.match(/^([^,]+),\s*(.+)$/);
  if(m) s=`${m[2]} ${m[1]}`.trim().replace(/\s+/g,' ');
  return s;
}

function hasDD214(names){
  const t=names.join(' ').toLowerCase();
  return /dd\s*214|dd214|214\s*form/.test(t);
}
function hasBlueButton(names){
  const t=names.join(' ').toLowerCase();
  return /blue\s*button|my\s*healthevet|mhv|va\s*ccd|continuity\s*of\s*care\s*document|ccd_/.test(t);
}

async function findDeal(accessToken, folderName){
  const raw=folderName.trim();
  const a=norm(raw);
  const b=raw.replace(/\s+/g,' ').trim();
  const q=`select id, Deal_Name, Email_Address, Phone_Number, Contact_Name from Deals where (Deal_Name like '%${esc(a)}%' or Deal_Name like '%${esc(b)}%') order by Modified_Time desc limit 5`;
  const r=await zohoCrmCoql({accessToken,apiDomain,selectQuery:q}).catch(()=>({}));
  const data=r?.data||[];
  if(data.length===1) return data[0];
  return null;
}

async function listDealAttachmentNames(accessToken, dealId){
  const r=await zohoCrmGet({accessToken,apiDomain,pathAndQuery:`/crm/v2/Deals/${dealId}/Attachments?per_page=200&page=1`}).catch(()=>null);
  return (r?.data||[]).map(a=>String(a.File_Name||'').trim()).filter(Boolean);
}

async function getContactEmail(accessToken, contactId){
  if(!contactId) return null;
  const r=await zohoCrmGet({accessToken,apiDomain,pathAndQuery:`/crm/v2/Contacts/${contactId}`}).catch(()=>null);
  return r?.data?.[0]?.Email || null;
}

async function createDraft({to, subject, body}){
  const tmp=path.resolve('tmp/_dd214_bluebutton_request.txt');
  await fs.mkdir(path.dirname(tmp),{recursive:true});
  await fs.writeFile(tmp, body, 'utf8');
  const { execSync } = await import('node:child_process');
  const cmd=[
    'gog','gmail','drafts','create',
    '--to', JSON.stringify(to),
    '--subject', JSON.stringify(subject),
    '--body-file', tmp,
    '--account', gmailAccount,
    '--json'
  ].join(' ');
  const out=execSync(cmd,{encoding:'utf8'});
  return JSON.parse(out);
}

const index=JSON.parse(await fs.readFile(indexPath,'utf8'));
const accessToken=await getZohoAccessToken();

const folders=(index.folders||[])
  .filter(f=>(f.files?.length||0)>0)
  .sort((a,b)=>(b.mtimeMs||0)-(a.mtimeMs||0))
  .slice(0,limit);

const report={
  scannedAt:new Date().toISOString(),
  limit,
  makeDrafts,
  results:[],
};

for(const f of folders){
  const folderName=f.name;
  const deal=await findDeal(accessToken, folderName);
  if(!deal){
    report.results.push({folderName, status:'no_deal_match'});
    continue;
  }
  const dealId=String(deal.id);
  const dealName=deal.Deal_Name;
  const dealEmail=deal.Email_Address || null;
  const dealPhone=deal.Phone_Number || null;
  const contactId=deal.Contact_Name?.id;
  const contactEmail=dealEmail || await getContactEmail(accessToken, contactId);

  const driveNames=(f.files||[]).map(x=>x.name);
  const dealAttNames=await listDealAttachmentNames(accessToken, dealId);
  const allNames=[...driveNames, ...dealAttNames];

  const okDD214=hasDD214(allNames);
  const okBlue=hasBlueButton(allNames);

  const missing=[];
  if(!okDD214) missing.push('DD214');
  if(!okBlue) missing.push('Blue Button health records (MyHealtheVet)');

  let draft=null;
  if(makeDrafts && missing.length && contactEmail){
    const subject='Quick request: DD214 + Blue Button records';
    const body=
`Hi ${dealName},\n\nQuick request so we can keep your file moving — can you send us the following (if you have them):\n\n${missing.map(m=>`- ${m}`).join('\n')}\n\nYou can reply to this email with attachments or screenshots.\n\nThanks,\nRichard`;
    draft=await createDraft({to: contactEmail, subject, body});
  }

  report.results.push({
    folderName,
    dealId,
    dealName,
    email: contactEmail,
    phone: dealPhone,
    hasDD214: okDD214,
    hasBlueButton: okBlue,
    missing,
    draftId: draft?.draftId || null,
  });
}

await fs.mkdir(path.resolve('memory/tyfys'),{recursive:true});
const outPath=path.resolve('memory/tyfys/missing-dd214-bluebutton-report.json');
await fs.writeFile(outPath, JSON.stringify(report,null,2)+'\n','utf8');
console.log(`Done. folders=${folders.length} wrote=${outPath}`);
const need=report.results.filter(r=>r.missing?.length);
console.log(`missingDocs=${need.length} draftsCreated=${need.filter(r=>r.draftId).length}`);

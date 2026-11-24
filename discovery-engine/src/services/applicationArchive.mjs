import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../paths.mjs';
import { safeJoin, slugify } from '../security.mjs';
import { sha256File, sha256Text } from '../utils/hash.mjs';

const SUBDIRS=['JD','Analysis','CV','Cover-Letter','Application-Answers','Contacts','Outreach','Interview','Evidence','Evidence/screenshots'];

export function applicationFolderName(job){return `JOB-${String(job.id).padStart(6,'0')}__${slugify(job.company)}__${slugify(job.title)}`;}

export function ensureApplicationArchive({job, jdRaw='', jdClean='', sourceUrl=''}){
  fs.mkdirSync(paths.applications,{recursive:true});
  const folder=fs.mkdtempSync(safeJoin(paths.applications,applicationFolderName(job)+'__'));
  for(const d of SUBDIRS)fs.mkdirSync(safeJoin(folder,d),{recursive:true});
  const writeIfMissing=(rel,content='')=>{const p=safeJoin(folder,rel);if(!fs.existsSync(p))fs.writeFileSync(p,content,'utf8');};
  writeIfMissing('00_APPLICATION.md',`# ${job.company} — ${job.title}\n\n- Job: JOB-${String(job.id).padStart(6,'0')}\n- Status: ${job.status||'SAVED'}\n- Application URL: ${job.application_url||job.applicationUrl||''}\n- CV Used: Pending\n`);
  writeIfMissing('application.json',JSON.stringify({jobId:job.id,company:job.company,title:job.title,createdAt:new Date().toISOString()},null,2));
  writeIfMissing('JD/jd-raw.txt',jdRaw); writeIfMissing('JD/jd-clean.md',jdClean); writeIfMissing('JD/source-url.txt',sourceUrl||job.source_url||job.sourceUrl||'');
  writeIfMissing('Analysis/recruiter-pre.md','# Recruiter Analysis — Pre-tailor\n'); writeIfMissing('Analysis/ats-pre.md','# ATS Exact — Pre-tailor\n');
  writeIfMissing('Analysis/tailoring-plan.md','# Tailoring Plan\n'); writeIfMissing('Analysis/recruiter-post.md','# Recruiter Analysis — Post-tailor\n');
  writeIfMissing('Analysis/ats-post.md','# ATS Exact — Post-tailor\n'); writeIfMissing('Analysis/integrity-check.md','# Integrity Check\n');
  writeIfMissing('Application-Answers/answers.md','# Application Answers\n'); writeIfMissing('Contacts/contacts.md','# Contacts\n');
  writeIfMissing('Outreach/messages.md','# Outreach Drafts\n'); writeIfMissing('Interview/interview-prep.md','# Interview Prep\n');
  writeIfMissing('Interview/interview-notes.md','# Interview Notes\n'); writeIfMissing('Interview/questions-to-ask.md','# Questions To Ask\n');
  writeIfMissing('Evidence/confirmation.md','# Application Confirmation\n');
  return folder;
}

export function snapshotSubmittedCv({folder, sourcePath, expectedHash=null}){
  if(!fs.existsSync(sourcePath))throw new Error('Submitted CV file does not exist');
  const ext=path.extname(sourcePath).toLowerCase(); if(!['.pdf','.docx','.txt','.md'].includes(ext))throw new Error('Unsupported submitted CV type');
  const hash=sha256File(sourcePath); if(expectedHash&&expectedHash!==hash)throw new Error('CV hash changed before snapshot');
  const dest=safeJoin(folder,'CV',`submitted-cv${ext}`); if(fs.existsSync(dest))throw new Error('Submitted CV snapshot already exists and is immutable');
  fs.copyFileSync(sourcePath,dest); fs.writeFileSync(safeJoin(folder,'CV','submitted-cv.sha256'),`${hash}  ${path.basename(dest)}\n`,'utf8');
  return {path:dest,sha256:hash,extension:ext};
}

export function snapshotTextImmutable(folder, rel, content){
  const p=safeJoin(folder,rel); if(fs.existsSync(p))throw new Error(`${rel} already exists and is immutable`); fs.writeFileSync(p,content,'utf8'); return {path:p,sha256:sha256Text(content)};
}

import { createHash } from 'node:crypto';
import { canonicalizeUrl } from '../utils/url.mjs';

export const ACTIVE_JOB_DAYS=14;
export const HEAVY_PAYLOAD_DAYS=90;
const PROTECTED_JOB_STATUSES=new Set(['QUEUED_FOR_WORK','READY_TO_APPLY','APPLIED','FOLLOW_UP_DUE','INTERVIEW','ASSESSMENT','FINAL_STAGE','OFFER']);
const PROTECTED_APPLICATION_STATUSES=new Set(['SAVED','READY_TO_APPLY','APPLIED','FOLLOW_UP_DUE','INTERVIEW','ASSESSMENT','FINAL_STAGE','OFFER']);

export function jobFingerprint(job={}){
  const sourceId=job.source_id??job.sourceId??'',externalId=job.external_id??job.externalId??'';
  const url=canonicalizeUrl(job.canonical_job_url||job.canonicalJobUrl||job.application_url||job.applicationUrl||job.source_url||job.sourceUrl||'');
  return createHash('sha256').update([sourceId,externalId,url,job.company||'',job.title||''].join('|').toLowerCase()).digest('hex');
}
export function jobUrlHash(job={}){const value=canonicalizeUrl(job.canonical_job_url||job.canonicalJobUrl||job.application_url||job.applicationUrl||job.source_url||job.sourceUrl||'');return value?createHash('sha256').update(value).digest('hex'):null;}
export function retentionDate(job={}){return job.employer_published_at||job.source_published_at||job.first_seen_at||null;}
export function isProtectedJob(db,jobId){
  return Boolean(protectedJobReason(db,jobId));
}
export function protectedJobReason(db,jobId){
  const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(Number(jobId));if(!job)return false;
  if(job.saved_at)return 'JOB_IS_SAVED';
  if(PROTECTED_JOB_STATUSES.has(String(job.status||'').toUpperCase()))return `JOB_STATUS_${String(job.status).toUpperCase()}`;
  const app=db.prepare('SELECT status FROM applications WHERE job_id=?').get(job.id);if(app&&PROTECTED_APPLICATION_STATUSES.has(String(app.status||'').toUpperCase()))return `APPLICATION_STATUS_${String(app.status).toUpperCase()}`;
  if(app)return `APPLICATION_STATUS_${String(app.status||'UNKNOWN').toUpperCase()}`;
  if(db.prepare("SELECT 1 FROM notes WHERE entity_type='job' AND entity_id=? AND trim(body)!='' LIMIT 1").get(job.id))return 'JOB_HAS_NOTES';
  if(db.prepare('SELECT 1 FROM application_work_queue WHERE job_id=? LIMIT 1').get(job.id))return 'JOB_HAS_WORK_QUEUE_HISTORY';
  if(db.prepare('SELECT 1 FROM cv_versions WHERE job_id=? LIMIT 1').get(job.id))return 'JOB_HAS_TAILORED_CV';
  return null;
}
export function archiveStaleJobs(db,{now=new Date(),days=ACTIVE_JOB_DAYS}={}){
  const cutoff=new Date(now.getTime()-days*86400000).toISOString();let archived=0,protectedCount=0;
  const rows=db.prepare("SELECT * FROM jobs WHERE status!='ARCHIVED' AND datetime(COALESCE(employer_published_at,source_published_at,first_seen_at)) < datetime(?)").all(cutoff);
  for(const job of rows){if(isProtectedJob(db,job.id)){protectedCount++;continue;}db.prepare("UPDATE jobs SET status='ARCHIVED',archived_at=COALESCE(archived_at,?),archive_reason='AGE_RETENTION' WHERE id=?").run(now.toISOString(),job.id);archived++;}
  return {examined:rows.length,archived,protected:protectedCount,cutoff};
}
export function purgeOldJobPayloads(db,{now=new Date(),days=HEAVY_PAYLOAD_DAYS}={}){
  const cutoff=new Date(now.getTime()-days*86400000).toISOString();let purged=0,protectedCount=0;
  const rows=db.prepare("SELECT * FROM jobs WHERE status='ARCHIVED' AND payload_purged_at IS NULL AND datetime(COALESCE(archived_at,last_seen_at,first_seen_at)) < datetime(?)").all(cutoff);
  for(const job of rows){if(isProtectedJob(db,job.id)){protectedCount++;continue;}const fp=jobFingerprint(job);db.prepare(`INSERT OR IGNORE INTO job_tombstones(job_id,source_id,source_job_id,canonical_url,canonical_url_hash,fingerprint,company,title,first_seen_at,last_seen_at,archived_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(job.id,job.source_id,job.external_id,job.canonical_job_url||job.application_url||job.source_url||null,jobUrlHash(job),fp,job.company,job.title,job.first_seen_at,job.last_seen_at,job.archived_at);db.prepare('DELETE FROM requirements WHERE job_id=?').run(job.id);db.prepare('DELETE FROM job_analysis WHERE job_id=?').run(job.id);db.prepare('DELETE FROM job_jd_versions WHERE job_id=?').run(job.id);db.prepare('UPDATE jobs SET payload_purged_at=? WHERE id=?').run(now.toISOString(),job.id);purged++;}
  return {examined:rows.length,purged,protected:protectedCount,cutoff};
}
function configuredDays(db,key,fallback){const n=Number(db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value);return Number.isFinite(n)&&n>0?n:fallback;}
export function applyRetention(db,options={}){const archiveOptions={...options,days:options.days||configuredDays(db,'active_job_retention_days',ACTIVE_JOB_DAYS)},cleanupOptions={...options,days:options.cleanupDays||configuredDays(db,'heavy_payload_retention_days',HEAVY_PAYLOAD_DAYS)};return {archive:archiveStaleJobs(db,archiveOptions),cleanup:purgeOldJobPayloads(db,cleanupOptions)};}
export function tombstoneMatches(db,raw={}){
  const sourceId=raw.sourceId||null,sourceJobId=String(raw.externalId||'').trim();if(sourceId&&sourceJobId&&db.prepare('SELECT 1 FROM job_tombstones WHERE source_id=? AND source_job_id=? LIMIT 1').get(sourceId,sourceJobId))return true;
  const h=jobUrlHash(raw);if(h&&db.prepare('SELECT 1 FROM job_tombstones WHERE canonical_url_hash=? LIMIT 1').get(h))return true;
  return Boolean(db.prepare('SELECT 1 FROM job_tombstones WHERE fingerprint=? LIMIT 1').get(jobFingerprint(raw)));
}

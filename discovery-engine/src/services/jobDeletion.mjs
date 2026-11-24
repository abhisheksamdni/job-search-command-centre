import { canonicalizeUrl } from '../utils/url.mjs';
import { protectedJobReason, jobFingerprint, jobUrlHash } from './jobRetention.mjs';

export function deleteJob(db,jobId,{now=new Date()}={}){
  jobId=Number(jobId);const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
  if(!job)throw new Error('JOB_NOT_FOUND');
  const protectedReason=protectedJobReason(db,jobId);
  if(protectedReason)throw new Error(`DELETE_BLOCKED_PROTECTED_HISTORY: ${protectedReason}`);
  const deletedAt=now.toISOString(),canonical=canonicalizeUrl(job.canonical_job_url||job.application_url||job.source_url||'');
  const fingerprint=jobFingerprint(job),canonicalUrlHash=jobUrlHash({...job,canonical_job_url:canonical});
  db.exec('BEGIN');
  try{
    db.prepare(`INSERT INTO job_tombstones(job_id,source_id,source_job_id,canonical_url,canonical_url_hash,fingerprint,company,title,first_seen_at,last_seen_at,archived_at,deleted_at,suppression_reason)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(fingerprint) DO UPDATE SET source_id=excluded.source_id,source_job_id=excluded.source_job_id,canonical_url_hash=excluded.canonical_url_hash,deleted_at=excluded.deleted_at,suppression_reason=excluded.suppression_reason`).run(job.id,job.source_id,job.external_id,null,canonicalUrlHash,fingerprint,null,null,null,null,null,deletedAt,'USER_DELETED');
    db.prepare("DELETE FROM notes WHERE entity_type='job' AND entity_id=?").run(job.id);
    db.prepare("DELETE FROM audit_events WHERE entity_type='job' AND entity_id=?").run(job.id);
    db.prepare('DELETE FROM jobs WHERE id=?').run(job.id);
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  return {status:'DELETED',jobId,suppressionReason:'USER_DELETED',deletedAt};
}

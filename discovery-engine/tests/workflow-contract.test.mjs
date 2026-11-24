import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'jcc-workflow-contract-'));
process.env.JCC_ROOT=root;
const repo=fileURLToPath(new URL('..',import.meta.url));
const { migrate }=await import('../src/migrate.mjs');
const { evaluateReadyToApply }=await import('../src/services/readyGate.mjs');
const { queuePreflight }=await import('../src/services/workQueue.mjs');
const { transitionApplication }=await import('../src/services/applicationTracker.mjs');

function sha(v){return crypto.createHash('sha256').update(v).digest('hex');}
function confirmed(value){return{confirmed:true,current:true,value};}

test('migration resets legacy READY_TO_APPLY records without an approved queue decision',()=>{
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
  db.exec('CREATE TABLE migrations(version TEXT PRIMARY KEY,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  for(const file of fs.readdirSync(path.join(repo,'migrations')).filter(x=>/^00[1-6].*\.sql$/.test(x)).sort()){
    db.exec(fs.readFileSync(path.join(repo,'migrations',file),'utf8'));db.prepare('INSERT INTO migrations(version) VALUES (?)').run(file);
  }
  const jobId=Number(db.prepare("INSERT INTO jobs(company,title,status) VALUES ('Legacy Co','Legacy Role','READY_TO_APPLY')").run().lastInsertRowid);
  const appId=Number(db.prepare("INSERT INTO applications(job_id,status,application_folder) VALUES (?,'READY_TO_APPLY','legacy-folder')").run(jobId).lastInsertRowid);
  migrate(db);
  assert.equal(db.prepare('SELECT status FROM jobs WHERE id=?').get(jobId).status,'SAVED');
  assert.equal(db.prepare('SELECT status FROM applications WHERE id=?').get(appId).status,'SAVED');
  assert.equal(db.prepare("SELECT count(*) n FROM application_status_history WHERE application_id=? AND actor='migration'").get(appId).n,1);
  assert.equal(db.prepare("SELECT count(*) n FROM audit_events WHERE entity_id=? AND event_type='LEGACY_READY_RESET'").get(appId).n,1);
  db.close();
});

test('manual override changes match decisions into warnings but never bypasses package integrity',()=>{
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');migrate(db);
  const auth={workAuthorisation:confirmed('Authorised'),sponsorship:confirmed('Not required')},prefs={applicationFacts:{salary:confirmed('Open'),noticePeriod:confirmed('Four weeks'),relocation:confirmed('No'),startDate:confirmed('After notice')}};
  db.prepare('INSERT INTO candidate_profile(id,work_authorization_json,preferences_json) VALUES (1,?,?)').run(JSON.stringify(auth),JSON.stringify(prefs));
  const jobId=Number(db.prepare("INSERT INTO jobs(company,title,location_raw,location_confidence,role_classification,status) VALUES ('Override Co','Adjacent Role','London',100,'ROLE_REJECTED','SAVED')").run().lastInsertRowid),jd='A complete role description requiring market analysis, execution controls and portfolio research.';
  db.prepare("INSERT INTO job_jd_versions(job_id,jd_raw,jd_clean,jd_clean_hash,jd_quality) VALUES (?,?,?,?, 'FULL')").run(jobId,jd,jd,sha(jd));
  const masterText='Market analysis and execution controls',masterDoc=Number(db.prepare('INSERT INTO cv_documents(original_filename,stored_path,sha256,extracted_text) VALUES (?,?,?,?)').run('master.txt','master.txt',sha(masterText),masterText).lastInsertRowid),masterId=Number(db.prepare("INSERT INTO cv_versions(document_id,version_label,is_master,is_active) VALUES (?,'MASTER',1,1)").run(masterDoc).lastInsertRowid),childText=masterText+'\nPortfolio research',childDoc=Number(db.prepare('INSERT INTO cv_documents(original_filename,stored_path,sha256,extracted_text) VALUES (?,?,?,?)').run('child.txt','child.txt',sha(childText),childText).lastInsertRowid),childId=Number(db.prepare("INSERT INTO cv_versions(document_id,parent_version_id,version_label,job_id) VALUES (?,?,'CHILD',?)").run(childDoc,masterId,jobId).lastInsertRowid);
  db.prepare("INSERT INTO cv_version_files(cv_version_id,format,path,sha256,is_primary) VALUES (?,'SOURCE','child.txt',?,1)").run(childId,sha(childText));
  db.prepare("INSERT INTO job_analysis(job_id,cv_version_id,analysis_type,score,verdict,payload_json) VALUES (?,?,'RECRUITER',40,'DO NOT APPLY',?)").run(jobId,childId,JSON.stringify({clearKnockout:true,knockoutGaps:[{severity:'KNOCKOUT'}],seniorityCompatibility:{materialMismatch:true}}));
  db.prepare("INSERT INTO job_analysis(job_id,cv_version_id,analysis_type,score,payload_json) VALUES (?,?,'ATS_EXACT',50,'{}')").run(jobId,childId);
  db.prepare("INSERT INTO job_analysis(job_id,cv_version_id,analysis_type,score,verdict,payload_json) VALUES (?,?,'POST_TAILOR',40,'PASS',?)").run(jobId,childId,JSON.stringify({integrity:'PASS',tailoringQuality:{version:'2.1.0-semantic',passed:true,semanticChangePassed:true,evidenceBearingChanges:1},materialChange:{meaningful:true}}));
  const folder=path.join(root,'package');fs.mkdirSync(path.join(folder,'Cover-Letter'),{recursive:true});fs.mkdirSync(path.join(folder,'Application-Answers'),{recursive:true});fs.writeFileSync(path.join(folder,'Cover-Letter','cover-letter.md'),'Dear Hiring Team\n\n'+('Supported application evidence and specific role context. '.repeat(35)));fs.writeFileSync(path.join(folder,'Application-Answers','answers.md'),'# Application Answers\n\n## Why this role?\nSupported.\n\n## Why this company?\nSupported.\n\n## Relevant experience\nSupported.\n\n## Technical experience\nSupported.\n\n## Trading / investment experience\nSupported.');
  const appId=Number(db.prepare("INSERT INTO applications(job_id,status,application_folder) VALUES (?,'SAVED',?)").run(jobId,folder).lastInsertRowid);
  const before=evaluateReadyToApply(db,jobId);assert.ok(before.reasons.includes('ROLE_FAMILY_NOT_ACCEPTABLE'));assert.equal(queuePreflight(db,jobId).ok,false);
  db.prepare("UPDATE jobs SET application_override_at=CURRENT_TIMESTAMP,application_override_reason='User selected adjacent role',application_override_actor='USER' WHERE id=?").run(jobId);
  const after=evaluateReadyToApply(db,jobId);assert.equal(after.reasons.includes('ROLE_FAMILY_NOT_ACCEPTABLE'),false);assert.ok(after.warnings.includes('OVERRIDDEN_ROLE_FAMILY_NOT_ACCEPTABLE'));assert.ok(after.warnings.includes('OVERRIDDEN_KNOCKOUT_PRESENT'));assert.equal(queuePreflight(db,jobId).ok,true);
  assert.throws(()=>transitionApplication(db,appId,'READY_TO_APPLY'),/WORK_QUEUE_APPROVAL_REQUIRED/);
  db.close();
});

test.after(()=>fs.rmSync(root,{recursive:true,force:true}));

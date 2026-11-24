import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'jcc-discovery-send-boundary-'));
process.env.JCC_ROOT=root;
const { DatabaseSync }=await import('node:sqlite');
const { migrate }=await import('../src/migrate.mjs');
const { seed }=await import('../src/seed.mjs');
const { importCv }=await import('../src/services/cvLibrary.mjs');
const { LocalScheduler }=await import('../src/scheduler.mjs');
const { dashboardReadModel }=await import('../src/services/dashboardReadModel.mjs');
const { sendToWorkQueue,processQueueItem,reviewQueueItem,approveQueueItem }=await import('../src/services/workQueue.mjs');
const { paths }=await import('../src/paths.mjs');

function counts(db,jobId){return {
  applications:Number(db.prepare('SELECT count(*) n FROM applications WHERE job_id=?').get(jobId).n),
  childCvs:Number(db.prepare('SELECT count(*) n FROM cv_versions WHERE job_id=?').get(jobId).n),
  queue:Number(db.prepare('SELECT count(*) n FROM application_work_queue WHERE job_id=?').get(jobId).n),
  contacts:Number(db.prepare('SELECT count(*) n FROM job_contacts WHERE job_id=?').get(jobId).n)
};}

test('discovery stops at matched storage; SEND alone crosses into application production',async()=>{
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');migrate(db);seed(db);
  db.exec('UPDATE sources SET enabled=0; DELETE FROM target_roles; DELETE FROM target_locations;');
  db.prepare("INSERT INTO target_roles(family,phrase,enabled) VALUES ('TRADING','Derivatives Trader',1)").run();
  db.prepare("INSERT INTO target_locations(country,country_code,city,enabled) VALUES ('United Kingdom','GB','London',1)").run();
  db.prepare("INSERT INTO sources(name,kind,base_url,enabled,health,adapter,ownership) VALUES ('Phase Three Capital','ATS','https://boards.greenhouse.io/phase-three',1,'UNTESTED','greenhouse','USER_ADDED')").run();
  const cv=['PROFILE','Derivatives trader with futures execution, Python market analysis and structured risk controls.','WORK EXPERIENCE','Derivative Trading Analyst','• Executed listed derivatives and futures using structured risk limits.','• Used Python for market analysis, execution monitoring and quantitative research.','• Prepared execution summaries, reconciled positions and supported accurate trade records.','• Improved execution workflow, reducing slippage by 12%.','EDUCATION','MSc International Financial Markets'].join('\n');
  await importCv(db,{buffer:Buffer.from(cv),filename:'phase-3-master.txt',isMaster:true,isActive:true});
  const confirmed=value=>({confirmed:true,current:true,value});
  db.prepare('INSERT INTO candidate_profile(id,name,work_authorization_json,preferences_json) VALUES (1,?,?,?)').run('Phase 3 Candidate',JSON.stringify({workAuthorisation:confirmed('Authorised'),sponsorship:confirmed('Not required')}),JSON.stringify({applicationFacts:{salary:confirmed('Open to discussion'),noticePeriod:confirmed('Four weeks'),relocation:confirmed('Not required'),startDate:confirmed('After notice period')}}));
  db.prepare("INSERT INTO settings(key,value) VALUES ('local_writer_enabled','0') ON CONFLICT(key) DO UPDATE SET value='0'").run();

  const source=fs.readFileSync(new URL('../src/scheduler.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/prepareEligibleJobsAutomatically|prepareJobAutomatically|AUTO_PREP_START|AUTO_PREP_COMPLETE/);
  const posted=new Date(Date.now()-3600000).toISOString(),url='https://example.test/jobs/phase-3-strong';
  const scheduler=new LocalScheduler(db,{providers:{agentReachDoctor:async()=>({available:false}),scanGreenhouse:async()=>[{externalId:'phase-3-strong',company:'Phase Three Capital',title:'Derivatives Trader',location:'London, United Kingdom',sourceUrl:url,applicationUrl:url,employerPublishedAt:posted,jdRaw:'Derivatives Trader role executing listed derivatives and futures using Python market analysis, execution monitoring, quantitative research, trade capture, position reconciliation and structured risk controls. '.repeat(4)}]}});
  const discovery=await scheduler.trigger('MANUAL',{preflight:{ok:true,activeMasterPresent:true}});
  assert.notEqual(discovery.status,'FAILED');assert.equal('autoPrep' in discovery,false);
  const job=db.prepare("SELECT * FROM jobs WHERE external_id='phase-3-strong'").get();assert.ok(job);assert.equal(job.status,'DISCOVERED');
  const recruiter=db.prepare("SELECT * FROM job_analysis WHERE job_id=? AND analysis_type='RECRUITER'").get(job.id);assert.ok(recruiter);assert.ok(['STRONG MATCH','GOOD MATCH'].includes(recruiter.verdict));
  assert.deepEqual(counts(db,job.id),{applications:0,childCvs:0,queue:0,contacts:0});
  assert.equal(db.prepare("SELECT count(*) n FROM applications WHERE job_id=? AND status='READY_TO_APPLY'").get(job.id).n,0);
  assert.equal(db.prepare("SELECT count(*) n FROM audit_events WHERE entity_id=? AND event_type LIKE 'AUTO_PREP%'").get(job.id).n,0);

  let dashboard=dashboardReadModel(db);assert.ok(dashboard.strong+dashboard.good>=1);assert.equal(dashboard.queued,0);assert.equal(dashboard.ready,0);
  const sent=sendToWorkQueue(db,job.id);assert.equal(sent.status,'QUEUED');assert.deepEqual(counts(db,job.id),{applications:0,childCvs:0,queue:1,contacts:0});assert.ok(path.resolve(sent.item.folder_path).startsWith(path.resolve(paths.dataRoot)+path.sep));assert.equal(path.resolve(sent.item.folder_path).startsWith(path.resolve(process.cwd())+path.sep),false);
  dashboard=dashboardReadModel(db);assert.equal(dashboard.queued,1);assert.equal(dashboard.ready,0);

  const processed=await processQueueItem(db,sent.item.id);assert.equal(processed.status,'READY_FOR_REVIEW');assert.equal(processed.result.status,'PREPARED_FOR_REVIEW');assert.equal(processed.result.steps.outreach,undefined);assert.equal(db.prepare('SELECT status FROM applications WHERE job_id=?').get(job.id).status,'SAVED');assert.equal(db.prepare('SELECT count(*) n FROM cv_versions WHERE job_id=?').get(job.id).n,1);assert.ok(db.prepare("SELECT count(*) n FROM cv_version_files f JOIN cv_versions v ON v.id=f.cv_version_id WHERE v.job_id=? AND f.format IN ('DOCX','PDF')").get(job.id).n>=2);assert.equal(dashboardReadModel(db).queued,1);
  reviewQueueItem(db,sent.item.id);const approved=approveQueueItem(db,sent.item.id);assert.equal(approved.application.status,'READY_TO_APPLY');assert.equal(approved.application.applied_at,null);assert.equal(db.prepare("SELECT count(*) n FROM application_documents WHERE application_id=? AND kind LIKE 'SUBMITTED_%'").get(approved.application.id).n,0);assert.equal(db.prepare('SELECT count(*) n FROM followups WHERE application_id=?').get(approved.application.id).n,0);assert.equal(db.prepare('SELECT count(*) n FROM job_contacts WHERE job_id=?').get(job.id).n,0);assert.equal(dashboardReadModel(db).ready,1);assert.equal(dashboardReadModel(db).queued,0);
  db.close();
});

test.after(()=>fs.rmSync(root,{recursive:true,force:true}));

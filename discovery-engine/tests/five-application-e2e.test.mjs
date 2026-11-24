import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'jcc-five-application-e2e-'));
process.env.JCC_ROOT=root;

const { migrate }=await import('../src/migrate.mjs');
const { paths }=await import('../src/paths.mjs');
const { rematchJob }=await import('../src/services/jobWorkflow.mjs');
const { sendToWorkQueue,processQueueItem }=await import('../src/services/workQueue.mjs');
const { evaluateReadyToApply }=await import('../src/services/readyGate.mjs');

const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const MASTER=[
  'PROFILE',
  'Trading professional with experience across equities, derivatives, futures, options and commodities, combining discretionary trading, market analysis, strategy development and risk management.',
  'WORK EXPERIENCE',
  'Northbridge Capital',
  'Derivative Trading Analyst',
  'Dec 2024 – Oct 2025',
  '• Executed simulated and live discretionary trades across equities, futures, options and commodities, making time-sensitive entry and exit decisions while assessing liquidity, market conditions and execution risk.',
  '• Converted discretionary market observations into structured trade ideas using order-book behaviour, liquidity shifts and volume-price dynamics.',
  '• Monitored live P&L, margin, portfolio exposure and daily risk checks; prepared execution summaries and reconciled positions.',
  'Harbour Lane Partners',
  'Equity Trader',
  'Feb 2021 – May 2022',
  '• Implemented trading strategies and achieved a 31% return on trading accounts and an 18% improvement in managed portfolio performance.',
  '• Implemented fundamental research and micro-analysis to identify opportunities and optimise portfolio performance.',
  'RESEARCH EXPERIENCE AND PROJECTS',
  'SignalLab',
  '• Built Python systematic trading research and backtesting tests using market microstructure, trend, momentum and volatility analysis.',
  'EDUCATION',
  'MSc International Financial Markets',
  'CERTIFICATIONS',
  'Executive Programme in Algorithmic Trading (EPAT)'
].join('\n');

const CASES=[
  ['Derivatives Trader','Execute futures and options trades and monitor trading risk.','Derivatives trading experience is required.'],
  ['Trading Risk Analyst','Monitor P&L, margin, portfolio exposure and daily risk controls.','Trading risk analysis experience is required.'],
  ['Market Research Analyst','Analyse market trends and develop trading ideas.','Market research and analytical experience is required.'],
  ['Portfolio Trading Analyst','Support portfolio trading, execution and exposure monitoring.','Portfolio and derivatives experience is required.'],
  ['Trading Operations Analyst','Prepare execution summaries, reconcile positions and monitor risk.','Trading operations experience is required.']
];

test('five distinct SEND workflows produce isolated complete review packages and never apply',async()=>{
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');migrate(db);
  fs.mkdirSync(paths.cvMaster,{recursive:true});const masterPath=path.join(paths.cvMaster,'master.txt');fs.writeFileSync(masterPath,MASTER,'utf8');const masterHash=sha(MASTER),docId=Number(db.prepare('INSERT INTO cv_documents(original_filename,stored_path,sha256,mime_type,extracted_text) VALUES (?,?,?,?,?)').run('master.txt',masterPath,masterHash,'text/plain',MASTER).lastInsertRowid),masterId=Number(db.prepare("INSERT INTO cv_versions(document_id,version_label,is_master,is_active) VALUES (?,'MASTER-FIVE-E2E',1,1)").run(docId).lastInsertRowid);db.prepare("INSERT INTO cv_version_files(cv_version_id,format,path,sha256,mime_type,is_primary) VALUES (?,'TXT',?,?,'text/plain',1)").run(masterId,masterPath,masterHash);
  db.prepare("INSERT INTO candidate_profile(id,name,work_authorization_json,preferences_json) VALUES (1,'Candidate Example','{}','{}') ON CONFLICT(id) DO UPDATE SET name=excluded.name,work_authorization_json='{}',preferences_json='{}'").run();
  db.prepare("INSERT INTO settings(key,value) VALUES ('local_writer_enabled','0') ON CONFLICT(key) DO UPDATE SET value='0'").run();db.prepare("INSERT INTO settings(key,value) VALUES ('auto_contact_research','0') ON CONFLICT(key) DO UPDATE SET value='0'").run();
  const results=[];
  for(const [index,[title,responsibility,requirement]] of CASES.entries()){
    const company=`Regression Employer ${index+1}`,url=`https://example.test/jobs/${index+1}`,jobId=Number(db.prepare("INSERT INTO jobs(company,title,location_raw,country,country_code,city,canonical_job_url,application_url,role_classification,role_family,location_confidence,status) VALUES (?,?,?,?,?,?,?,?,?,?,100,'DISCOVERED')").run(company,title,'London, United Kingdom','United Kingdom','GB','London',url,url,'ROLE_MATCH','TRADING').lastInsertRowid),jd=`## Responsibilities\n- ${responsibility}\n\n## Requirements\n- ${requirement}`;
    db.prepare("INSERT INTO job_jd_versions(job_id,jd_raw,jd_clean,jd_clean_hash,jd_quality) VALUES (?,?,?,?, 'GOOD')").run(jobId,jd,jd,sha(jd));
    const matched=rematchJob(db,jobId);assert.ok(['STRONG MATCH','GOOD MATCH'].includes(matched.recruiter.verdict),`${title}: ${matched.recruiter.score} ${matched.recruiter.verdict}`);
    const sent=sendToWorkQueue(db,jobId,{queueRoot:paths.applicationQueue}),processed=await processQueueItem(db,sent.item.id);assert.equal(processed.status,'READY_FOR_REVIEW',`${title}: ${processed.result?.error||processed.item?.last_error||'unexpected state'}`);
    const gate=evaluateReadyToApply(db,jobId),app=db.prepare('SELECT * FROM applications WHERE job_id=?').get(jobId);assert.equal(gate.ok,true,`${title}: ${gate.reasons.join(', ')}`);assert.ok(['TAILORED','NO_CHANGE_REVIEW'].includes(gate.applicationCv.mode));assert.equal(app.status,'SAVED');assert.equal(app.applied_at,null);assert.ok(fs.existsSync(path.join(app.application_folder,'JD','jd-clean.md')));assert.ok(fs.existsSync(path.join(app.application_folder,'Cover-Letter','cover-letter.md')));assert.ok(fs.existsSync(path.join(app.application_folder,'Application-Answers','answers.md')));assert.ok(fs.existsSync(path.join(app.application_folder,'CV','review-cv-manifest.json')));results.push({jobId,folder:app.application_folder,cvVersionId:gate.applicationCv.cvVersionId});
  }
  assert.equal(new Set(results.map(x=>x.jobId)).size,5);assert.equal(new Set(results.map(x=>x.folder)).size,5);assert.equal(db.prepare("SELECT count(*) n FROM application_work_queue WHERE state='READY_FOR_REVIEW'").get().n,5);assert.equal(db.prepare("SELECT count(*) n FROM applications WHERE status='APPLIED'").get().n,0);db.close();
});

test.after(()=>fs.rmSync(root,{recursive:true,force:true}));

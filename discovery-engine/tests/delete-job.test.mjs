import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/migrate.mjs';
import { deleteJob } from '../src/services/jobDeletion.mjs';
import { tombstoneMatches } from '../src/services/jobRetention.mjs';
import { listJobs } from '../src/services/jobQueries.mjs';
import { dashboardReadModel } from '../src/services/dashboardReadModel.mjs';
import { ingestJob } from '../src/services/jobs.mjs';
import { sendToWorkQueue,listWorkQueue } from '../src/services/workQueue.mjs';

function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'jcc-delete-'));const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');migrate(db);return{root,db,close(){db.close();fs.rmSync(root,{recursive:true,force:true})}};}
function addJob(db,{company='Disposable Test Co',title='Disposable Analyst',status='DISCOVERED',externalId='delete-1',url='https://jobs.example/delete-1'}={}){return Number(db.prepare(`INSERT INTO jobs(external_id,company,title,location_raw,source_url,canonical_job_url,application_url,role_classification,role_family,status) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(externalId,company,title,'London, United Kingdom',url,url,url,'ROLE_MATCH','INVESTMENT_RESEARCH',status).lastInsertRowid);}
function addJd(db,id,hash='jd-hash'){db.prepare(`INSERT INTO job_jd_versions(job_id,jd_raw,jd_clean,jd_clean_hash,jd_quality) VALUES (?,?,?,?,?)`).run(id,'Full job description','Full job description',hash,'GOOD');}

test('DELETE removes an eligible job from active queries',()=>{const f=fixture(),id=addJob(f.db);deleteJob(f.db,id);assert.deepEqual(listJobs(f.db).map(x=>x.id),[]);f.close()});
test('DELETE removes match data and cannot surface in ready views',()=>{const f=fixture(),id=addJob(f.db);f.db.prepare(`INSERT INTO job_analysis(job_id,analysis_type,score,verdict) VALUES (?,'RECRUITER',91,'STRONG MATCH')`).run(id);deleteJob(f.db,id);assert.equal(f.db.prepare('SELECT count(*) n FROM job_analysis WHERE job_id=?').get(id).n,0);assert.equal(listJobs(f.db,{status:'READY_TO_APPLY'}).length,0);f.close()});
test('DELETE never moves a job into Archived',()=>{const f=fixture(),id=addJob(f.db);deleteJob(f.db,id);assert.equal(listJobs(f.db,{scope:'archived'}).length,0);f.close()});
test('DELETE adjusts active, archived, total and match counts',()=>{const f=fixture(),id=addJob(f.db);f.db.prepare(`INSERT INTO job_analysis(job_id,analysis_type,score,verdict) VALUES (?,'RECRUITER',91,'STRONG MATCH')`).run(id);const before=dashboardReadModel(f.db);deleteJob(f.db,id);const after=dashboardReadModel(f.db);assert.deepEqual([before.activeJobs,before.totalStored,before.strong],[1,1,1]);assert.deepEqual([after.activeJobs,after.archived,after.totalStored,after.strong],[0,0,0,0]);f.close()});

test('dashboard match counters use only each job latest recruiter verdict',()=>{const f=fixture(),id=addJob(f.db);f.db.prepare(`INSERT INTO job_analysis(job_id,analysis_type,score,verdict) VALUES (?,'RECRUITER',91,'STRONG MATCH')`).run(id);f.db.prepare(`INSERT INTO job_analysis(job_id,analysis_type,score,verdict) VALUES (?,'RECRUITER',64,'POSSIBLE / STRETCH')`).run(id);const dashboard=dashboardReadModel(f.db);assert.equal(dashboard.strong,0);assert.equal(dashboard.good,0);f.close()});
test('deleted identity is suppressed when the same vacancy is ingested again',()=>{const f=fixture(),id=addJob(f.db);deleteJob(f.db,id);const raw={externalId:'delete-1',company:'Disposable Test Co',title:'Disposable Analyst',sourceUrl:'https://jobs.example/delete-1',applicationUrl:'https://jobs.example/delete-1',jdRaw:'expensive full JD'};assert.equal(tombstoneMatches(f.db,raw),true);const result=ingestJob(f.db,raw);assert.equal(result.status,'USER_DELETED_SUPPRESSED');assert.equal(f.db.prepare('SELECT count(*) n FROM jobs').get().n,0);f.close()});
test('discovery suppression check precedes expensive JD hydration',()=>{const source=fs.readFileSync(new URL('../src/discovery/service.mjs',import.meta.url),'utf8');const tombstone=source.indexOf('tombstoneMatches(db');const hydration=source.indexOf('await hydrateJob(',tombstone);assert.ok(tombstone>0&&hydration>tombstone)});
test('DELETE fails safely for protected application history',()=>{const f=fixture(),id=addJob(f.db,{externalId:'protected'});f.db.prepare(`INSERT INTO applications(job_id,status,application_folder) VALUES (?,'APPLIED',?)`).run(id,path.join(f.root,'application'));assert.throws(()=>deleteJob(f.db,id),/DELETE_BLOCKED_PROTECTED_HISTORY: APPLICATION_STATUS_APPLIED|DELETE_BLOCKED_PROTECTED_HISTORY: JOB_STATUS_APPLIED/);assert.ok(f.db.prepare('SELECT 1 FROM jobs WHERE id=?').get(id));f.close()});
test('DELETE leaves unrelated jobs unchanged',()=>{const f=fixture(),gone=addJob(f.db),keep=addJob(f.db,{company:'Keep Co',title:'Keep Role',externalId:'keep-1',url:'https://jobs.example/keep-1'});deleteJob(f.db,gone);assert.deepEqual(listJobs(f.db,{scope:'all'}).map(x=>x.id),[keep]);f.close()});
test('SEND and Work Queue remain functional and protect queued jobs',()=>{const f=fixture(),id=addJob(f.db,{externalId:'queue-1',url:'https://jobs.example/queue-1'});addJd(f.db,id);const sent=sendToWorkQueue(f.db,id,{queueRoot:path.join(f.root,'Queue')});assert.equal(sent.status,'QUEUED');assert.equal(listWorkQueue(f.db).length,1);assert.throws(()=>deleteJob(f.db,id),/DELETE_BLOCKED_PROTECTED_HISTORY/);f.close()});
test('UI exposes DELETE without replacing VIEW, SEND, OPEN or simple confirmation',()=>{const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');for(const text of ['VIEW','SEND','OPEN ↗','DELETE','Delete this job from JCC? It will be removed from your job lists and will not be rediscovered.'])assert.match(source,new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')))});

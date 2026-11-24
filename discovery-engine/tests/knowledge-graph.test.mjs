import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'jcc-graph-'));
process.env.JCC_ROOT=root;
const { DatabaseSync }=await import('node:sqlite');
const { migrate }=await import('../src/migrate.mjs');
const { seed }=await import('../src/seed.mjs');
const { refreshKnowledgeVault, syncApplicationKnowledge, syncInterviewKnowledge }=await import('../src/knowledgeVault.mjs');
const { onboardSource }=await import('../src/services/sourceOnboarding.mjs');
const { ingestJob }=await import('../src/services/jobs.mjs');
const { ensureApplication,transitionApplication,markApplied }=await import('../src/services/applicationTracker.mjs');
const { rematchJob,tailorJob }=await import('../src/services/jobWorkflow.mjs');
const { prepareApplicationPackage }=await import('../src/services/packagePrep.mjs');
const { approveNoChange }=await import('../src/services/readyGate.mjs');

function makeDb(){const file=path.join(root,'JCC-Data','database','graph.sqlite');fs.mkdirSync(path.dirname(file),{recursive:true});const db=new DatabaseSync(file);db.exec('PRAGMA foreign_keys=ON');migrate(db);seed(db);return db;}

function registerCv(db){
  const cvDir=path.join(root,'JCC-Data','CV','Master');fs.mkdirSync(cvDir,{recursive:true});const cvPath=path.join(cvDir,'master.txt');const text='PROFILE\nDerivatives Trading Analyst\nWORK EXPERIENCE\nNorthbridge Capital\nDerivative Trading Analyst | Dec 2024 - Oct 2025\n• Executed derivatives trades across equities, futures and options using structured risk controls\n• Performed market analysis and exposure monitoring with senior traders\n• Prepared execution summaries, reconciled positions and supported accurate trading records with colleagues\nSKILLS\nPython research and automation\nExcel analytical workflows\nEDUCATION\nMSc International Financial Markets';fs.writeFileSync(cvPath,text);const sha=crypto.createHash('sha256').update(text).digest('hex');
  const doc=Number(db.prepare('INSERT INTO cv_documents(original_filename,stored_path,sha256,extracted_text) VALUES (?,?,?,?)').run('master.txt',cvPath,sha,text).lastInsertRowid);
  return Number(db.prepare('INSERT INTO cv_versions(document_id,version_label,is_master,is_active) VALUES (?,?,1,1)').run(doc,'MASTER-V1').lastInsertRowid);
}

test('knowledge vault builds meaningful Obsidian clusters without any 3D plugin installed',()=>{
  const db=makeDb();refreshKnowledgeVault(db);const vault=path.join(root,'JCC-Knowledge');
  for(const d of ['Candidate','Skills','Agents','Sources','Applications','Jobs','Architecture','Decisions','Failures','Runbooks','Releases','CV','Interviews'])assert.ok(fs.existsSync(path.join(vault,d)),d);
  const home=fs.readFileSync(path.join(vault,'00_HOME.md'),'utf8');assert.match(home,/\[\[JCC LOCAL\]\]/);assert.match(home,/\[\[Senior Recruiter\]\]/);
  const skill=fs.readFileSync(path.join(vault,'Skills','Senior Recruiter.md'),'utf8');assert.match(skill,/type: "skill"/);assert.match(skill,/\[\[JD Cleaner\]\]/);assert.match(skill,/\[\[Evidence Ledger\]\]/);
  const guide=fs.readFileSync(path.join(vault,'Runbooks','3D GRAPH GUIDE.md'),'utf8');assert.match(guide,/New 3D Graph/);assert.match(guide,/Three D Graph View/);assert.match(guide,/path:\"Applications\"/);
  assert.equal(fs.existsSync(path.join(vault,'.obsidian','plugins','new-3d-graph')),false,'plugin is not a runtime dependency');db.close();
});

test('application graph note updates in place and links exact submitted CV and interview',async()=>{
  const db=makeDb();const cvId=registerCv(db);refreshKnowledgeVault(db);
  const source=onboardSource(db,{name:'Acme Greenhouse',baseUrl:'https://job-boards.greenhouse.io/acme'});
  const jd='Requirements\n- Must have experience executing derivatives trades across equities, futures and options using structured risk controls.\nResponsibilities\n- Perform market analysis and exposure monitoring with senior traders.\n- Prepare execution summaries, perform trade capture and position reconciliation, and maintain accurate trading records with colleagues.\nAbout us\nWe are an established global business with a diverse client base and a collaborative culture. This exciting opportunity joins a growing team where different experiences are welcomed, people feel supported, and colleagues are empowered to make an impact. We provide competitive benefits, parental leave and an inclusive workplace. We are an equal opportunity employer committed to diversity and inclusion.';
  const result=ingestJob(db,{company:'Acme Capital',title:'Derivatives Trading Analyst',location:'London, United Kingdom',sourceUrl:'https://job-boards.greenhouse.io/acme/jobs/1',applicationUrl:'https://job-boards.greenhouse.io/acme/jobs/1',sourceId:source.sourceId,jdRaw:jd},{activeCvText:'Derivatives Trading Analyst futures options execution risk management Excel Python market analysis'});
  rematchJob(db,result.jobId,cvId);const app=ensureApplication(db,result.jobId),tailored=await tailorJob(db,result.jobId);let submittedCvId=tailored.tailoredCvVersionId||cvId;if(tailored.status==='NO_MEANINGFUL_CHANGE'){submittedCvId=cvId;approveNoChange(db,result.jobId,{note:'Fixture review confirms the Master already matches this JD without factual changes.'});}prepareApplicationPackage(db,result.jobId,{coverLetter:true,answers:true,outreach:true});transitionApplication(db,app.id,'READY_TO_APPLY',{queueApproval:true});const cvFile=db.prepare('SELECT * FROM cv_version_files WHERE cv_version_id=? ORDER BY is_primary DESC,id LIMIT 1').get(submittedCvId);markApplied(db,{applicationId:app.id,cvVersionId:submittedCvId,cvFileId:cvFile?.id||null});
  const appDir=path.join(root,'JCC-Knowledge','Applications');const before=fs.readdirSync(appDir).filter(x=>x.endsWith('.md'));assert.equal(before.length,1);
  const ir=db.prepare('INSERT INTO interviews(application_id,scheduled_at,stage,mode,status) VALUES (?,?,?,?,?)').run(app.id,'2026-09-20T10:00:00','Technical','Zoom','SCHEDULED');assert.ok(Number(ir.lastInsertRowid));db.prepare("UPDATE applications SET status='INTERVIEW' WHERE id=?").run(app.id);db.prepare("UPDATE jobs SET status='INTERVIEW' WHERE id=?").run(result.jobId);syncInterviewKnowledge(db,app.id);syncApplicationKnowledge(db,app.id);
  const after=fs.readdirSync(appDir).filter(x=>x.endsWith('.md'));assert.deepEqual(after,before,'status updates must not create duplicate application nodes');
  const submittedCvToken=`CV-${String(submittedCvId).padStart(4,'0')}`,content=fs.readFileSync(path.join(appDir,after[0]),'utf8');assert.match(content,/status: "INTERVIEW"/);assert.ok(content.includes(`[[CV Version ${submittedCvToken}]]`));assert.match(content,/\[\[Submitted CV JOB-000001\]\]/);assert.match(content,/\[\[Interview JOB-000001\]\]/);
  const interview=fs.readFileSync(path.join(root,'JCC-Knowledge','Interviews','Interview JOB-000001.md'),'utf8');assert.match(interview,/\[\[Application JOB-000001\]\]/);assert.match(interview,/\[\[Job JOB-000001\]\]/);assert.ok(interview.includes(`[[CV Version ${submittedCvToken}]]`));
  const sourceNote=fs.readFileSync(path.join(root,'JCC-Knowledge','Sources','Acme Greenhouse.md'),'utf8');assert.match(sourceNote,/\[\[Greenhouse\]\]/);assert.match(sourceNote,/\[\[Job JOB-000001\]\]/);db.close();
});

test('Windows knowledge launcher is present and plugin invocation remains optional',()=>{
  const script=fs.readFileSync(path.resolve('open-knowledge.bat'),'utf8');assert.match(script,/obsidian:\/\/open\?path=/i);assert.match(script,/Open 3D Graph/i);assert.match(script,/Opening the vault folder instead/i);
});

test('generated release-state notes describe alpha.4 hardening and built-in non-blocking graph',()=>{
  const db=makeDb();refreshKnowledgeVault(db);const vault=path.join(root,'JCC-Knowledge');
  const current=fs.readFileSync(path.join(vault,'CURRENT_STATE.md'),'utf8');
  const system=fs.readFileSync(path.join(vault,'SYSTEM_MAP.md'),'utf8');
  const releases=fs.readFileSync(path.join(vault,'RELEASES.md'),'utf8');
  const sources=fs.readFileSync(path.join(vault,'Sources','Workday.md'),'utf8');
  assert.match(current,/Version: 2\.0\.0-alpha\.4/);assert.match(current,/built-in live 3D graph/i);assert.match(current,/Windows target-machine validation/i);
  assert.match(system,/src\/graph\/indexer\.mjs/);assert.match(system,/src\/graph\/service\.mjs/);assert.match(releases,/2\.0\.0-alpha\.4/);assert.match(releases,/real DOCX\/PDF\/Markdown/);assert.match(sources,/Status: \*\*READY\*\*/);db.close();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'jcc-archive-'));process.env.JCC_ROOT=root;
const { DatabaseSync }=await import('node:sqlite');
const { migrate }=await import('../src/migrate.mjs');
const { ensureApplication,transitionApplication,markApplied }=await import('../src/services/applicationTracker.mjs');
const { prepareApplicationPackage }=await import('../src/services/packagePrep.mjs');

function sha(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function readyFixture(name,{multi=false}={}){
  const db=new DatabaseSync(path.join(root,name+'.sqlite'));db.exec('PRAGMA foreign_keys=ON');migrate(db);
  const jobId=Number(db.prepare("INSERT INTO jobs(company,title,location_raw,canonical_job_url,application_url,role_classification,role_family,location_confidence,status) VALUES ('ExactCo','Derivatives Trader','London','https://exact/jobs/1','https://exact/jobs/1','ROLE_MATCH','TRADING',100,'SAVED')").run().lastInsertRowid);
  const jd='Derivatives Trader role. Core responsibilities include derivatives and futures execution, market analysis, disciplined risk limits and exposure monitoring. Candidates must demonstrate relevant trading experience and analytical judgement.';
  db.prepare("INSERT INTO job_jd_versions(job_id,jd_raw,jd_clean,jd_clean_hash,jd_quality) VALUES (?,?,?,?,?)").run(jobId,jd,jd,'jd-'+name,'FULL');
  db.prepare("INSERT INTO requirements(job_id,category,text) VALUES (?,?,?)").run(jobId,'CORE','Derivatives and futures execution with disciplined risk limits');
  const cvText='PROFILE\nDerivative trading analyst with market analysis experience\nWORK EXPERIENCE\n• Executed derivatives trades across equities and futures using structured risk limits\n• Monitored exposure and market conditions to support trading decisions\nEDUCATION\nMSc International Financial Markets';
  const cvDir=path.join(root,'JCC-Data','CV','Tailored');fs.mkdirSync(cvDir,{recursive:true});
  const source=path.join(cvDir,name+'.txt');fs.writeFileSync(source,cvText);const sourceHash=sha(source);
  const docId=Number(db.prepare('INSERT INTO cv_documents(original_filename,stored_path,sha256,mime_type,extracted_text) VALUES (?,?,?,?,?)').run(name+'.txt',source,sourceHash,'text/plain',cvText).lastInsertRowid);
  const cvId=Number(db.prepare('INSERT INTO cv_versions(document_id,version_label,is_master,is_active,job_id) VALUES (?,?,0,0,?)').run(docId,'TAILORED-'+name,jobId).lastInsertRowid);
  let files=[];
  if(multi){
    const docx=path.join(cvDir,name+'.docx'),pdf=path.join(cvDir,name+'.pdf');fs.writeFileSync(docx,'DOCX-BYTES-'+name);fs.writeFileSync(pdf,'PDF-BYTES-'+name);
    const f1=Number(db.prepare('INSERT INTO cv_version_files(cv_version_id,format,path,sha256,is_primary) VALUES (?,?,?,?,1)').run(cvId,'DOCX',docx,sha(docx)).lastInsertRowid);
    const f2=Number(db.prepare('INSERT INTO cv_version_files(cv_version_id,format,path,sha256,is_primary) VALUES (?,?,?,?,0)').run(cvId,'PDF',pdf,sha(pdf)).lastInsertRowid);files=[db.prepare('SELECT * FROM cv_version_files WHERE id=?').get(f1),db.prepare('SELECT * FROM cv_version_files WHERE id=?').get(f2)];
  }
  const recruiter={clearKnockout:false,knockoutGaps:[],seniorityCompatibility:{materialMismatch:false},topStrengths:[{evidenceText:'Executed derivatives trades across equities and futures using structured risk limits'}]};
  db.prepare("INSERT INTO job_analysis(job_id,cv_version_id,analysis_type,score,verdict,payload_json) VALUES (?,?,'RECRUITER',85,'STRONG MATCH',?)").run(jobId,cvId,JSON.stringify(recruiter));
  db.prepare("INSERT INTO job_analysis(job_id,cv_version_id,analysis_type,score,payload_json) VALUES (?,?,'ATS_EXACT',82,'{}')").run(jobId,cvId);
  db.prepare("INSERT INTO job_analysis(job_id,cv_version_id,analysis_type,score,verdict,payload_json) VALUES (?,?,'POST_TAILOR',85,'REVIEW_AND_APPLY_MANUALLY',?)").run(jobId,cvId,JSON.stringify({integrity:'PASS',tailoringQuality:{version:'2.1.0-semantic',passed:true,semanticChangePassed:true,evidenceBearingChanges:1},materialChange:{meaningful:true}}));
  const app=ensureApplication(db,jobId);prepareApplicationPackage(db,jobId,{coverLetter:true,answers:true,outreach:true});transitionApplication(db,app.id,'READY_TO_APPLY',{queueApproval:true});
  return{db,jobId,cvId,app:db.prepare('SELECT * FROM applications WHERE id=?').get(app.id),source,sourceHash,files};
}

test('mark applied stores immutable submitted CV, package snapshots and correct hash',()=>{
  const f=readyFixture('single');const result=markApplied(f.db,{applicationId:f.app.id,cvVersionId:f.cvId,followupDays:7});
  assert.equal(result.status,'APPLIED');assert.ok(fs.existsSync(result.submittedCv.path));assert.equal(result.submittedCv.sha256,f.sourceHash);
  assert.ok(fs.existsSync(path.join(f.app.application_folder,'CV','submitted-cv.sha256')));
  for(const kind of ['SUBMITTED_CV','SUBMITTED_JD','SUBMITTED_COVER_LETTER','SUBMITTED_APPLICATION_ANSWERS','SUBMITTED_CONTACTS','SUBMITTED_OUTREACH','SUBMITTED_RECRUITER_ANALYSIS','SUBMITTED_ATS_ANALYSIS','SUBMITTED_HISTORY','SUBMISSION_MANIFEST'])assert.ok(result.archivedKinds.includes(kind),kind);
  const manifest=JSON.parse(fs.readFileSync(result.manifest.path,'utf8'));assert.equal(manifest.cvVersionId,f.cvId);assert.equal(manifest.submittedCv.sha256,f.sourceHash);assert.equal(manifest.applicationUrl,'https://exact/jobs/1');
  assert.throws(()=>markApplied(f.db,{applicationId:f.app.id,cvVersionId:f.cvId}),/READY_TO_APPLY/);f.db.close();
});

test('MARK APPLIED requires and archives the exact selected physical file for a multi-format CV version',()=>{
  const f=readyFixture('multi',{multi:true});assert.throws(()=>markApplied(f.db,{applicationId:f.app.id,cvVersionId:f.cvId}),/exact physical CV file/i);
  const pdf=f.files.find(x=>x.format==='PDF'),result=markApplied(f.db,{applicationId:f.app.id,cvVersionId:f.cvId,cvFileId:pdf.id});
  assert.equal(path.extname(result.submittedCv.path),'.pdf');assert.equal(result.submittedCv.sha256,pdf.sha256);assert.equal(fs.readFileSync(result.submittedCv.path,'utf8'),'PDF-BYTES-multi');assert.equal(result.selectedCvFile.id,pdf.id);f.db.close();
});

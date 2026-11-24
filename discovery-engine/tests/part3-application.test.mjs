import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'jcc-part3-'));process.env.JCC_ROOT=root;
const repoRoot=fileURLToPath(new URL('..',import.meta.url));
const { DatabaseSync }=await import('node:sqlite');
const { migrate }=await import('../src/migrate.mjs');
const { prepareApplicationPackage,prepareOutreach,prepareFollowup,prepareInterview }=await import('../src/services/packagePrep.mjs');
const { ensureApplication,transitionApplication,markApplied,completeInterview,recordApplicationEvent }=await import('../src/services/applicationTracker.mjs');
const { evaluateReadyToApply,approveNoChange }=await import('../src/services/readyGate.mjs');
const { inferPublicContact,researchJobContacts }=await import('../src/services/contactResearch.mjs');

function hash(data){return crypto.createHash('sha256').update(data).digest('hex');}
function fixture({name='base',title='Derivatives Trader',jdExtra='',knockout=false,child=true}={}){
  const db=new DatabaseSync(':memory:');migrate(db);
  db.prepare("INSERT INTO candidate_profile(id,name,work_authorization_json,preferences_json) VALUES (1,'Candidate Example',?,?)").run(JSON.stringify({workAuthorization:{value:'Historic visa wording',confirmed:false,current:false}}),JSON.stringify({}));
  const jobId=Number(db.prepare("INSERT INTO jobs(company,title,location_raw,canonical_job_url,application_url,role_classification,role_family,location_confidence,status) VALUES (?,?,?,?,?,'ROLE_MATCH','TRADING',100,'SAVED')").run('Example Capital',title,'London','https://example.test/jobs/'+name,'https://example.test/jobs/'+name+'/apply').lastInsertRowid);
  const jd='The '+title+' role requires derivatives and futures execution, market analysis, disciplined risk limits and exposure monitoring. Strong analytical judgement is a core requirement. The role works closely with a trading team and requires clear communication. '+jdExtra;
  db.prepare("INSERT INTO job_jd_versions(job_id,jd_raw,jd_clean,jd_clean_hash,jd_quality) VALUES (?,?,?,?,?)").run(jobId,jd,jd,hash(Buffer.from(jd)),'FULL');
  db.prepare("INSERT INTO requirements(job_id,category,text) VALUES (?,?,?)").run(jobId,'CORE','Derivatives and futures execution with disciplined risk limits');
  db.prepare("INSERT INTO requirements(job_id,category,text) VALUES (?,?,?)").run(jobId,'IMPORTANT','Market analysis and exposure monitoring');
  const masterText=['PROFILE','Derivative trading analyst with market analysis and risk management experience','WORK EXPERIENCE','Northbridge Capital','Derivative Trading Analyst | Dec 2024 - Oct 2025','• Executed derivatives trades across equities and futures using structured risk limits','• Improved execution workflow by using structured limits, reducing slippage by 12%','• Monitored exposure and market conditions to support trading decisions','• Used Python for systematic trading research and strategy testing','EDUCATION','MSc International Financial Markets, University of Northfield, Merit'].join('\n');
  const dir=path.join(root,'cv');fs.mkdirSync(dir,{recursive:true});const masterPath=path.join(dir,'master-'+name+'.txt');fs.writeFileSync(masterPath,masterText);const masterHash=hash(fs.readFileSync(masterPath));
  const md=Number(db.prepare('INSERT INTO cv_documents(original_filename,stored_path,sha256,mime_type,extracted_text) VALUES (?,?,?,?,?)').run('master.txt',masterPath,masterHash,'text/plain',masterText).lastInsertRowid),masterId=Number(db.prepare("INSERT INTO cv_versions(document_id,version_label,is_master,is_active) VALUES (?,'MASTER',1,1)").run(md).lastInsertRowid);
  let cvId=masterId,files=[];
  if(child){
    const quality={version:'2.1.0-semantic',passed:true,semanticChangePassed:true,evidenceBearingChanges:1,substantiveChanges:1},childText=masterText+'\n';const childPath=path.join(dir,'tailored-'+name+'.txt');fs.writeFileSync(childPath,childText);const ch=hash(fs.readFileSync(childPath)),cd=Number(db.prepare('INSERT INTO cv_documents(original_filename,stored_path,sha256,mime_type,extracted_text) VALUES (?,?,?,?,?)').run('tailored.txt',childPath,ch,'text/plain',childText).lastInsertRowid);cvId=Number(db.prepare("INSERT INTO cv_versions(document_id,parent_version_id,version_label,is_master,is_active,job_id,evidence_map_json) VALUES (?,?,'TAILORED',0,0,?,?)").run(cd,masterId,jobId,JSON.stringify({tailoringQuality:quality})).lastInsertRowid);
    for(const [format,bytes,ext,primary] of [['DOCX','DOCX-'+name,'.docx',1],['PDF','PDF-'+name,'.pdf',0],['MD',childText,'.md',0]]){const p=path.join(dir,'tailored-'+name+ext);fs.writeFileSync(p,bytes);const r=db.prepare('INSERT INTO cv_version_files(cv_version_id,format,path,sha256,mime_type,is_primary) VALUES (?,?,?,?,?,?)').run(cvId,format,p,hash(fs.readFileSync(p)),format==='PDF'?'application/pdf':format==='DOCX'?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'text/markdown',primary);files.push(db.prepare('SELECT * FROM cv_version_files WHERE id=?').get(Number(r.lastInsertRowid)));}
    db.prepare("INSERT INTO job_analysis(job_id,cv_version_id,analysis_type,score,verdict,payload_json) VALUES (?,?,'POST_TAILOR',86,'REVIEW_AND_APPLY_MANUALLY',?)").run(jobId,cvId,JSON.stringify({integrity:'PASS',tailoringQuality:quality,materialChange:{meaningful:true}}));
  }else{
    db.prepare("INSERT INTO job_analysis(job_id,cv_version_id,analysis_type,score,verdict,payload_json) VALUES (?,?,'NO_CHANGE_CANDIDATE',NULL,'USER APPROVAL REQUIRED',?)").run(jobId,masterId,JSON.stringify({integrity:'PASS',cvVersionId:masterId,materialChange:{meaningful:false}}));
  }
  const recruiter={clearKnockout:knockout,knockoutGaps:knockout?[{severity:'KNOCKOUT',text:'Mandatory requirement not met'}]:[],seniorityCompatibility:{materialMismatch:false},topStrengths:[{evidenceText:'Executed derivatives trades across equities and futures using structured risk limits'},{evidenceText:'Improved execution workflow by using structured limits, reducing slippage by 12%'}]};
  db.prepare("INSERT INTO job_analysis(job_id,cv_version_id,analysis_type,score,verdict,payload_json) VALUES (?,?,'RECRUITER',?,?,?)").run(jobId,cvId,knockout?40:86,knockout?'DO NOT APPLY':'STRONG MATCH',JSON.stringify(recruiter));
  db.prepare("INSERT INTO job_analysis(job_id,cv_version_id,analysis_type,score,payload_json) VALUES (?,?,'ATS_EXACT',81,'{}')").run(jobId,cvId);
  const app=ensureApplication(db,jobId),pkg=prepareApplicationPackage(db,jobId,{coverLetter:true,answers:true,outreach:true});
  return{db,jobId,app:db.prepare('SELECT * FROM applications WHERE id=?').get(app.id),pkg,masterId,masterPath,masterHash,cvId,files,jd};
}

test('cover letter is substantive, evidence-backed, role-specific and British-English application writing stays factual',()=>{
  const f=fixture({name:'letter'}),letter=fs.readFileSync(f.pkg.artifacts.coverLetter,'utf8'),answers=fs.readFileSync(f.pkg.artifacts.applicationAnswers,'utf8'),wc=letter.split(/\s+/).filter(Boolean).length;
  assert.ok(wc>=250&&wc<=400,'default cover letter word count '+wc);assert.match(letter,/Derivatives Trader/);assert.match(letter,/Example Capital/);assert.match(letter,/12%/);assert.match(letter,/derivatives and futures execution/i);assert.doesNotMatch(letter,/industry-leading|prestigious|renowned|innovative culture|perfect fit|stored job description|evidence that can be tested|work involving/i);assert.doesNotMatch(letter,/Executed derivatives trades across equities and futures using structured risk limits\./);
  assert.equal(f.pkg.verification.coverLetter.integrity,'PASS');assert.equal(f.pkg.verification.coverLetter.verifierRanAfterHumanizer,true);assert.match(answers,/Work authorisation/);assert.doesNotMatch(answers,/Work authorization/);f.db.close();
});

test('application writing excludes JD marketing introductions and grammatically converts role activities',()=>{
  const f=fixture({name:'marketing-focus'}),row=f.db.prepare("SELECT * FROM job_analysis WHERE job_id=? AND analysis_type='RECRUITER' ORDER BY id DESC LIMIT 1").get(f.jobId),payload=JSON.parse(row.payload_json);
  payload.jdMasterKeywordInventory=[
    {candidateRelevant:true,informationClass:'CORE_JOB_ACTIVITY',category:'CORE',importance:100,sourceSection:'Responsibilities',cleanText:'This is an excellent opportunity to join a highly regarded systematic equities business, working closely with quantitative traders and researchers.'},
    {candidateRelevant:true,informationClass:'CORE_JOB_ACTIVITY',category:'CORE',importance:90,sourceSection:'Responsibilities',cleanText:'Monitor live systematic trading strategies across cash equities and equity index futures.'},
    {candidateRelevant:true,informationClass:'CORE_JOB_ACTIVITY',category:'IMPORTANT',importance:80,sourceSection:'Responsibilities',cleanText:'Optimise execution performance using market and trading data.'}
  ];
  f.db.prepare('UPDATE job_analysis SET payload_json=? WHERE id=?').run(JSON.stringify(payload),row.id);
  const p=prepareApplicationPackage(f.db,f.jobId,{coverLetter:true,answers:true,outreach:false}),text=fs.readFileSync(p.artifacts.coverLetter,'utf8')+'\n'+fs.readFileSync(p.artifacts.applicationAnswers,'utf8');
  assert.doesNotMatch(text,/excellent opportunity|highly regarded|emphasis on this is|emphasis on monitor live/i);
  assert.match(text,/monitoring live systematic trading strategies/i);assert.match(text,/optimising execution performance/i);f.db.close();
});

test('application writing uses the evidence-backed CV name, complete first-person sentences and strongest technical evidence',()=>{
  const f=fixture({name:'writing-polish'}),cvRow=f.db.prepare('SELECT document_id FROM cv_versions WHERE id=?').get(f.cvId),original=f.db.prepare('SELECT extracted_text FROM cv_documents WHERE id=?').get(cvRow.document_id).extracted_text,combined='Executed derivatives trades across equities and futures using structured risk limits. Monitored live P&L and exposure alerts';
  f.db.prepare('UPDATE candidate_profile SET name=NULL WHERE id=1').run();f.db.prepare('UPDATE cv_documents SET extracted_text=? WHERE id=?').run('Alex Morgan\n'+original.replace('Executed derivatives trades across equities and futures using structured risk limits',combined),cvRow.document_id);
  const recruiter=f.db.prepare("SELECT * FROM job_analysis WHERE job_id=? AND analysis_type='RECRUITER' ORDER BY id DESC LIMIT 1").get(f.jobId),payload=JSON.parse(recruiter.payload_json);payload.topStrengths=[{evidenceText:combined}];f.db.prepare('UPDATE job_analysis SET payload_json=? WHERE id=?').run(JSON.stringify(payload),recruiter.id);
  const p=prepareApplicationPackage(f.db,f.jobId,{coverLetter:true,answers:true,outreach:false}),letter=fs.readFileSync(p.artifacts.coverLetter,'utf8'),answers=fs.readFileSync(p.artifacts.applicationAnswers,'utf8');
  assert.match(letter,/I monitored live P&L and exposure alerts\./);assert.doesNotMatch(letter,/\. Monitored live P&L/);assert.match(letter,/Kind regards\s+Alex Morgan\s*$/);assert.match(answers,/Python/);f.db.close();
});

test('application answers cover required families and preserve exact confirmation marker instead of stale work-authorisation guesses',()=>{
  const f=fixture({name:'answers'}),answers=fs.readFileSync(f.pkg.artifacts.applicationAnswers,'utf8');
  for(const h of ['Why this role?','Why this company?','Relevant experience','Technical experience','Trading / investment experience'])assert.match(answers,new RegExp(h.replace(/[/?]/g,'\\$&')));
  assert.match(answers,/Python/);assert.match(answers,/USER CONFIRMATION REQUIRED/);assert.doesNotMatch(answers,/Historic visa wording/);assert.doesNotMatch(answers,/valid until|March 2026/i);assert.equal(f.pkg.verification.applicationAnswers.integrity,'PASS');f.db.close();
});

test('application evidence stops at the next role and employer instead of concatenating CV structure',()=>{
  const f=fixture({name:'evidence-boundary'});
  const cv=['PROFILE','Derivative trading analyst with market analysis and risk management experience','WORK EXPERIENCE','Derivative Trading Analyst Dec 2024 – Oct 2025','Northbridge Capital, London UK','• Supported portfolio exposures within defined risk parameters.','Market Analyst (Remote-Internship) April 2023 – June 2023','Kestrel Capital Limited - Northfield, UK','• Analysed market data to support research decisions.','EDUCATION','MSc International Financial Markets, University of Northfield, Merit'].join('\n');
  f.db.prepare('UPDATE cv_documents SET extracted_text=? WHERE id=(SELECT document_id FROM cv_versions WHERE id=?)').run(cv,f.cvId);
  const p=prepareApplicationPackage(f.db,f.jobId,{coverLetter:true,answers:true,outreach:false});
  const combined=fs.readFileSync(p.artifacts.coverLetter,'utf8')+'\n'+fs.readFileSync(p.artifacts.applicationAnswers,'utf8');
  assert.doesNotMatch(combined,/risk parameters\.?\s+Market Analyst/i);
  assert.doesNotMatch(combined,/risk parameters\.?\s+Kestrel Capital/i);
  assert.match(combined,/Supported portfolio exposures within defined risk parameters/i);
  f.db.close();
});

test('public contact parsing never confirms identity from a slug and never fabricates email',()=>{
  const slug=inferPublicContact({title:'',text:'Senior Recruiter at Example Capital',url:'https://www.linkedin.com/in/jane-doe-12345'},'Example Capital');assert.equal(slug.personLike,false);assert.equal(slug.name,'');assert.equal(slug.email,'');
  const explicit=inferPublicContact({title:'Jane Doe - Senior Recruiter | LinkedIn',text:'Example Capital',url:'https://www.linkedin.com/in/jane-doe'},'Example Capital');assert.equal(explicit.personLike,true);assert.equal(explicit.confirmationState,'UNCONFIRMED_PUBLIC');assert.equal(explicit.email,'');assert.ok(explicit.sourceUrl);assert.ok(explicit.linkedinUrl);
});

test('Agent Reach remains optional and safely degrades to manual-only contact research',async()=>{
  const f=fixture({name:'reach'}),r=await researchJobContacts(f.db,f.jobId,{searchProvider:async()=>{throw new Error('offline')}});assert.equal(r.agentReachOptional,true);assert.equal(r.status,'NO_CONFIRMED_CONTACT');assert.equal(r.fallback,'MANUAL_ONLY');assert.equal(r.candidates.length,0);assert.match(r.errors[0],/offline/);f.db.close();
});

test('outreach never claims submission before MARK APPLIED and may reflect it only after the manual event',()=>{
  const f=fixture({name:'outreach'}),before=fs.readFileSync(prepareOutreach(f.db,f.jobId).artifacts.outreach,'utf8');assert.doesNotMatch(before,/I applied|submitted an application/i);
  transitionApplication(f.db,f.app.id,'READY_TO_APPLY',{queueApproval:true});const pdf=f.files.find(x=>x.format==='PDF'),applied=markApplied(f.db,{applicationId:f.app.id,cvVersionId:f.cvId,cvFileId:pdf.id});const after=fs.readFileSync(prepareOutreach(f.db,f.jobId).artifacts.outreach,'utf8');assert.match(after,/submitted an application/i);assert.equal(applied.status,'APPLIED');f.db.close();
});

test('follow-up requires the exact recorded event, including completed interview evidence',()=>{
  const f=fixture({name:'follow'});assert.throws(()=>prepareFollowup(f.db,f.app.id),/no manually recorded application event/i);transitionApplication(f.db,f.app.id,'READY_TO_APPLY',{queueApproval:true});const pdf=f.files.find(x=>x.format==='PDF');markApplied(f.db,{applicationId:f.app.id,cvVersionId:f.cvId,cvFileId:pdf.id});
  assert.doesNotThrow(()=>prepareFollowup(f.db,f.app.id,{kind:'APPLICATION'}));const interviewId=Number(f.db.prepare("INSERT INTO interviews(application_id,scheduled_at,stage,status) VALUES (?,?,?,'SCHEDULED')").run(f.app.id,'2026-09-20T10:00:00Z','Technical').lastInsertRowid);assert.throws(()=>prepareFollowup(f.db,f.app.id,{kind:'INTERVIEW'}),/no completed interview event/i);completeInterview(f.db,interviewId);assert.doesNotThrow(()=>prepareFollowup(f.db,f.app.id,{kind:'INTERVIEW'}));assert.throws(()=>prepareFollowup(f.db,f.app.id,{kind:'ASSESSMENT'}),/no completed assessment event/i);recordApplicationEvent(f.db,f.app.id,'ASSESSMENT_COMPLETED');assert.doesNotThrow(()=>prepareFollowup(f.db,f.app.id,{kind:'ASSESSMENT'}));f.db.close();
});

test('READY_TO_APPLY hard gate blocks mandatory knockout and CIO 10-year mismatch even through manual transition',()=>{
  const k=fixture({name:'knockout',knockout:true});assert.ok(evaluateReadyToApply(k.db,k.jobId).reasons.includes('KNOCKOUT_PRESENT'));assert.throws(()=>transitionApplication(k.db,k.app.id,'READY_TO_APPLY',{queueApproval:true}),/KNOCKOUT_PRESENT/);k.db.close();
  const c=fixture({name:'cio',title:'Chief Investment Officer',jdExtra:'A minimum of 10+ years of investment leadership experience is mandatory.'});assert.ok(evaluateReadyToApply(c.db,c.jobId).reasons.includes('CIO_TENURE_MISMATCH'));assert.throws(()=>transitionApplication(c.db,c.app.id,'READY_TO_APPLY',{queueApproval:true}),/CIO_TENURE_MISMATCH/);c.db.close();
});

test('evidence-safe no-change reaches review with Master but still requires the user approval action before READY',()=>{
  const f=fixture({name:'nochange',child:false}),before=evaluateReadyToApply(f.db,f.jobId);assert.equal(before.ok,true);assert.equal(before.applicationCv.mode,'NO_CHANGE_REVIEW');assert.ok(before.warnings.includes('NO_MEANINGFUL_CHANGE_USES_MASTER'));assert.throws(()=>transitionApplication(f.db,f.app.id,'READY_TO_APPLY',{queueApproval:true}),/NO_CHANGE_REVIEW_APPROVAL_REQUIRED/);approveNoChange(f.db,f.jobId,{note:'Reviewed and approved'});const after=evaluateReadyToApply(f.db,f.jobId);assert.equal(after.applicationCv.mode,'APPROVED_NO_CHANGE');assert.equal(after.ok,true);assert.doesNotThrow(()=>transitionApplication(f.db,f.app.id,'READY_TO_APPLY',{queueApproval:true}));f.db.close();
});

test('MARK APPLIED creates immutable package archive; interview prep remains pinned to it after later edits',()=>{
  const f=fixture({name:'archive'});transitionApplication(f.db,f.app.id,'READY_TO_APPLY',{queueApproval:true});const pdf=f.files.find(x=>x.format==='PDF');const applied=markApplied(f.db,{applicationId:f.app.id,cvVersionId:f.cvId,cvFileId:pdf.id});
  assert.equal(applied.submittedCv.sha256,pdf.sha256);assert.ok(fs.existsSync(applied.manifest.path));const manifest=JSON.parse(fs.readFileSync(applied.manifest.path,'utf8'));assert.equal(manifest.cvVersionId,f.cvId);assert.equal(manifest.submittedCv.sha256,pdf.sha256);
  fs.writeFileSync(path.join(f.app.application_folder,'Cover-Letter','cover-letter.md'),'LATER COVER LETTER WITH 99% UNSUPPORTED CLAIM');fs.writeFileSync(path.join(f.app.application_folder,'Application-Answers','answers.md'),'LATER ANSWER 99%');
  const laterText='PROFILE\nLater CV with 99% unsupported portfolio performance';const laterPath=path.join(root,'later-archive.txt');fs.writeFileSync(laterPath,laterText);const d=Number(f.db.prepare('INSERT INTO cv_documents(original_filename,stored_path,sha256,mime_type,extracted_text) VALUES (?,?,?,?,?)').run('later.txt',laterPath,hash(Buffer.from(laterText)),'text/plain',laterText).lastInsertRowid);f.db.prepare("INSERT INTO cv_versions(document_id,parent_version_id,version_label,is_master,is_active,job_id) VALUES (?,?,'LATER',0,0,?)").run(d,f.masterId,f.jobId);
  const prep=prepareInterview(f.db,f.jobId),text=fs.readFileSync(prep.file,'utf8');assert.equal(prep.submittedCvVersionId,f.cvId);assert.equal(prep.submittedCvSha256,pdf.sha256);assert.doesNotMatch(text,/99%/);assert.ok(prep.coverLetterSnapshot.includes('submitted-cover-letter.md'));assert.equal(prep.verification.integrity,'PASS');f.db.close();
});

test('pre-application CV UX exposes tailored actions but never advertises a submitted CV before submission',()=>{
  const ui=fs.readFileSync(path.join(repoRoot,'public','app.js'),'utf8');for(const label of ['OPEN TAILORED CV','DOWNLOAD DOCX','DOWNLOAD PDF','PREVIEW'])assert.match(ui,new RegExp(label));assert.doesNotMatch(ui,/OPEN CV USED/);assert.match(ui,/submittedCvAvailable\?'[^']*OPEN SUBMITTED CV/);
});

test('no external send endpoint or send primitive is introduced',()=>{
  const files=['src/server.mjs','src/alpha4Api.mjs','src/services/packagePrep.mjs'].map(x=>fs.readFileSync(path.join(repoRoot,x),'utf8')).join('\n');assert.doesNotMatch(files,/\/api\/[^'"`\s]*(?:send-email|send-message|submit-application)/i);assert.doesNotMatch(fs.readFileSync(path.join(repoRoot,'src','services','packagePrep.mjs'),'utf8'),/\b(?:sendMail|nodemailer|smtp)\b/i);
});

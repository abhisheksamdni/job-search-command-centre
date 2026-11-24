import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'jcc-writing-hardening-'));
process.env.JCC_ROOT=root;
const repoRoot=fileURLToPath(new URL('..',import.meta.url));
const { migrate }=await import('../src/migrate.mjs');
const { paths }=await import('../src/paths.mjs');
const { humanizeGeneratedText,cleanTextArtifacts }=await import('../src/services/textHumanizer.mjs');
const { verifyTailored }=await import('../src/services/integrity.mjs');
const { rewriteCvWithLocalModel,localWriterStatus }=await import('../src/services/localWritingEngine.mjs');
const { tailorCvConservatively }=await import('../src/services/cvTailor.mjs');
const { tailorJob }=await import('../src/services/jobWorkflow.mjs');
const { prepareApplicationPackage,prepareFollowup,prepareInterview }=await import('../src/services/packagePrep.mjs');
const { ensureApplication }=await import('../src/services/applicationTracker.mjs');
const { researchJobContacts }=await import('../src/services/contactResearch.mjs');
const { prepareJobAutomatically }=await import('../src/services/autoApplicationPrep.mjs');
const { createTailoredCvOutputsPreservingTemplate }=await import('../src/services/cvOutput.mjs');
const { reorderTemplateBullets }=await import('../src/services/docxTemplate.mjs');

function sha(buf){return crypto.createHash('sha256').update(buf).digest('hex');}
function dbFixture(){const db=new DatabaseSync(':memory:');migrate(db);return db;}
function putSetting(db,key,value){db.prepare("INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key,String(value));}
function baseFixture(){
 const db=dbFixture();fs.mkdirSync(paths.cvMaster,{recursive:true});
 const masterText=['PROFILE','Trading analyst with derivatives execution experience','WORK EXPERIENCE','Northbridge Capital','Derivative Trading Analyst | Dec 2024 - Oct 2025','• Executed derivatives trades across equities and futures using structured risk limits','• Improved execution workflow by using structured limits, reducing slippage by 12%','EDUCATION','MSc International Financial Markets'].join('\n');
 const masterPath=path.join(paths.cvMaster,`master-${crypto.randomUUID()}.txt`);fs.writeFileSync(masterPath,masterText,'utf8');const hash=sha(Buffer.from(masterText));
 const docId=Number(db.prepare('INSERT INTO cv_documents(original_filename,stored_path,sha256,mime_type,extracted_text) VALUES (?,?,?,?,?)').run('master.txt',masterPath,hash,'text/plain',masterText).lastInsertRowid);
 const masterId=Number(db.prepare("INSERT INTO cv_versions(document_id,version_label,is_master,is_active) VALUES (?,'MASTER',1,1)").run(docId).lastInsertRowid);
 db.prepare("INSERT INTO candidate_profile(id,name) VALUES (1,'Candidate Example')").run();
 const jobId=Number(db.prepare("INSERT INTO jobs(company,title,location_raw,canonical_job_url,application_url,status) VALUES ('Example Capital','Derivatives Trader','London','https://example.test/jobs/1','https://example.test/jobs/1','DISCOVERED')").run().lastInsertRowid);
 const jd='Derivatives Trader role requiring futures execution, risk limits and market analysis.';
 db.prepare("INSERT INTO job_jd_versions(job_id,jd_raw,jd_clean,jd_clean_hash,jd_quality) VALUES (?,?,?,?,?)").run(jobId,jd,jd,sha(Buffer.from(jd)),'FULL');
 db.prepare("INSERT INTO requirements(job_id,category,text) VALUES (?,?,?)").run(jobId,'CORE','Derivatives trading and futures execution');
 return {db,masterId,masterPath,masterText,masterHash:hash,jobId,jd};
}
function walkText(dir){if(!fs.existsSync(dir))return [];const out=[];for(const ent of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,ent.name);if(ent.isDirectory())out.push(...walkText(file));else if(/\.(?:md|mjs|json)$/i.test(ent.name))out.push(file);}return out;}

test('humanizer removes safe artifacts but preserves semantic joiners and ordinary wording',()=>{
 const source='Executed derivatives trades using structured risk limits';
 assert.equal(humanizeGeneratedText(source,{domain:'CV'}),source+'\n');
 assert.equal(cleanTextArtifacts('A\u00adB\u200bC'),'ABC');
 assert.equal(cleanTextArtifacts('A\u200cB\u200dC'),'A\u200cB\u200dC');
 assert.equal(cleanTextArtifacts('A\u00a0B'),'A\u00a0B');
});

test('humanizer removes boilerplate without fake typos, facts or detector output',()=>{
 const out=humanizeGeneratedText('I hope this message finds you well. I am writing to express my strong interest in the Trader role. Return: 31%',{domain:'OUTREACH'});
 assert.doesNotMatch(out,/hope this message finds/i);assert.match(out,/Trader role/);assert.match(out,/31%/);assert.doesNotMatch(out,/\bteh\b|detector|undetectable|score:/i);
});

test('Google XYZ guidance keeps genuine metrics and never invents a missing Y',()=>{
 const cv='• Improved execution workflow by using structured limits, reducing slippage by 12%\n• Executed futures trades using structured risk limits';
 const r=tailorCvConservatively({cvText:cv,requirements:[{category:'CORE',text:'futures execution and risk limits'}]});
 assert.match(r.text,/12%/);assert.equal(r.evidenceMap.xyzCoverage.totalBullets,2);assert.equal(r.evidenceMap.xyzCoverage.noMetricDoNotInvent,1);assert.doesNotMatch(r.text,/(?!12)\b\d+%/);
});

test('post-tailor verifier rejects new and changed numerical claims',()=>{
 const master='• Improved execution workflow by using structured limits, reducing slippage by 12%';
 assert.equal(verifyTailored({masterText:master,tailoredText:'• Improved execution workflow by using structured limits, reducing slippage by 18%'}).integrity,'FAIL');
 assert.equal(verifyTailored({masterText:master,tailoredText:'• Improved execution workflow by using structured limits, reducing slippage by 12%'}).integrity,'PASS');
});

test('post-tailor verifier rejects employer, title, date and tool drift',()=>{
 const master=['Northbridge Capital','Derivative Trading Analyst | Dec 2024 - Oct 2025','• Executed derivatives trades across equities using Excel risk controls'].join('\n');
 for(const bad of ['Goldman Sachs\nDerivative Trading Analyst | Dec 2024 - Oct 2025\n• Executed derivatives trades across equities using Excel risk controls','Northbridge Capital\nSenior Portfolio Manager | Dec 2024 - Oct 2025\n• Executed derivatives trades across equities using Excel risk controls','Northbridge Capital\nDerivative Trading Analyst | Dec 2024 - Oct 2026\n• Executed derivatives trades across equities using Excel risk controls','Northbridge Capital\nDerivative Trading Analyst | Dec 2024 - Oct 2025\n• Executed derivatives trades across equities using Python risk controls'])assert.equal(verifyTailored({masterText:master,tailoredText:bad}).integrity,'FAIL');
});

test('local writer refuses non-loopback endpoints without making a request',async()=>{
 const db=dbFixture();putSetting(db,'local_writer_enabled','1');putSetting(db,'local_writer_url','https://example.com:11434');let called=false;const status=await localWriterStatus(db,{fetchImpl:async()=>{called=true;throw new Error('must not call');}});assert.equal(status.available,false);assert.equal(called,false);assert.match(status.reason,/loopback/i);db.close();
});

test('local writer rejects unsupported numeric rewrites and keeps the deterministic source',async()=>{
 const db=dbFixture();putSetting(db,'local_writer_enabled','1');putSetting(db,'local_writer_url','http://127.0.0.1:11434');
 const fetchImpl=async url=>String(url).endsWith('/api/tags')?{ok:true,json:async()=>({models:[{name:'qwen-test'}]})}:{ok:true,json:async()=>({response:JSON.stringify({text:'Increased derivatives execution performance by 99% using structured risk limits'})})};
 const source='• Executed derivatives trades using structured risk limits';const r=await rewriteCvWithLocalModel({db,cvText:source,requirements:[{category:'CORE',text:'derivatives execution'}],fetchImpl});assert.equal(r.used,false);assert.equal(r.text,source);db.close();
});

test('local writer unavailability is non-blocking and returns the original CV',async()=>{
 const db=dbFixture();putSetting(db,'local_writer_enabled','1');putSetting(db,'local_writer_url','http://localhost:11434');const source='• Executed derivatives trades using structured risk limits';const r=await rewriteCvWithLocalModel({db,cvText:source,fetchImpl:async()=>{throw new Error('offline');}});assert.equal(r.used,false);assert.equal(r.text,source);assert.match(r.fallbackReason,/offline/);db.close();
});

test('job B tailoring still inherits immutable Master after job A child exists and creates physical outputs',async()=>{
 const f=baseFixture();putSetting(f.db,'local_writer_enabled','0');const original=fs.readFileSync(f.masterPath);const childDoc=Number(f.db.prepare('INSERT INTO cv_documents(original_filename,stored_path,sha256,mime_type,extracted_text) VALUES (?,?,?,?,?)').run('job-a.txt',f.masterPath,sha(Buffer.from('job-a-child')),'text/plain','JOB A CHILD').lastInsertRowid);f.db.prepare("INSERT INTO cv_versions(document_id,parent_version_id,version_label,is_master,is_active,job_id) VALUES (?,?,'JOB-A',0,1,999)").run(childDoc,f.masterId);
 const r=await tailorJob(f.db,f.jobId);assert.equal(r.parentCvVersionId,f.masterId);assert.equal(r.parentIsMaster,true);assert.deepEqual(fs.readFileSync(f.masterPath),original);assert.equal(sha(fs.readFileSync(f.masterPath)),f.masterHash);for(const p of [r.docxPath,r.pdfPath,r.previewPath])assert.ok(p&&fs.existsSync(p)&&fs.statSync(p).size>0);const child=f.db.prepare('SELECT * FROM cv_versions WHERE id=?').get(r.tailoredCvVersionId);assert.equal(child.parent_version_id,f.masterId);assert.equal(child.job_id,f.jobId);f.db.close();
});

test('template fallback reports preservation truthfully and never mutates the source',async()=>{
 const dir=fs.mkdtempSync(path.join(root,'bad-template-')),source=path.join(dir,'master.docx'),base=path.join(dir,'child');fs.writeFileSync(source,'not-a-docx');const before=sha(fs.readFileSync(source));const out=await createTailoredCvOutputsPreservingTemplate({text:'PROFILE\nTrading analyst\nWORK EXPERIENCE\n• Executed derivatives trades using structured limits',basePath:base,sourcePath:source,keyTerms:['derivatives']});assert.equal(out.templatePreserved,false);assert.equal(out.pdfTemplatePreserved,false);assert.ok(out.warnings.some(x=>/template preservation failed/i.test(x)));assert.equal(sha(fs.readFileSync(source)),before);for(const f of out.files)assert.ok(fs.existsSync(f.path)&&fs.statSync(f.path).size>0);
});

test('template bullet prioritisation never moves the employer below experience bullets',()=>{
 const p=(text,bullet=false)=>`<w:p>${bullet?'<w:pPr><w:numPr/></w:pPr>':''}<w:r><w:t>${text}</w:t></w:r></w:p>`;
 const xml='<w:document><w:body>'+p('Derivative Trading Analyst Dec 2024 – Oct 2025')+p('Northbridge Capital, London UK',true)+p('General administration work.',true)+p('Executed derivatives trades using structured risk limits.',true)+'</w:body></w:document>';
 const out=reorderTemplateBullets(xml,['derivatives','risk']);
 assert.ok(out.xml.indexOf('Northbridge Capital')<out.xml.indexOf('Executed derivatives'));
 assert.ok(out.xml.indexOf('Executed derivatives')<out.xml.indexOf('General administration'));
});

test('application writing retains exact confirmation markers and does not pretend an unsubmitted application was submitted',()=>{
 const f=baseFixture();const p=prepareApplicationPackage(f.db,f.jobId,{coverLetter:true,answers:true,outreach:true});const answers=fs.readFileSync(p.artifacts.applicationAnswers,'utf8'),outreach=fs.readFileSync(p.artifacts.outreach,'utf8');assert.match(answers,/USER CONFIRMATION REQUIRED/);assert.doesNotMatch(answers,/USER_CONFIRMATION_REQUIRED/);assert.match(outreach,/I am considering the Derivatives Trader role/);assert.doesNotMatch(outreach,/I applied|submitted an application/i);assert.equal(p.verification.coverLetter.integrity,'PASS');f.db.close();
});

test('follow-up drafting is blocked when no real application event is recorded',()=>{
 const f=baseFixture();const app=ensureApplication(f.db,f.jobId);assert.throws(()=>prepareFollowup(f.db,app.id),/no manually recorded application event/i);f.db.close();
});

test('interview preparation is pinned to the exact submitted package, not later CV or draft edits',()=>{
 const f=baseFixture(),app=ensureApplication(f.db,f.jobId);f.db.prepare("UPDATE applications SET status='APPLIED',submitted_cv_version_id=?,applied_at=CURRENT_TIMESTAMP WHERE id=?").run(f.masterId,app.id);
 const add=(kind,rel,text,cvId=null)=>{const file=path.join(app.application_folder,...rel.split('/'));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text,'utf8');const h=sha(Buffer.from(text));f.db.prepare("INSERT INTO application_documents(application_id,kind,path,sha256,cv_version_id,immutable) VALUES (?,?,?,?,?,1)").run(app.id,kind,file,h,cvId);return{file,h}};
 f.db.prepare("INSERT INTO application_documents(application_id,kind,path,sha256,cv_version_id,immutable) VALUES (?,?,?,?,?,1)").run(app.id,'SUBMITTED_CV',f.masterPath,f.masterHash,f.masterId);
 add('SUBMITTED_JD','JD/jd-submitted-snapshot.md',f.jd);add('SUBMITTED_COVER_LETTER','Cover-Letter/submitted-cover-letter.md','Dear Hiring Team,\n\nMy submitted letter refers to derivatives execution and structured risk limits.');add('SUBMITTED_APPLICATION_ANSWERS','Application-Answers/submitted-answers.md','# Application Answers\n\n## Relevant experience\nExecuted derivatives trades using structured risk limits\n\n## Work authorisation / sponsorship\nUSER CONFIRMATION REQUIRED');add('SUBMITTED_RECRUITER_ANALYSIS','Analysis/submitted-recruiter.json',JSON.stringify({verdict:'GOOD MATCH',score:80,payload:{}},null,2));add('SUBMITTED_ATS_ANALYSIS','Analysis/submitted-ats.json',JSON.stringify({score:75,payload:{}},null,2));add('SUBMITTED_HISTORY','Evidence/submitted-history.json',JSON.stringify([{created_at:'2026-01-01T00:00:00Z',old_status:'READY_TO_APPLY',new_status:'APPLIED',note:'Manual application recorded'}],null,2));
 const laterPath=path.join(root,'later-99.txt');fs.writeFileSync(laterPath,'• Claimed 99% portfolio performance using unsupported evidence');const laterDoc=Number(f.db.prepare('INSERT INTO cv_documents(original_filename,stored_path,sha256,mime_type,extracted_text) VALUES (?,?,?,?,?)').run('later.txt',laterPath,sha(fs.readFileSync(laterPath)),'text/plain','• Claimed 99% portfolio performance using unsupported evidence').lastInsertRowid);f.db.prepare("INSERT INTO cv_versions(document_id,parent_version_id,version_label,is_master,is_active,job_id) VALUES (?,?,'LATER',0,0,?)").run(laterDoc,f.masterId,f.jobId);
 const r=prepareInterview(f.db,f.jobId),body=fs.readFileSync(r.file,'utf8');assert.equal(r.submittedCvVersionId,f.masterId);assert.equal(r.submittedCvSha256,f.masterHash);assert.doesNotMatch(body,/99%/);assert.match(body,/Submitted CV SHA-256/);assert.match(body,/USER CONFIRMATION REQUIRED/);f.db.close();
});

test('Agent Reach contact research degrades safely when search is unavailable',async()=>{
 const f=baseFixture();const r=await researchJobContacts(f.db,f.jobId,{searchProvider:async()=>{throw new Error('Agent Reach offline');}});assert.equal(r.status,'NO_CONFIRMED_CONTACT');assert.equal(r.candidates.length,0);assert.deepEqual(r.errors,['AGENT_REACH_PUBLIC_SEARCH: Agent Reach offline']);assert.equal(f.db.prepare('SELECT count(*) n FROM contacts').get().n,0);f.db.close();
});

test('automatic Strong/Good preparation creates one review package but never APPLIED',async()=>{
 const f=baseFixture();putSetting(f.db,'local_writer_enabled','0');f.db.prepare("UPDATE jobs SET role_classification='ROLE_MATCH',role_family='TRADING',location_confidence=100 WHERE id=?").run(f.jobId);const payload=JSON.stringify({clearKnockout:false,knockoutGaps:[],seniorityCompatibility:{materialMismatch:false}});f.db.prepare("INSERT INTO job_analysis(job_id,analysis_type,score,verdict,payload_json) VALUES (?,'RECRUITER',85,'STRONG MATCH',?)").run(f.jobId,payload);f.db.prepare("INSERT INTO job_analysis(job_id,analysis_type,score,verdict,payload_json) VALUES (?,'ATS_EXACT',80,NULL,'{}')").run(f.jobId);const first=await prepareJobAutomatically(f.db,f.jobId,{researchContacts:false});assert.equal(first.status,'PREPARED_FOR_REVIEW');assert.equal(first.applicationStatus,'SAVED');assert.equal(first.steps.matchRefresh.methodology,'2.0.0-56-point');assert.equal(first.steps.verify.integrity,'PASS');const app=f.db.prepare('SELECT * FROM applications WHERE job_id=?').get(f.jobId);assert.equal(app.status,'SAVED');assert.equal(app.applied_at,null);assert.ok(f.db.prepare('SELECT id FROM cv_versions WHERE job_id=?').get(f.jobId));const second=await prepareJobAutomatically(f.db,f.jobId,{researchContacts:false});assert.equal(second.status,'SKIPPED');assert.equal(second.reason,'PACKAGE_ALREADY_PREPARED');assert.equal(f.db.prepare("SELECT count(*) n FROM applications WHERE status='APPLIED'").get().n,0);f.db.close();
});

test('forced package regeneration rebuilds physical CV outputs even when tailored text is unchanged',async()=>{
 const f=baseFixture();putSetting(f.db,'local_writer_enabled','0');f.db.prepare("UPDATE jobs SET role_classification='ROLE_MATCH',role_family='TRADING',location_confidence=100 WHERE id=?").run(f.jobId);const payload=JSON.stringify({clearKnockout:false,knockoutGaps:[],seniorityCompatibility:{materialMismatch:false}});f.db.prepare("INSERT INTO job_analysis(job_id,analysis_type,score,verdict,payload_json) VALUES (?,'RECRUITER',85,'STRONG MATCH',?)").run(f.jobId,payload);f.db.prepare("INSERT INTO job_analysis(job_id,analysis_type,score,verdict,payload_json) VALUES (?,'ATS_EXACT',80,NULL,'{}')").run(f.jobId);
 const first=await prepareJobAutomatically(f.db,f.jobId,{researchContacts:false}),firstId=first.steps.tailor.cvVersionId;const rebuilt=await prepareJobAutomatically(f.db,f.jobId,{force:true,researchContacts:false});
 assert.equal(rebuilt.status,'PREPARED_FOR_REVIEW');assert.ok(rebuilt.steps.tailor.cvVersionId>firstId);assert.equal(rebuilt.steps.tailor.materialChange.physicalRebuild,true);assert.notEqual(f.db.prepare('SELECT d.sha256 FROM cv_versions v JOIN cv_documents d ON d.id=v.document_id WHERE v.id=?').get(rebuilt.steps.tailor.cvVersionId).sha256,null);assert.equal(f.db.prepare("SELECT count(*) n FROM applications WHERE status='APPLIED'").get().n,0);f.db.close();
});

test('automatic preparation cannot force a knockout role into READY_TO_APPLY',async()=>{
 const f=baseFixture(),knockoutJd='Chief Investment Officer role. 10+ years of investment management experience required.';f.db.prepare("UPDATE jobs SET title='Chief Investment Officer',role_classification='ROLE_MATCH',role_family='INVESTMENT',location_confidence=100 WHERE id=?").run(f.jobId);f.db.prepare('UPDATE job_jd_versions SET jd_raw=?,jd_clean=?,jd_clean_hash=? WHERE job_id=?').run(knockoutJd,knockoutJd,sha(Buffer.from(knockoutJd)),f.jobId);const payload=JSON.stringify({clearKnockout:true,knockoutGaps:[{severity:'KNOCKOUT',text:'10+ years investment experience required'}],seniorityCompatibility:{materialMismatch:true}});f.db.prepare("INSERT INTO job_analysis(job_id,analysis_type,score,verdict,payload_json) VALUES (?,'RECRUITER',49,'DO NOT APPLY',?)").run(f.jobId,payload);f.db.prepare("INSERT INTO job_analysis(job_id,analysis_type,score,verdict,payload_json) VALUES (?,'ATS_EXACT',60,NULL,'{}')").run(f.jobId);const r=await prepareJobAutomatically(f.db,f.jobId,{force:true,researchContacts:false});assert.equal(r.status,'SKIPPED');assert.equal(r.reason,'KNOCKOUT_PRESENT');assert.equal(f.db.prepare('SELECT count(*) n FROM applications WHERE job_id=?').get(f.jobId).n,0);f.db.close();
});

test('preparation writers have no external send primitive',()=>{
 const src=fs.readFileSync(new URL('../src/services/packagePrep.mjs',import.meta.url),'utf8');assert.doesNotMatch(src,/\b(?:fetch|sendMail|nodemailer|smtp|execFile)\s*\(/i);
});

test('writing contracts retain the established USER CONFIRMATION REQUIRED marker',()=>{
 const roots=['skills','agents','src'].map(x=>path.join(repoRoot,x));const bad=[];for(const dir of roots)for(const file of walkText(dir)){const text=fs.readFileSync(file,'utf8');if(text.includes('USER_CONFIRMATION_REQUIRED'))bad.push(path.relative(repoRoot,file));}assert.deepEqual(bad,[]);
});

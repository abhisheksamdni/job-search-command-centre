import fs from 'node:fs';
import path from 'node:path';

const ELIGIBLE_VERDICTS=new Set(['STRONG MATCH','GOOD MATCH']);
const RISK_FIELDS=[
  {key:'workAuthorisation',label:'work authorisation',heading:'Work authorisation / sponsorship'},
  {key:'sponsorship',label:'sponsorship',heading:'Work authorisation / sponsorship'},
  {key:'salary',label:'salary',heading:'Salary expectations'},
  {key:'noticePeriod',label:'notice period',heading:'Notice period'},
  {key:'relocation',label:'relocation',heading:'Start date / relocation'},
  {key:'startDate',label:'start date',heading:'Start date / relocation'}
];

function safe(v=''){return String(v??'').trim();}
function parseJson(v,fallback={}){try{return JSON.parse(v||'{}')||fallback;}catch{return fallback;}}
function setting(db,key,fallback=''){try{return db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value??fallback;}catch{return fallback;}}
function latestAnalysis(db,jobId,type){const row=db.prepare('SELECT * FROM job_analysis WHERE job_id=? AND analysis_type=? ORDER BY id DESC LIMIT 1').get(jobId,type);return row?{...row,payload:parseJson(row.payload_json,{})}:null;}
function countWords(text=''){return safe(text).split(/\s+/).filter(Boolean).length;}
function readText(file){try{return fs.readFileSync(file,'utf8');}catch{return '';}}
function confirmedValue(node){
  if(!node||typeof node!=='object'||Array.isArray(node)||node.confirmed!==true||node.current!==true)return null;
  const v=node.value??node.answer??node.status;return safe(v)||null;
}
export function currentConfirmationFacts(db){
  const profile=db.prepare('SELECT * FROM candidate_profile WHERE id=1').get()||{};
  const auth=parseJson(profile.work_authorization_json,{}),prefs=parseJson(profile.preferences_json,{}),appFacts=(prefs.applicationFacts&&typeof prefs.applicationFacts==='object')?prefs.applicationFacts:{};
  const values={
    workAuthorisation:confirmedValue(auth.workAuthorisation)||confirmedValue(auth.workAuthorization),
    sponsorship:confirmedValue(auth.sponsorship),
    salary:confirmedValue(appFacts.salary),
    noticePeriod:confirmedValue(appFacts.noticePeriod),
    relocation:confirmedValue(appFacts.relocation),
    startDate:confirmedValue(appFacts.startDate)
  };
  return {values,unresolved:RISK_FIELDS.filter(x=>!values[x.key]).map(x=>({...x}))};
}
function childCv(db,jobId){return db.prepare(`SELECT v.*,d.original_filename,d.stored_path,d.sha256,d.extracted_text
  FROM cv_versions v JOIN cv_documents d ON d.id=v.document_id
  WHERE v.job_id=? AND v.is_master=0 ORDER BY v.id DESC LIMIT 1`).get(jobId);}
function cvById(db,id){return db.prepare(`SELECT v.*,d.original_filename,d.stored_path,d.sha256,d.extracted_text
  FROM cv_versions v JOIN cv_documents d ON d.id=v.document_id WHERE v.id=?`).get(id);}
function postTailorFor(db,jobId,cvVersionId){const row=db.prepare("SELECT * FROM job_analysis WHERE job_id=? AND cv_version_id=? AND analysis_type='POST_TAILOR' ORDER BY id DESC LIMIT 1").get(jobId,cvVersionId);return row?{...row,payload:parseJson(row.payload_json,{})}:null;}
function semanticTailoringPassed(payload={}){const quality=payload.tailoringQuality||payload.structuredChanges?.tailoringQuality||{};return payload.integrity==='PASS'&&payload.materialChange?.meaningful===true&&quality.passed===true&&quality.semanticChangePassed===true&&String(quality.version||'').startsWith('2.1.');}
function approvedNoChange(db,jobId){
  const approval=latestAnalysis(db,jobId,'NO_CHANGE_APPROVAL');if(!approval?.payload?.approved)return null;
  const candidateId=Number(approval.payload.candidateAnalysisId||0);
  const candidate=candidateId?db.prepare("SELECT * FROM job_analysis WHERE id=? AND job_id=? AND analysis_type='NO_CHANGE_CANDIDATE'").get(candidateId,jobId):null;
  const latest=db.prepare("SELECT id FROM job_analysis WHERE job_id=? AND analysis_type='NO_CHANGE_CANDIDATE' ORDER BY id DESC LIMIT 1").get(jobId);
  if(!candidate||Number(latest?.id||0)!==candidateId)return null;const payload=parseJson(candidate.payload_json,{});if(payload.integrity!=='PASS')return null;
  const cvVersionId=Number(approval.cv_version_id||candidate.cv_version_id||payload.cvVersionId||0);if(!cvVersionId)return null;
  const cv=cvById(db,cvVersionId);if(!cv)return null;
  return {approval,candidate:{...candidate,payload},cv};
}
export function applicationCvCandidate(db,jobId){
  const child=childCv(db,jobId);
  if(child){
    const post=postTailorFor(db,jobId,child.id);
    if(post&&semanticTailoringPassed(post.payload)){
      const stored=db.prepare('SELECT * FROM cv_version_files WHERE cv_version_id=? ORDER BY is_primary DESC,id').all(child.id),files=stored.length?stored:[{id:null,cv_version_id:child.id,format:'SOURCE',path:child.stored_path,sha256:child.sha256,mime_type:null,is_primary:1}];
      return {mode:'TAILORED',cvVersionId:child.id,cv:child,files,integrity:'PASS',materialChange:true,postTailor:post};
    }
  }
  const approved=approvedNoChange(db,jobId);
  if(approved){
    const stored=db.prepare('SELECT * FROM cv_version_files WHERE cv_version_id=? ORDER BY is_primary DESC,id').all(approved.cv.id),files=stored.length?stored:[{id:null,cv_version_id:approved.cv.id,format:'SOURCE',path:approved.cv.stored_path,sha256:approved.cv.sha256,mime_type:null,is_primary:1}];
    return {mode:'APPROVED_NO_CHANGE',cvVersionId:approved.cv.id,cv:approved.cv,files,integrity:'PASS',materialChange:false,noChangeApprovalId:approved.approval.id};
  }
  const pending=latestNoChangeCandidate(db,jobId);
  if(pending?.payload?.integrity==='PASS'){
    const cvVersionId=Number(pending.cv_version_id||pending.payload.cvVersionId||0),cv=cvById(db,cvVersionId);
    if(cv){const stored=db.prepare('SELECT * FROM cv_version_files WHERE cv_version_id=? ORDER BY is_primary DESC,id').all(cv.id),files=stored.length?stored:[{id:null,cv_version_id:cv.id,format:'SOURCE',path:cv.stored_path,sha256:cv.sha256,mime_type:null,is_primary:1}];return {mode:'NO_CHANGE_REVIEW',cvVersionId:cv.id,cv,files,integrity:'PASS',materialChange:false,noChangeCandidateId:pending.id};}
  }
  return null;
}
function latestNoChangeCandidate(db,jobId){return latestAnalysis(db,jobId,'NO_CHANGE_CANDIDATE');}
function cioTenureMismatch(job,jd){
  if(!/\b(?:chief investment officer|cio)\b/i.test(safe(job?.title)))return false;
  return /\b(?:10|ten)\s*\+?\s*(?:years?|yrs?)\b/i.test(safe(jd?.jd_clean));
}
function packageStatus(db,jobId,unresolved=[]){
  const app=db.prepare('SELECT * FROM applications WHERE job_id=?').get(jobId);
  if(!app?.application_folder)return {prepared:false,coverLetter:false,answers:false,confirmationVisible:false,folder:null};
  const coverPath=path.join(app.application_folder,'Cover-Letter','cover-letter.md'),answersPath=path.join(app.application_folder,'Application-Answers','answers.md');
  const cover=readText(coverPath),answers=readText(answersPath);
  const coverLetter=countWords(cover)>=120&&/Dear\s+(?:Hiring|Recruit)/i.test(cover)&&!/\[Company Name\]|placeholder/i.test(cover);
  const expected=['Why this role?','Why this company?','Relevant experience','Technical experience','Trading / investment experience'];
  const answersComplete=expected.every(h=>answers.includes(h));
  const marker='USER CONFIRMATION REQUIRED';
  const confirmationVisible=unresolved.length===0||unresolved.every(item=>{
    const i=answers.indexOf(`## ${item.heading}`);if(i<0)return false;const next=answers.indexOf('\n## ',i+4);const section=answers.slice(i,next<0?answers.length:next);return section.includes(marker);
  });
  return {prepared:coverLetter&&answersComplete,coverLetter,answers:answersComplete,confirmationVisible,folder:app.application_folder,coverWordCount:countWords(cover)};
}
export function evaluateReadyToApply(db,jobId){
  const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);if(!job)throw new Error('Job not found');
  const jd=db.prepare('SELECT * FROM job_jd_versions WHERE job_id=? ORDER BY id DESC LIMIT 1').get(jobId);
  const recruiter=latestAnalysis(db,jobId,'RECRUITER'),ats=latestAnalysis(db,jobId,'ATS_EXACT'),confirmations=currentConfirmationFacts(db),pkg=packageStatus(db,jobId,confirmations.unresolved),candidate=applicationCvCandidate(db,jobId),reasons=[],warnings=[],override=Boolean(job.application_override_at);
  const decision=(code,condition)=>{if(!condition)return;if(override)warnings.push(`OVERRIDDEN_${code}`);else reasons.push(code);};
  if(job.status==='NEEDS_VERIFICATION'||Number(job.location_confidence||0)<=0)reasons.push('LOCATION_UNVERIFIED');
  decision('ROLE_FAMILY_NOT_ACCEPTABLE',!['ROLE_MATCH','ROLE_RELATED'].includes(job.role_classification));
  if(!jd||jd.jd_quality==='POOR'||safe(jd.jd_clean).length<40)reasons.push('JD_NOT_USABLE');
  if(!recruiter)reasons.push('NO_RECRUITER_ANALYSIS');
  decision('KNOCKOUT_PRESENT',recruiter?.payload?.clearKnockout||recruiter?.payload?.knockoutGaps?.some(x=>String(x.severity||'').toUpperCase()==='KNOCKOUT'));
  decision('SENIORITY_MISMATCH',recruiter?.payload?.seniorityCompatibility?.materialMismatch);
  decision('CIO_TENURE_MISMATCH',cioTenureMismatch(job,jd));
  decision('RECRUITER_NOT_STRONG_OR_GOOD',recruiter&&!ELIGIBLE_VERDICTS.has(recruiter.verdict));
  if(!ats||ats.score==null)reasons.push('ATS_ANALYSIS_INCOMPLETE');
  const child=childCv(db,jobId),post=child?postTailorFor(db,jobId,child.id):null,noChangeCandidate=latestNoChangeCandidate(db,jobId);
  if(!candidate){
    if(child&&post?.payload?.integrity!=='PASS')reasons.push('INTEGRITY_NOT_PASS');
    if(child&&post?.payload?.integrity==='PASS'&&post?.payload?.tailoringQuality?.passed!==true)reasons.push('TAILORING_QUALITY_NOT_PASS');
    if(child&&post?.payload?.integrity==='PASS'&&post?.payload?.materialChange?.meaningful!==true)reasons.push('MATERIAL_CHANGE_REQUIRED');
    if(!child&&!noChangeCandidate)reasons.push('TAILORED_CV_MISSING');
    if(noChangeCandidate)reasons.push('NO_CHANGE_CV_UNAVAILABLE');
  }
  if(candidate?.mode==='NO_CHANGE_REVIEW')warnings.push('NO_MEANINGFUL_CHANGE_USES_MASTER');
  if(ats?.score!=null&&Number(ats.score)<40)warnings.push('LOW_ATS_ALIGNMENT');
  const packageRequired=setting(db,'application_package_required','1')!=='0';
  if(packageRequired&&!pkg.prepared)reasons.push('APPLICATION_PACKAGE_INCOMPLETE');
  if(packageRequired&&!pkg.confirmationVisible)reasons.push('CONFIRMATION_ITEMS_NOT_VISIBLE');
  return {ok:reasons.length===0,reasons:[...new Set(reasons)],warnings:[...new Set(warnings)],jobId,manualOverride:override?{approvedAt:job.application_override_at,actor:job.application_override_actor,reason:job.application_override_reason}:null,recruiterVerdict:recruiter?.verdict||null,recruiterScore:recruiter?.score??null,atsScore:ats?.score??null,applicationCv:candidate?{mode:candidate.mode,cvVersionId:candidate.cvVersionId,files:candidate.files,integrity:candidate.integrity,materialChange:candidate.materialChange,noChangeCandidateId:candidate.noChangeCandidateId||null}:null,package:pkg,packageRequired,unresolvedConfirmationItems:confirmations.unresolved.map(x=>x.label)};
}
export function assertReadyToApply(db,jobId){const gate=evaluateReadyToApply(db,jobId);if(!gate.ok)throw new Error(`READY_TO_APPLY blocked: ${gate.reasons.join(', ')}`);return gate;}
export function approveNoChange(db,jobId,{note=''}={}){
  const candidate=latestNoChangeCandidate(db,jobId);if(!candidate)throw new Error('No evidence-safe no-change candidate is awaiting approval');
  const payload=parseJson(candidate.payload_json,{});if(payload.integrity!=='PASS')throw new Error('No-change candidate integrity is not PASS');
  const cvVersionId=Number(candidate.cv_version_id||payload.cvVersionId||0);if(!cvVersionId)throw new Error('No-change candidate has no CV baseline');
  const existing=latestAnalysis(db,jobId,'NO_CHANGE_APPROVAL');if(existing?.payload?.approved&&Number(existing.payload.candidateAnalysisId)===candidate.id)return existing;
  const approvedAt=new Date().toISOString(),approval={approved:true,actor:'manual',approvedAt,note:safe(note),candidateAnalysisId:candidate.id,cvVersionId};
  const r=db.prepare("INSERT INTO job_analysis(job_id,cv_version_id,analysis_type,verdict,payload_json) VALUES (?,?,'NO_CHANGE_APPROVAL','APPROVED',?)").run(jobId,cvVersionId,JSON.stringify(approval));
  return {...db.prepare('SELECT * FROM job_analysis WHERE id=?').get(Number(r.lastInsertRowid)),payload:approval};
}

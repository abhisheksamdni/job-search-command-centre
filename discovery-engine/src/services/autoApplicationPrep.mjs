import fs from 'node:fs';
import { ensureApplication,transitionApplication } from './applicationTracker.mjs';
import { rematchJob,tailorJob,verifyTailoredVersion } from './jobWorkflow.mjs';
import { prepareApplicationPackage,prepareOutreach } from './packagePrep.mjs';
import { researchJobContacts } from './contactResearch.mjs';
import { safeJoin } from '../security.mjs';
import { syncApplicationKnowledge,syncJobKnowledge } from '../knowledgeVault.mjs';
import { evaluateReadyToApply } from './readyGate.mjs';

const ELIGIBLE=new Set(['STRONG MATCH','GOOD MATCH']);
const NON_BYPASSABLE=new Set(['LOCATION_UNVERIFIED','ROLE_FAMILY_NOT_ACCEPTABLE','JD_NOT_USABLE','KNOCKOUT_PRESENT','SENIORITY_MISMATCH']);
function latestAnalysis(db,jobId,type){const row=db.prepare('SELECT * FROM job_analysis WHERE job_id=? AND analysis_type=? ORDER BY id DESC LIMIT 1').get(jobId,type);if(!row)return null;return{...row,payload:JSON.parse(row.payload_json||'{}')};}
function latestRecruiter(db,jobId){return latestAnalysis(db,jobId,'RECRUITER');}
function appFor(db,jobId){return db.prepare('SELECT * FROM applications WHERE job_id=?').get(jobId);}
function existingTailored(db,jobId){return db.prepare('SELECT id,version_label,created_at FROM cv_versions WHERE job_id=? ORDER BY id DESC LIMIT 1').get(jobId);}
function setting(db,key,fallback=null){return db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value??fallback;}
function writeAutoPrepLog(app,result){if(!app?.application_folder)return;fs.writeFileSync(safeJoin(app.application_folder,'Analysis','auto-prep.md'),`# Automatic Application Preparation\n\n${JSON.stringify(result,null,2)}\n`,'utf8');}
function eligibility(db,job,recruiter){
 const reasons=[],override=Boolean(job.application_override_at);const jd=db.prepare('SELECT * FROM job_jd_versions WHERE job_id=? ORDER BY id DESC LIMIT 1').get(job.id),ats=latestAnalysis(db,job.id,'ATS_EXACT');
 if(job.status==='NEEDS_VERIFICATION'||Number(job.location_confidence||0)<=0)reasons.push('LOCATION_UNVERIFIED');
 if(!override&&!['ROLE_MATCH','ROLE_RELATED'].includes(job.role_classification))reasons.push('ROLE_FAMILY_NOT_ACCEPTABLE');
 if(!jd||jd.jd_quality==='POOR')reasons.push('JD_NOT_USABLE');
 if(!recruiter)reasons.push('NO_RECRUITER_ANALYSIS');
 if(!override&&(recruiter?.payload?.clearKnockout||recruiter?.payload?.knockoutGaps?.some(x=>x.severity==='KNOCKOUT')))reasons.push('KNOCKOUT_PRESENT');
 if(!override&&recruiter?.payload?.seniorityCompatibility?.materialMismatch)reasons.push('SENIORITY_MISMATCH');
 if(!override&&recruiter&&!ELIGIBLE.has(recruiter.verdict))reasons.push('VERDICT_NOT_ELIGIBLE');
 if(!ats)reasons.push('ATS_ANALYSIS_INCOMPLETE');
 return{ok:reasons.length===0,reasons,jd,ats,override};
}
function hardStop(gate){return gate.reasons.find(x=>NON_BYPASSABLE.has(x))||null;}
export async function prepareJobAutomatically(db,jobId,{force=false,researchContacts=true,prepareOutreachDraft=true,transitionReady=false,reuseExistingPackage=false}={}){
 const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);if(!job)throw new Error('Job not found');
 const preflight=eligibility(db,job,latestRecruiter(db,jobId)),preflightHard=preflight.reasons.find(x=>['LOCATION_UNVERIFIED','ROLE_FAMILY_NOT_ACCEPTABLE','JD_NOT_USABLE'].includes(x));
 if(preflightHard)return{status:'SKIPPED',reason:preflightHard,reasons:preflight.reasons,jobId};
 let refreshed;try{refreshed=rematchJob(db,jobId);}catch(e){return{status:'SKIPPED',reason:'ANALYSIS_REFRESH_FAILED',reasons:[e.message],jobId};}
 const recruiter=latestRecruiter(db,jobId),gate=eligibility(db,job,recruiter),hard=hardStop(gate);
 if(hard)return{status:'SKIPPED',reason:hard,reasons:gate.reasons,jobId};
 if(!force&&!gate.ok)return{status:'SKIPPED',reason:gate.reasons[0],reasons:gate.reasons,jobId};
 const current=appFor(db,jobId);if(current&&['APPLIED','FOLLOW_UP_DUE','INTERVIEW','ASSESSMENT','FINAL_STAGE','OFFER','REJECTED','WITHDRAWN','ARCHIVED'].includes(current.status))return{status:'SKIPPED',reason:`APPLICATION_${current.status}`,jobId};const prior=existingTailored(db,jobId);if(!force&&!reuseExistingPackage&&prior)return{status:'SKIPPED',reason:'PACKAGE_ALREADY_PREPARED',jobId,tailoredCvVersionId:prior.id};
 const app=ensureApplication(db,jobId),result={jobId,applicationId:app.id,status:'RUNNING',verdict:recruiter?.verdict||null,eligibility:gate.reasons,manualOverride:gate.override,steps:{matchRefresh:{ok:true,methodology:refreshed.recruiter?.recruiterIntelligenceRecord?.version||null,recruiter:refreshed.recruiter?.score??null,ats:refreshed.ats?.score??null}}};
 try{
  let cvVersionId;
  if(reuseExistingPackage&&prior){cvVersionId=prior.id;const verified=verifyTailoredVersion(db,jobId,cvVersionId);result.steps.tailor={ok:true,status:'REUSED_EXISTING_VERIFIED_CHILD',cvVersionId};result.steps.verify={ok:verified.integrity==='PASS'&&verified.tailoringQuality?.passed===true,integrity:verified.integrity,tailoringQuality:verified.tailoringQuality,recruiter:verified.recruiter.score,ats:verified.ats.score,unsupportedClaims:verified.unsupportedClaims};if(verified.integrity!=='PASS')throw new Error('Post-tailor integrity did not pass');if(verified.tailoringQuality?.passed!==true)throw new Error('Post-tailor quality did not pass');}
  else{const tailored=await tailorJob(db,jobId,{forcePhysicalRebuild:force});cvVersionId=tailored.tailoredCvVersionId||tailored.existingCvVersionId||null;result.steps.tailor={ok:true,status:tailored.status||'TAILORED',cvVersionId,integrity:tailored.integrity||'PASS',tailoringQuality:tailored.tailoringQuality||tailored.materialChange?.tailoringQuality||null,recruiter:tailored.afterRecruiter??tailored.recruiter?.score,ats:tailored.afterAts??tailored.ats?.score,templateSource:tailored.templateSource||null,templatePreserved:tailored.templatePreserved??null,pdfTemplatePreserved:tailored.pdfTemplatePreserved??null,warnings:tailored.warnings||[],materialChange:tailored.materialChange||null};if(tailored.status==='NO_MEANINGFUL_CHANGE'&&!cvVersionId){result.steps.verify={ok:true,integrity:'PASS',note:'Explicit evidence-safe no-change accepted; Master remains the application CV baseline.'};}else{if(!cvVersionId)throw new Error('Tailoring completed without a usable CV version');const verified=verifyTailoredVersion(db,jobId,cvVersionId);result.steps.verify={ok:verified.integrity==='PASS'&&verified.tailoringQuality?.passed===true,integrity:verified.integrity,tailoringQuality:verified.tailoringQuality,recruiter:verified.recruiter.score,ats:verified.ats.score,unsupportedClaims:verified.unsupportedClaims};if(verified.integrity!=='PASS')throw new Error('Post-tailor integrity did not pass');if(verified.tailoringQuality?.passed!==true)throw new Error('Post-tailor quality did not pass');}}
  const packageResult=prepareApplicationPackage(db,jobId,{coverLetter:true,answers:true,outreach:false});result.steps.applicationWriting={ok:true,artifacts:packageResult.artifacts,verification:packageResult.verification};if(!packageResult.artifacts.coverLetter||!packageResult.artifacts.applicationAnswers)throw new Error('Application writing package is incomplete');
  if(prepareOutreachDraft&&researchContacts&&setting(db,'auto_contact_research','1')==='1'){
   try{const contacts=await researchJobContacts(db,jobId,{limit:Number(setting(db,'contact_research_limit','6'))||6});result.steps.contactResearch={ok:true,status:contacts.status,count:contacts.candidates.filter(x=>x.personLike).length,errors:contacts.errors};const best=contacts.candidates.filter(x=>x.personLike&&x.storedContact).sort((a,b)=>b.confidence-a.confidence)[0];const outreach=best?.storedContact?.id?prepareOutreach(db,jobId,{contactId:best.storedContact.id}):prepareOutreach(db,jobId);result.steps.outreach={ok:true,contactId:best?.storedContact?.id||null,artifacts:outreach.artifacts,note:best?.storedContact?.id?null:'No confirmed public hiring contact; generic unsent draft created.'};}
   catch(e){result.steps.contactResearch={ok:false,error:e.message};const outreach=prepareOutreach(db,jobId);result.steps.outreach={ok:true,contactId:null,artifacts:outreach.artifacts,note:'Contact research unavailable; generic unsent draft created.'};}
  }else if(prepareOutreachDraft){const outreach=prepareOutreach(db,jobId);result.steps.outreach={ok:true,contactId:null,artifacts:outreach.artifacts,note:'Automatic contact research disabled.'};}
  const readyGate=evaluateReadyToApply(db,jobId);result.readyGate=readyGate;if(!readyGate.ok){if(readyGate.reasons.includes('NO_CHANGE_APPROVAL_REQUIRED')){result.status='AWAITING_USER_APPROVAL';result.applicationStatus=appFor(db,jobId)?.status||null;writeAutoPrepLog(appFor(db,jobId)||app,result);syncApplicationKnowledge(db,app.id);syncJobKnowledge(db,jobId);return result;}throw new Error(`READY_TO_APPLY blocked: ${readyGate.reasons.join(', ')}`);}
  let updated=appFor(db,jobId);if(transitionReady&&updated?.status==='SAVED')updated=transitionApplication(db,updated.id,'READY_TO_APPLY',{actor:'auto-prep',note:'Automatic evidence-grounded package prepared; hard readiness gate passed; manual review and submission required.'});result.status=transitionReady?'READY_FOR_MANUAL_REVIEW':'PREPARED_FOR_REVIEW';result.applicationStatus=updated?.status||null;writeAutoPrepLog(updated,result);syncApplicationKnowledge(db,app.id);syncJobKnowledge(db,jobId);return result;
 }catch(e){result.status='FAILED';result.error=e.message;writeAutoPrepLog(appFor(db,jobId)||app,result);syncApplicationKnowledge(db,app.id);syncJobKnowledge(db,jobId);return result;}
}
export function autoPrepEnabled(db){return setting(db,'auto_prepare_enabled','1')==='1';}
export async function prepareEligibleJobsAutomatically(db,{limit=50,researchContacts=true}={}){if(!autoPrepEnabled(db))return{enabled:false,attempted:0,prepared:0,failed:0,skipped:0,results:[]};const rows=db.prepare(`SELECT j.id FROM jobs j WHERE j.status NOT IN ('NEEDS_VERIFICATION','APPLIED','FOLLOW_UP_DUE','INTERVIEW','ASSESSMENT','FINAL_STAGE','OFFER','REJECTED','WITHDRAWN','ARCHIVED') AND j.role_classification IN ('ROLE_MATCH','ROLE_RELATED') AND j.location_confidence>0 AND EXISTS(SELECT 1 FROM job_jd_versions d WHERE d.job_id=j.id AND d.jd_quality!='POOR') AND NOT EXISTS(SELECT 1 FROM cv_versions v WHERE v.job_id=j.id) AND (SELECT a.verdict FROM job_analysis a WHERE a.job_id=j.id AND a.analysis_type='RECRUITER' ORDER BY a.id DESC LIMIT 1) IN ('STRONG MATCH','GOOD MATCH') ORDER BY COALESCE(j.employer_published_at,j.source_published_at,j.posted_at,j.first_seen_at) DESC LIMIT ?`).all(Math.max(1,Math.min(200,Number(limit)||50)));const results=[];for(const row of rows)results.push(await prepareJobAutomatically(db,row.id,{researchContacts,transitionReady:false}));return{enabled:true,attempted:results.length,prepared:results.filter(x=>x.status==='PREPARED_FOR_REVIEW').length,failed:results.filter(x=>x.status==='FAILED').length,skipped:results.filter(x=>x.status==='SKIPPED').length,results};}

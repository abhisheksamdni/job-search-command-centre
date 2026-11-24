import fs from 'node:fs';
import path from 'node:path';
import { ensureApplicationArchive,snapshotSubmittedCv,snapshotTextImmutable } from './applicationArchive.mjs';
import { syncApplicationKnowledge } from '../knowledgeVault.mjs';
import { assertReadyToApply } from './readyGate.mjs';

const ALLOWED={
  DISCOVERED:['REVIEW','SAVED','ARCHIVED'],REVIEW:['SAVED','READY_TO_APPLY','ARCHIVED'],SAVED:['READY_TO_APPLY','ARCHIVED'],
  READY_TO_APPLY:['APPLIED','ARCHIVED'],APPLIED:['FOLLOW_UP_DUE','INTERVIEW','ASSESSMENT','REJECTED','WITHDRAWN'],
  FOLLOW_UP_DUE:['INTERVIEW','ASSESSMENT','REJECTED','WITHDRAWN'],INTERVIEW:['ASSESSMENT','FINAL_STAGE','OFFER','REJECTED','WITHDRAWN'],
  ASSESSMENT:['INTERVIEW','FINAL_STAGE','OFFER','REJECTED','WITHDRAWN'],FINAL_STAGE:['OFFER','REJECTED','WITHDRAWN'],
  OFFER:['ARCHIVED'],REJECTED:['ARCHIVED'],WITHDRAWN:['ARCHIVED'],ARCHIVED:[]
};
const MANUAL_EVENTS=new Set(['ASSESSMENT_COMPLETED','REQUESTED_INFORMATION_SENT']);
export function canTransition(from,to){return(ALLOWED[from]||[]).includes(to);}
function parsePayload(v='{}'){try{return JSON.parse(v||'{}');}catch{return {};}}
function latestAnalysis(db,jobId,type){const r=db.prepare('SELECT * FROM job_analysis WHERE job_id=? AND analysis_type=? ORDER BY id DESC LIMIT 1').get(jobId,type);return r?{...r,payload:parsePayload(r.payload_json)}:null;}
function fileText(file){return fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';}
function relative(folder,file){return path.relative(folder,file).replace(/\\/g,'/');}
function documentRow(db,applicationId,kind,snapshot,cvVersionId=null){db.prepare('INSERT INTO application_documents(application_id,kind,path,sha256,cv_version_id,immutable) VALUES (?,?,?,?,?,1)').run(applicationId,kind,snapshot.path,snapshot.sha256,cvVersionId);}
function jsonSnapshot(value){return JSON.stringify(value,null,2)+'\n';}

export function ensureApplication(db,jobId){
  const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);if(!job)throw new Error('Job not found');
  let app=db.prepare('SELECT * FROM applications WHERE job_id=?').get(jobId);if(app){syncApplicationKnowledge(db,app.id);return app;}
  const jd=db.prepare('SELECT * FROM job_jd_versions WHERE job_id=? ORDER BY id DESC LIMIT 1').get(jobId);
  const folder=ensureApplicationArchive({job,jdRaw:jd?.jd_raw||'',jdClean:jd?.jd_clean||'',sourceUrl:job.source_url||''});
  db.prepare('INSERT INTO applications(job_id,status,application_folder) VALUES (?,?,?)').run(jobId,'SAVED',folder);app=db.prepare('SELECT * FROM applications WHERE job_id=?').get(jobId);db.prepare('INSERT INTO application_status_history(application_id,old_status,new_status,actor,note) VALUES (?,?,?,?,?)').run(app.id,null,'SAVED','manual','Application archive created');
  syncApplicationKnowledge(db,app.id);return app;
}

export function transitionApplication(db,appId,to,{actor='manual',note='',queueApproval=false}={}){
  const app=db.prepare('SELECT * FROM applications WHERE id=?').get(appId);if(!app)throw new Error('Application not found');
  if(to==='APPLIED')throw new Error('APPLIED can only be recorded through MARK APPLIED with the exact physical CV file');
  if(!canTransition(app.status,to))throw new Error('Invalid transition '+app.status+' -> '+to);
  if(to==='READY_TO_APPLY'){const queue=db.prepare('SELECT * FROM application_work_queue WHERE job_id=? ORDER BY queue_version DESC LIMIT 1').get(app.job_id);if(!queueApproval&&queue?.state!=='APPROVED')throw new Error('WORK_QUEUE_APPROVAL_REQUIRED');const gate=assertReadyToApply(db,app.job_id);if(gate.applicationCv?.mode==='NO_CHANGE_REVIEW')throw new Error('NO_CHANGE_REVIEW_APPROVAL_REQUIRED');}
  db.prepare('UPDATE applications SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(to,appId);
  db.prepare('UPDATE jobs SET status=? WHERE id=?').run(to,app.job_id);
  db.prepare('INSERT INTO application_status_history(application_id,old_status,new_status,actor,note) VALUES (?,?,?,?,?)').run(appId,app.status,to,actor,note);
  const updated=db.prepare('SELECT * FROM applications WHERE id=?').get(appId);syncApplicationKnowledge(db,appId);return updated;
}

export function recordApplicationEvent(db,applicationId,eventType,{note=''}={}){
  const type=String(eventType||'').toUpperCase();if(!MANUAL_EVENTS.has(type))throw new Error('Unsupported manually recorded application event');
  const app=db.prepare('SELECT * FROM applications WHERE id=?').get(applicationId);if(!app)throw new Error('Application not found');
  if(!app.applied_at)throw new Error('Application event requires a manually recorded submitted application');
  const payload={actor:'manual',recordedAt:new Date().toISOString(),note:String(note||'').trim()};
  const r=db.prepare("INSERT INTO audit_events(entity_type,entity_id,event_type,payload_json) VALUES ('application',?,?,?)").run(applicationId,type,JSON.stringify(payload));
  syncApplicationKnowledge(db,applicationId);return{id:Number(r.lastInsertRowid),applicationId,eventType:type,...payload};
}

export function completeInterview(db,interviewId,{note=''}={}){
  const row=db.prepare('SELECT * FROM interviews WHERE id=?').get(interviewId);if(!row)throw new Error('Interview not found');
  const app=db.prepare('SELECT * FROM applications WHERE id=?').get(row.application_id);if(!app?.applied_at)throw new Error('Interview completion requires a submitted application');
  if(String(row.status||'').toUpperCase()!=='COMPLETED')db.prepare("UPDATE interviews SET status='COMPLETED',notes=CASE WHEN ?='' THEN notes WHEN COALESCE(notes,'')='' THEN ? ELSE notes || char(10) || ? END WHERE id=?").run(String(note||'').trim(),String(note||'').trim(),String(note||'').trim(),interviewId);
  const payload={actor:'manual',recordedAt:new Date().toISOString(),interviewId:Number(interviewId),note:String(note||'').trim()};
  db.prepare("INSERT INTO audit_events(entity_type,entity_id,event_type,payload_json) VALUES ('application',?,'INTERVIEW_COMPLETED',?)").run(row.application_id,JSON.stringify(payload));
  syncApplicationKnowledge(db,row.application_id);return{...db.prepare('SELECT * FROM interviews WHERE id=?').get(interviewId),event:payload};
}

export function markApplied(db,{applicationId,cvVersionId,cvFileId=null,followupDays=7,note=''}){
  const app=db.prepare('SELECT * FROM applications WHERE id=?').get(applicationId);if(!app)throw new Error('Application not found');
  if(app.status!=='READY_TO_APPLY')throw new Error('Application must be READY_TO_APPLY before MARK APPLIED');
  const gate=assertReadyToApply(db,app.job_id);if(Number(gate.applicationCv?.cvVersionId)!==Number(cvVersionId))throw new Error('Selected CV version is not the READY_TO_APPLY application CV');
  const cv=db.prepare('SELECT v.*,d.stored_path,d.sha256 as source_hash,d.original_filename,d.mime_type FROM cv_versions v JOIN cv_documents d ON d.id=v.document_id WHERE v.id=?').get(cvVersionId);if(!cv)throw new Error('CV version not found');
  const files=db.prepare('SELECT * FROM cv_version_files WHERE cv_version_id=? ORDER BY is_primary DESC,id').all(cvVersionId);
  if(files.length&& !cvFileId)throw new Error('Confirm the exact physical CV file actually submitted');
  let selected=cvFileId?files.find(f=>f.id===Number(cvFileId)):files[0];
  if(cvFileId&&!selected)throw new Error('Selected CV file does not belong to the chosen CV version');
  if(!selected)selected={id:null,cv_version_id:cvVersionId,format:'SOURCE',path:cv.stored_path,sha256:cv.source_hash,mime_type:cv.mime_type,is_primary:1};
  if(!selected.path||!fs.existsSync(selected.path))throw new Error('Selected physical CV file does not exist');
  const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(app.job_id),jd=db.prepare('SELECT * FROM job_jd_versions WHERE job_id=? ORDER BY id DESC LIMIT 1').get(app.job_id),recruiter=latestAnalysis(db,app.job_id,'RECRUITER'),ats=latestAnalysis(db,app.job_id,'ATS_EXACT');
  if(!jd?.jd_clean||!recruiter||!ats)throw new Error('Submission archive requires JD, Recruiter and ATS analysis snapshots');
  const coverPath=path.join(app.application_folder,'Cover-Letter','cover-letter.md'),answersPath=path.join(app.application_folder,'Application-Answers','answers.md'),contactsPath=path.join(app.application_folder,'Contacts','contacts.md'),outreachPath=path.join(app.application_folder,'Outreach','messages.md');
  const cover=fileText(coverPath),answers=fileText(answersPath),outreach=fileText(outreachPath),contacts=db.prepare('SELECT c.* FROM contacts c JOIN job_contacts jc ON jc.contact_id=c.id WHERE jc.job_id=? ORDER BY c.id').all(app.job_id);
  if(!cover||!answers)throw new Error('Submission archive requires the prepared cover letter and application answers');
  const created=[];let cvSnap=null;db.exec('BEGIN');
  try{
    cvSnap=snapshotSubmittedCv({folder:app.application_folder,sourcePath:selected.path,expectedHash:selected.sha256});created.push(cvSnap.path,path.join(app.application_folder,'CV','submitted-cv.sha256'));
    const snapshots=[];
    const snap=(kind,rel,content)=>{const s=snapshotTextImmutable(app.application_folder,rel,content);created.push(s.path);snapshots.push({kind,s});return s;};
    const jdSnap=snap('SUBMITTED_JD','JD/jd-submitted-snapshot.md',jd.jd_clean);
    const coverSnap=snap('SUBMITTED_COVER_LETTER','Cover-Letter/submitted-cover-letter.md',cover);
    const answersSnap=snap('SUBMITTED_APPLICATION_ANSWERS','Application-Answers/submitted-answers.md',answers);
    const contactsSnap=snap('SUBMITTED_CONTACTS','Contacts/submitted-contacts.json',jsonSnapshot(contacts));
    const outreachSnap=snap('SUBMITTED_OUTREACH','Outreach/submitted-outreach.md',outreach||'# No outreach draft recorded before submission\n');
    const recruiterSnap=snap('SUBMITTED_RECRUITER_ANALYSIS','Analysis/submitted-recruiter.json',jsonSnapshot(recruiter));
    const atsSnap=snap('SUBMITTED_ATS_ANALYSIS','Analysis/submitted-ats.json',jsonSnapshot(ats));
    const appliedAt=new Date(),follow=new Date(appliedAt.getTime()+Math.max(1,Number(followupDays)||7)*86400000);
    db.prepare('UPDATE applications SET status=?,submitted_cv_version_id=?,applied_at=?,followup_due_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run('APPLIED',cvVersionId,appliedAt.toISOString(),follow.toISOString(),applicationId);
    db.prepare('UPDATE jobs SET status=? WHERE id=?').run('APPLIED',app.job_id);
    db.prepare('INSERT INTO application_status_history(application_id,old_status,new_status,actor,note) VALUES (?,?,?,?,?)').run(applicationId,app.status,'APPLIED','manual',String(note||'').trim()||'Submitted CV '+path.basename(selected.path));
    const history=db.prepare('SELECT * FROM application_status_history WHERE application_id=? ORDER BY id').all(applicationId);
    const historySnap=snap('SUBMITTED_HISTORY','Evidence/submitted-history.json',jsonSnapshot(history));
    const artifactRefs=[jdSnap,coverSnap,answersSnap,contactsSnap,outreachSnap,recruiterSnap,atsSnap,historySnap].map(s=>({path:relative(app.application_folder,s.path),sha256:s.sha256}));
    const manifest={applicationId,jobId:app.job_id,company:job.company,title:job.title,applicationUrl:job.application_url||job.canonical_job_url||job.source_url||'',submittedAt:appliedAt.toISOString(),cvVersionId,cvFileId:selected.id,sourceCvFile:path.basename(selected.path),submittedCv:{path:relative(app.application_folder,cvSnap.path),sha256:cvSnap.sha256,format:selected.format||path.extname(selected.path).slice(1).toUpperCase()},jdVersionId:jd.id,artifacts:artifactRefs};
    const manifestSnap=snap('SUBMISSION_MANIFEST','Evidence/submission-manifest.json',jsonSnapshot(manifest));
    documentRow(db,applicationId,'SUBMITTED_CV',cvSnap,cvVersionId);for(const row of snapshots)documentRow(db,applicationId,row.kind,row.s,row.kind==='SUBMITTED_CV'?cvVersionId:null);
    db.prepare('INSERT INTO followups(application_id,due_at,kind,status,notes) VALUES (?,?,?,?,?)').run(applicationId,follow.toISOString(),'APPLICATION','DUE','Initial post-application follow-up');
    db.exec('COMMIT');
    const appMd=path.join(app.application_folder,'00_APPLICATION.md');fs.writeFileSync(appMd,'# '+job.company+' — '+job.title+'\n\n- Job: JOB-'+String(job.id).padStart(6,'0')+'\n- Status: APPLIED\n- Applied On: '+appliedAt.toISOString()+'\n- Application URL: '+manifest.applicationUrl+'\n- CV Used: '+path.basename(cvSnap.path)+'\n- Source CV File: '+path.basename(selected.path)+'\n- CV Version ID: '+cvVersionId+'\n- SHA-256: '+cvSnap.sha256+'\n- JD Snapshot: JD/jd-submitted-snapshot.md\n- Submission Manifest: Evidence/submission-manifest.json\n','utf8');
    syncApplicationKnowledge(db,applicationId);
    return {...db.prepare('SELECT * FROM applications WHERE id=?').get(applicationId),submittedCv:cvSnap,selectedCvFile:selected,manifest:{...manifest,path:manifestSnap.path,sha256:manifestSnap.sha256},archivedKinds:['SUBMITTED_CV',...snapshots.map(x=>x.kind)]};
  }catch(e){
    try{db.exec('ROLLBACK');}catch{}
    for(const file of created)try{fs.rmSync(file,{force:true});}catch{}
    throw e;
  }
}

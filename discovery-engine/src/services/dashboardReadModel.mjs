import { visibleJobPredicate } from './jobVisibility.mjs';

function n(row){return Number(row?.n||0)}
function activeMaster(db){return db.prepare(`SELECT v.id,v.version_label,v.is_master,v.is_active,d.original_filename FROM cv_versions v JOIN cv_documents d ON d.id=v.document_id WHERE v.is_master=1 AND v.is_active=1 ORDER BY v.id DESC LIMIT 1`).get()||null;}
function sourceSummary(db){
 const rows=db.prepare('SELECT enabled,health FROM sources').all();const out={total:rows.length,enabled:0,healthy:0,degraded:0,rateLimited:0,manual:0,disabled:0,untested:0};
 for(const r of rows){if(!r.enabled){out.disabled++;continue;}out.enabled++;const h=String(r.health||'UNTESTED').toUpperCase();if(h==='HEALTHY')out.healthy++;else if(h==='RATE_LIMITED')out.rateLimited++;else if(h==='MANUAL_ONLY')out.manual++;else if(h==='UNTESTED')out.untested++;else out.degraded++;}
 return out;
}
function parseRun(row){if(!row)return null;let stats={};try{stats=JSON.parse(row.stats_json||'{}')}catch{}return {...row,stats};}
export function dashboardReadModel(db,scheduler=null){
 const total=n(db.prepare('SELECT count(*) n FROM jobs').get()),visible=visibleJobPredicate('j');
 const archived=n(db.prepare("SELECT count(*) n FROM jobs WHERE status='ARCHIVED'").get());
 const active=n(db.prepare(`SELECT count(*) n FROM jobs j WHERE j.status!='ARCHIVED' AND ${visible}`).get());
 const hiddenByRole=n(db.prepare(`SELECT count(*) n FROM jobs j WHERE j.status!='ARCHIVED' AND NOT ${visible}`).get());
 const recent=n(db.prepare(`SELECT count(*) n FROM jobs j WHERE j.status!='ARCHIVED' AND ${visible} AND datetime(COALESCE(j.employer_published_at,j.source_published_at,j.posted_at,j.first_seen_at))>=datetime('now','-96 hours')`).get());
 const older=Math.max(0,active-recent);
 const latestVerdictCount=verdict=>n(db.prepare(`SELECT count(*) n FROM jobs j WHERE j.status!='ARCHIVED' AND ${visible} AND (SELECT a.verdict FROM job_analysis a WHERE a.job_id=j.id AND a.analysis_type='RECRUITER' ORDER BY a.id DESC LIMIT 1)=?`).get(verdict));
 const strong=latestVerdictCount('STRONG MATCH');
 const good=latestVerdictCount('GOOD MATCH');
 const queued=n(db.prepare("SELECT count(*) n FROM application_work_queue WHERE state IN ('QUEUED','PROCESSING','READY_FOR_REVIEW','NEEDS_CONFIRMATION','BLOCKED','FAILED')").get());
 const ready=n(db.prepare(`SELECT count(*) n FROM applications a WHERE a.status='READY_TO_APPLY' AND EXISTS (SELECT 1 FROM application_work_queue q WHERE q.application_id=a.id AND q.state='APPROVED' AND q.approved_cv_version_id IS NOT NULL AND q.approved_jd_hash IS NOT NULL)`).get());
 const applied=n(db.prepare(`SELECT count(*) n FROM applications WHERE status='APPLIED'`).get());
 const applications=n(db.prepare(`SELECT count(*) n FROM applications`).get());
 const followups=n(db.prepare(`SELECT count(*) n FROM followups WHERE status='DUE'`).get());
 const interviews=n(db.prepare(`SELECT count(*) n FROM interviews WHERE status='SCHEDULED'`).get());
 const master=activeMaster(db);const lastRun=parseRun(db.prepare('SELECT * FROM discovery_runs ORDER BY id DESC LIMIT 1').get()||null);const searchWindowHours=n(db.prepare("SELECT CAST(value AS INTEGER) n FROM settings WHERE key='search_window_hours'").get())||96;
 return {version:'2.0.0-alpha.4',jobs:active,activeJobs:active,archived,totalStored:total,hiddenByRole,newJobs:recent,activeOlderThan96Hours:older,strong,good,queued,ready,applications,applied,followups,interviews,searchWindowHours,activeCv:master?{present:true,versionId:master.id,versionLabel:master.version_label,filename:master.original_filename,isMaster:Boolean(master.is_master)}:{present:false,versionId:null,versionLabel:null,filename:null,isMaster:false},sources:sourceSummary(db),lastRun,scheduler:scheduler?.state?scheduler.state():null};
}
export function sourceManagerRows(db){return db.prepare(`SELECT s.*, (SELECT count(*) FROM job_source_sightings x WHERE x.source_id=s.id) jobs_seen FROM sources s ORDER BY CASE ownership WHEN 'SYSTEM' THEN 0 WHEN 'USER_ADDED' THEN 1 ELSE 2 END,name`).all();}
export { sourceSummary };

import fs from 'node:fs';
import path from 'node:path';
import { dashboardReadModel,sourceManagerRows } from './services/dashboardReadModel.mjs';
import { upsertTargetLocation,setTargetLocationEnabled,listTargetLocations } from './services/targetLocations.mjs';
import { onboardSource } from './services/sourceOnboarding.mjs';
import { prepareApplicationPackage,prepareOutreach,prepareFollowup,prepareInterview } from './services/packagePrep.mjs';
import { researchJobContacts } from './services/contactResearch.mjs';
import { localWriterStatus } from './services/localWritingEngine.mjs';
import { discoveryHistory,discoveryRunDetail } from './services/discoveryReadModel.mjs';
import { readRuntimeLog,logRuntimeEvent } from './services/runtimeLogger.mjs';
import { recleanStoredJob } from './services/jdCleaner.mjs';
import { extractRequirements } from './services/requirements.mjs';
import { rematchJob } from './services/jobWorkflow.mjs';
import { activeMasterTemplate,setMasterTemplate } from './services/cvLibrary.mjs';
import { jevStatus } from './services/jevClassifier.mjs';
export async function handleAlpha4Api({req,res,url,db,scheduler,json,bodyJson}){
 const p=url.pathname;let m;
 if(req.method==='GET'&&p==='/api/dashboard-v2'){json(res,200,dashboardReadModel(db,scheduler));return true;}
 if(req.method==='GET'&&p==='/api/source-manager'){json(res,200,sourceManagerRows(db));return true;}
 if(req.method==='GET'&&p==='/api/locations'){json(res,200,listTargetLocations(db));return true;}
 if(req.method==='POST'&&p==='/api/locations'){json(res,201,upsertTargetLocation(db,await bodyJson(req)));return true;}
 if((m=p.match(/^\/api\/locations\/(\d+)$/))&&req.method==='PATCH'){const x=await bodyJson(req);json(res,200,setTargetLocationEnabled(db,m[1],x.enabled));return true;}
 if(req.method==='GET'&&p==='/api/sources'){json(res,200,sourceManagerRows(db));return true;}
 if(req.method==='POST'&&p==='/api/sources'){const x=await bodyJson(req);json(res,201,onboardSource(db,{name:x.name,baseUrl:x.baseUrl,company:x.company||x.name,kind:x.kind||'AUTO'}));return true;}
 if((m=p.match(/^\/api\/sources\/(\d+)$/))&&req.method==='PATCH'){const x=await bodyJson(req);db.prepare('UPDATE sources SET enabled=? WHERE id=?').run(x.enabled?1:0,Number(m[1]));json(res,200,db.prepare('SELECT * FROM sources WHERE id=?').get(Number(m[1])));return true;}
 if(req.method==='GET'&&p==='/api/writing/local-status'){json(res,200,await localWriterStatus(db));return true;}
 if(req.method==='GET'&&p==='/api/jev/status'){json(res,200,jevStatus(db));return true;}
 if(req.method==='POST'&&p==='/api/jev/settings'){const x=await bodyJson(req);db.prepare(`INSERT INTO settings(key,value) VALUES ('jev_enabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).run(x.enabled?'1':'0');json(res,200,jevStatus(db));return true;}
 if((m=p.match(/^\/api\/jobs\/(\d+)\/prepare-package$/))&&req.method==='POST'){json(res,201,prepareApplicationPackage(db,Number(m[1]),await bodyJson(req)));return true;}
 if((m=p.match(/^\/api\/jobs\/(\d+)\/research-contacts$/))&&req.method==='POST'){json(res,200,await researchJobContacts(db,Number(m[1]),await bodyJson(req)));return true;}
 if((m=p.match(/^\/api\/jobs\/(\d+)\/outreach$/))&&req.method==='POST'){json(res,201,prepareOutreach(db,Number(m[1]),await bodyJson(req)));return true;}
 if((m=p.match(/^\/api\/applications\/(\d+)\/follow-up-draft$/))&&req.method==='POST'){json(res,201,prepareFollowup(db,Number(m[1]),await bodyJson(req)));return true;}
 if((m=p.match(/^\/api\/jobs\/(\d+)\/interview-prep$/))&&req.method==='POST'){json(res,201,prepareInterview(db,Number(m[1])));return true;}
 if((m=p.match(/^\/api\/jobs\/(\d+)\/reclean-jd$/))&&req.method==='POST'){
   const jobId=Number(m[1]),cleaned=recleanStoredJob(db,jobId);const reqs=extractRequirements(cleaned.jdClean);db.prepare('DELETE FROM requirements WHERE job_id=?').run(jobId);const ins=db.prepare('INSERT INTO requirements(job_id,category,text) VALUES (?,?,?)');for(const r of reqs)ins.run(jobId,r.category,r.cleanText||r.text);let analysis=null;try{analysis=rematchJob(db,jobId);}catch{}json(res,200,{...cleaned,requirements:reqs.length,analysis});return true;
 }
 if(req.method==='GET'&&p==='/api/cv/template'){const x=activeMasterTemplate(db);json(res,200,{template:x?{id:x.id,versionLabel:x.version_label,filename:x.original_filename,sha256:x.sha256,path:x.stored_path}:null});return true;}
 if(req.method==='POST'&&p==='/api/cv/template'){const x=await bodyJson(req);const row=setMasterTemplate(db,Number(x.cvVersionId));json(res,200,{id:row.id,versionLabel:row.version_label,filename:row.original_filename});return true;}
 if((m=p.match(/^\/api\/cv\/files\/(\d+)$/))&&req.method==='GET'){
   const f=db.prepare('SELECT * FROM cv_version_files WHERE id=?').get(Number(m[1]));if(!f||!fs.existsSync(f.path)){json(res,404,{error:'CV file not found'});return true;}const ext=path.extname(f.path).toLowerCase(),type=ext==='.pdf'?'application/pdf':ext==='.docx'?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'text/plain';res.writeHead(200,{'content-type':type,'content-disposition':`inline; filename="${path.basename(f.path)}"`,'x-content-type-options':'nosniff'});fs.createReadStream(f.path).pipe(res);return true;
 }
 if(req.method==='POST'&&p==='/api/discovery/run'){const preflight=scheduler.preflight('MANUAL');if(!preflight.ok){json(res,400,{error:preflight.errors[0],preflight});return true;}const task=scheduler.trigger('MANUAL',{preflight});task.catch(e=>logRuntimeEvent('DISCOVERY_FAILED',{mode:'MANUAL',error:e.message}));json(res,202,{status:'STARTED',preflight,state:scheduler.state()});return true;}
 if(req.method==='GET'&&p==='/api/discovery/state'){json(res,200,scheduler.state());return true;}
 if(req.method==='POST'&&p==='/api/discovery/cancel'){json(res,200,{cancelRequested:scheduler.cancel(),state:scheduler.state()});return true;}
 if((m=p.match(/^\/api\/discovery\/runs\/(\d+)$/))&&req.method==='GET'){const detail=discoveryRunDetail(db,Number(m[1]));if(!detail){json(res,404,{error:'Discovery run not found'});return true;}json(res,200,detail);return true;}
 if(req.method==='GET'&&p==='/api/discovery/runs'){json(res,200,discoveryHistory(db,Number(url.searchParams.get('limit')||50)));return true;}
 if(req.method==='GET'&&p==='/api/contacts'){json(res,200,db.prepare('SELECT * FROM contacts ORDER BY id DESC').all());return true;}
 if(req.method==='GET'&&p==='/api/applications'){json(res,200,db.prepare(`SELECT a.*,j.company,j.title,j.location_raw,j.role_classification FROM applications a JOIN jobs j ON j.id=a.job_id ORDER BY COALESCE(a.applied_at,a.updated_at,a.created_at) DESC,a.id DESC`).all());return true;}
 if(req.method==='GET'&&p==='/api/followups'){json(res,200,db.prepare('SELECT * FROM followups ORDER BY due_at').all());return true;}
 if(req.method==='GET'&&p==='/api/interviews'){json(res,200,db.prepare('SELECT * FROM interviews ORDER BY scheduled_at').all());return true;}
 if(req.method==='GET'&&p==='/api/system/logs'){json(res,200,{file:'jcc.log',lines:readRuntimeLog(Number(url.searchParams.get('limit')||400))});return true;}
 if(req.method==='GET'&&p==='/api/system/diagnostics'){const integrity=db.prepare('PRAGMA integrity_check').all();json(res,200,{database:integrity,version:'2.0.0-alpha.4'});return true;}
 if(req.method==='GET'&&p==='/api/system/backups'){json(res,200,{backups:[]});return true;}
 if(req.method==='POST'&&p==='/api/system/backup'){json(res,501,{error:'Use backup command for local filesystem snapshot'});return true;}
 return false;
}

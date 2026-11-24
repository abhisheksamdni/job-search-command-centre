import { onboardSource, canonicalSourceKey } from './sourceOnboarding.mjs';
import { logRuntimeEvent } from './runtimeLogger.mjs';

const SYSTEM_SOURCES=[
 ['eFinancialCareers','https://www.efinancialcareers.com/jobs/search','AUTO'],
 ['LinkedIn Jobs','https://www.linkedin.com/jobs/','AUTO'],
 ['Indeed','https://www.indeed.com/','AUTO']
];
const HEALTH=new Set(['HEALTHY','DEGRADED','RATE_LIMITED','MANUAL_ONLY','UNTESTED']);
function auditSeedError(db,name,error){
 const message=String(error?.message||error||'unknown source seed error').slice(0,500);
 try{db.prepare("INSERT INTO audit_events(entity_type,entity_id,event_type,payload_json) VALUES ('source',NULL,'SOURCE_SEED_ERROR',?)").run(JSON.stringify({name,error:message}));}catch{}
 console.error(`[systemSources] Failed to seed ${name}: ${message}`);logRuntimeEvent('SOURCE_SEED_FAILED',{sourceName:name,error:message});
}
export function verifySystemSources(db){
 const rows=db.prepare("SELECT * FROM sources WHERE ownership='SYSTEM' ORDER BY name").all();const expected=new Set(SYSTEM_SOURCES.map(x=>x[0]));
 const missing=[...expected].filter(name=>!rows.some(r=>r.name===name));const invalid=[];
 for(const r of rows){if(!r.canonical_key)invalid.push({name:r.name,reason:'missing canonical_key'});if(!HEALTH.has(String(r.health||'').toUpperCase()))invalid.push({name:r.name,reason:`invalid health ${r.health}`});if(r.enabled!==0&&r.enabled!==1)invalid.push({name:r.name,reason:'invalid enabled state'});}
 return {ok:missing.length===0&&invalid.length===0,missing,invalid,sources:rows};
}
export function seedSystemSources(db,{onboard=onboardSource}={}){
 for(const [name,baseUrl,kind] of SYSTEM_SOURCES){
   try{
     const existing=db.prepare('SELECT * FROM sources WHERE name=? LIMIT 1').get(name);
     if(existing&&existing.base_url!==baseUrl){db.prepare('UPDATE sources SET base_url=?,canonical_key=NULL WHERE id=?').run(baseUrl,existing.id);}
     onboard(db,{name,baseUrl,company:name,kind,ownership:'SYSTEM',provenance:{seed:'alpha4'}});
   }catch(e){auditSeedError(db,name,e);}
 }
 const check=verifySystemSources(db);for(const miss of check.missing)auditSeedError(db,miss,new Error('Expected SYSTEM source is missing after seed'));for(const item of check.invalid)auditSeedError(db,item.name,new Error(item.reason));
 return db.prepare("SELECT * FROM sources WHERE ownership='SYSTEM' ORDER BY name").all();
}
export { SYSTEM_SOURCES };

import fs from 'node:fs';
import { execFile } from 'node:child_process';

function setting(db,key,fallback=''){return db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value||fallback;}
export function jevStatus(db){const configured=setting(db,'jev_path',process.platform==='win32'?'D:\\Tools\\Jev\\jev.cmd':'');return {enabled:setting(db,'jev_enabled','0')==='1',path:configured,available:Boolean(configured&&fs.existsSync(configured))};}
function parseResult(stdout=''){const text=String(stdout).trim();if(!text)return null;try{return JSON.parse(text)}catch{const m=text.match(/\{[\s\S]*\}/);if(m)try{return JSON.parse(m[0])}catch{}return {decision:/\b(?:hydrate|relevant|yes)\b/i.test(text)?'HYDRATE':'REJECT',raw:text.slice(0,2000)};}}
export function classifyWithJev(db,candidate,{timeoutMs=15000}={}){
  const status=jevStatus(db);if(!status.enabled||!status.available)return Promise.resolve({used:false,available:status.available,decision:'SKIP',reason:status.enabled?'JEV_UNAVAILABLE':'JEV_DISABLED'});
  const question='Is this post-filtered adjacent finance job relevant enough to justify full job-description hydration? Return JSON with decision HYDRATE or REJECT and a short reason.';
  const request={state:{jobId:candidate.id||null,company:candidate.company||'',title:candidate.title||'',location:candidate.location||'',roleClassification:candidate.roleClassification||'ROLE_RELATED',targetRole:candidate.targetRole||null},questions:[question]};
  return new Promise(resolve=>{const child=execFile(status.path,[],{timeout:timeoutMs,windowsHide:true,maxBuffer:1024*1024},(error,stdout,stderr)=>{if(error)return resolve({used:true,available:true,decision:'HYDRATE',question,error:String(error.message||stderr||'Jev failed'),fallback:true});const parsed=parseResult(stdout);const decision=String(parsed?.decision||parsed?.answer||'').toUpperCase()==='REJECT'?'REJECT':'HYDRATE';resolve({used:true,available:true,decision,question,result:parsed});});child.stdin.end(JSON.stringify(request));});
}

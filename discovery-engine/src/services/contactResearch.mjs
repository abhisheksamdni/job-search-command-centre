import fs from 'node:fs';
import path from 'node:path';
import { searchWithAgentReach } from '../../adapters/agentReachProvider.mjs';

function stripAnsi(s=''){return String(s).replace(/\x1b\[[0-9;]*m/g,'');}
function publicHttp(url=''){try{const u=new URL(url);return['http:','https:'].includes(u.protocol)?u.toString():'';}catch{return'';}}
function flatten(node,out=[]){
  if(node==null)return out;if(Array.isArray(node)){for(const x of node)flatten(x,out);return out;}
  if(typeof node==='object'){const url=publicHttp(node.url||node.link||node.href||''),title=String(node.title||node.name||'').trim(),text=String(node.text||node.snippet||node.description||node.content||'').trim();if(url&&(title||text))out.push({url,title,text});for(const v of Object.values(node))if(v&&typeof v==='object')flatten(v,out);}
  return out;
}
export function parseAgentReachSearchResults(raw=''){
  const text=stripAnsi(raw);let structured=[];try{structured=flatten(JSON.parse(text));}catch{}
  const links=[],md=/\[([^\]\n]{2,180})\]\((https?:\/\/[^)\s]+)\)/g;let m;while((m=md.exec(text)))links.push({title:m[1].trim(),url:m[2],text:''});
  const seen=new Set();return[...structured,...links].filter(x=>{x.url=publicHttp(x.url);if(!x.url||seen.has(x.url))return false;seen.add(x.url);return true;});
}
function cleanTitle(title=''){return String(title).replace(/\s+/g,' ').replace(/\s*[|–—]\s*LinkedIn.*$/i,'').trim();}
function relationshipFor(role=''){if(/recruit|talent acquisition/i.test(role))return'POTENTIAL_RECRUITER';if(/hiring manager/i.test(role))return'POTENTIAL_HIRING_MANAGER';if(/head of|team lead|desk lead|portfolio manager|trading manager/i.test(role))return'POTENTIAL_TEAM_LEAD';return'POTENTIAL_REFERRAL_CONTACT';}
export function inferPublicContact(result,company=''){
  const title=cleanTitle(result.title),parts=title.split(/\s+(?:-|–|—|\|)\s+/).map(x=>x.trim()).filter(Boolean),name=parts[0]||'';let role=parts.slice(1).join(' — ');
  if(!role){const source=(result.title||'')+' '+(result.text||''),match=source.match(/\b(?:recruiter|talent acquisition[^,.|;]{0,60}|head of [^,.|;]{2,60}|hiring manager|portfolio manager|trading manager|desk lead[^,.|;]{0,40}|team lead[^,.|;]{0,40})\b/i);if(match)role=match[0];}
  const words=name.split(/\s+/).filter(Boolean),personLike=words.length>=2&&words.length<=6&&!/\b(?:jobs?|careers?|company|team|hiring|recruitment|recruiter|talent|trader|analyst|manager|linkedin|vacanc(?:y|ies))\b/i.test(name),hay=((result.title||'')+' '+(result.text||'')).toLowerCase();let confidence=/linkedin\.com\/in\//i.test(result.url)?0.62:0.42;
  if(company&&hay.includes(String(company).toLowerCase()))confidence+=0.18;if(role)confidence+=0.08;if(!personLike)confidence=Math.min(confidence,0.35);
  return{name,role,company,linkedinUrl:/linkedin\.com\/in\//i.test(result.url)?result.url:'',sourceUrl:result.url,confidence:Math.min(.95,Number(confidence.toFixed(2))),personLike,confirmationState:'UNCONFIRMED_PUBLIC',relationship:relationshipFor(role),email:''};
}
function upsertContact(db,jobId,c,discovery){
  if(!c.personLike||!c.name)return null;let existing=c.linkedinUrl?db.prepare('SELECT * FROM contacts WHERE linkedin_url=? LIMIT 1').get(c.linkedinUrl):null;
  const notes={sourceUrl:c.sourceUrl,linkedinUrl:c.linkedinUrl||null,confidence:c.confidence,discovery,confirmationState:'UNCONFIRMED_PUBLIC',confirmed:false,relationship:c.relationship};
  if(!existing){const r=db.prepare('INSERT INTO contacts(name,company,role,email,linkedin_url,relationship,notes) VALUES (?,?,?,?,?,?,?)').run(c.name,c.company||'',c.role||'','',c.linkedinUrl||'','AUTO_DISCOVERED_UNCONFIRMED',JSON.stringify(notes));existing=db.prepare('SELECT * FROM contacts WHERE id=?').get(Number(r.lastInsertRowid));}
  db.prepare('INSERT OR IGNORE INTO job_contacts(job_id,contact_id) VALUES (?,?)').run(jobId,existing.id);return existing;
}
function archiveContacts(db,jobId){
  const app=db.prepare('SELECT * FROM applications WHERE job_id=?').get(jobId);if(!app?.application_folder)return;
  const rows=db.prepare('SELECT c.* FROM contacts c JOIN job_contacts jc ON jc.contact_id=c.id WHERE jc.job_id=? ORDER BY c.id').all(jobId),file=path.join(app.application_folder,'Contacts','contacts.md');
  const body=['# Contacts','',...rows.map(c=>{let n={};try{n=JSON.parse(c.notes||'{}');}catch{}return '- '+c.name+' — '+(c.role||'role unconfirmed')+' — '+(n.confirmationState||'USER_RECORDED')+' — '+(n.sourceUrl||c.linkedin_url||'source recorded manually');})].join('\n')+'\n';fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,body,'utf8');
}
async function runProvider(provider,queries,limit,label,all,errors){
  if(typeof provider!=='function')return;for(const q of queries){try{const raw=await provider(q,{numResults:Math.max(3,Math.ceil(limit/2))});all.push(...parseAgentReachSearchResults(raw).map(x=>({...x,provider:label})));}catch(e){errors.push(label+': '+e.message);break;}}
}
export async function researchJobContacts(db,jobId,{limit=8,publicSearchProvider=null,searchProvider=searchWithAgentReach}={}){
  const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);if(!job)throw new Error('Job not found');
  const queries=[
    '"'+job.company+'" "'+job.title+'" recruiter',
    '"'+job.company+'" "'+job.title+'" "talent acquisition"',
    '"'+job.company+'" "'+job.title+'" "hiring manager"',
    '"'+job.company+'" "'+job.title+'" "team lead"',
    '"'+job.company+'" "head of" "'+(job.role_family||job.title)+'"',
    '"'+job.company+'" "'+job.title+'" LinkedIn'
  ],all=[],errors=[];
  await runProvider(publicSearchProvider,queries,limit,'PUBLIC_WEB',all,errors);
  if(all.length<limit)await runProvider(searchProvider,queries,limit,'AGENT_REACH_PUBLIC_SEARCH',all,errors);
  const seen=new Set(),candidates=[];for(const r of all){const c=inferPublicContact(r,job.company),key=c.linkedinUrl||c.sourceUrl;if(!key||seen.has(key))continue;seen.add(key);c.sourceProvider=r.provider;c.storedContact=upsertContact(db,jobId,c,r.provider);candidates.push(c);if(candidates.length>=limit)break;}
  archiveContacts(db,jobId);const people=candidates.filter(c=>c.personLike);
  return{jobId,provider:publicSearchProvider?'PUBLIC_WEB_WITH_AGENT_REACH_FALLBACK':'AGENT_REACH_OPTIONAL',agentReachOptional:true,status:people.length?'UNCONFIRMED_CANDIDATES':'NO_CONFIRMED_CONTACT',candidates,errors,fallback:people.length?'MANUAL_CONFIRMATION_REQUIRED':'MANUAL_ONLY'};
}

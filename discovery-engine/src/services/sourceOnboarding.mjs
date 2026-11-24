import { syncSourceKnowledge } from '../knowledgeVault.mjs';
import { detectAdapter } from '../discovery/registry.mjs';
import { detectGreenhouse } from '../../adapters/greenhouse.mjs';
import { detectAshby } from '../../adapters/ashby.mjs';
import { detectLever } from '../../adapters/lever.mjs';
import { detectWorkday } from '../../adapters/workday.mjs';
import { detectPublicAts } from '../../adapters/publicAts.mjs';

function safeUrl(s){try{return new URL(s)}catch{return null}}
function compact(v=''){return String(v||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}

const OWNERSHIP_RANK={AUTO_DISCOVERED:1,USER_ADDED:2,SYSTEM:3};
function mergedOwnership(current='AUTO_DISCOVERED',incoming='AUTO_DISCOVERED'){return (OWNERSHIP_RANK[incoming]||0)>(OWNERSHIP_RANK[current]||0)?incoming:current;}
function mergeProvenance(current='{}',incoming={}){let a={};try{a=JSON.parse(current||'{}')||{}}catch{}return {...a,...(incoming||{})};}
function recipeFor(adapter,baseUrl,name,company){
  const meta={company:company||name,adapter};
  if(adapter==='greenhouse')Object.assign(meta,detectGreenhouse(baseUrl)||{});
  if(adapter==='ashby')Object.assign(meta,detectAshby(baseUrl)||{});
  if(adapter==='lever')Object.assign(meta,detectLever(baseUrl)||{});
  if(adapter==='workday')Object.assign(meta,detectWorkday(baseUrl)||{});
  const pub=detectPublicAts(baseUrl);if(pub)Object.assign(meta,pub);
  return meta;
}
export function canonicalSourceKey(baseUrl='',adapter=null){
  const a=adapter||detectAdapter(baseUrl);const gh=detectGreenhouse(baseUrl),ash=detectAshby(baseUrl),lev=detectLever(baseUrl),wd=detectWorkday(baseUrl),pub=detectPublicAts(baseUrl);
  if(gh)return `greenhouse|${compact(gh.board)}`;
  if(ash)return `ashby|${compact(ash.board)}`;
  if(lev)return `lever|${compact(lev.site)}`;
  if(wd)return `workday|${compact(wd.tenant)}|${compact(wd.site)}`;
  if(pub)return `${compact(pub.adapter)}|${compact(pub.account||safeUrl(baseUrl)?.hostname)}`;
  const u=safeUrl(baseUrl);if(!u)return `${compact(a||'source')}|${compact(baseUrl)}`;
  return `${compact(a||'web')}|${u.hostname.toLowerCase()}|${u.pathname.replace(/\/+$/,'').toLowerCase()||'/'}`;
}
export function onboardSource(db,{name,baseUrl,company=null,kind='AUTO',ownership='USER_ADDED',provenance={}}){
  if(!name||!baseUrl)throw new Error('name and baseUrl required');if(!safeUrl(baseUrl))throw new Error('baseUrl must be a valid public URL');
  const adapter=detectAdapter(baseUrl,kind);const meta=recipeFor(adapter,baseUrl,name,company);const direct=['greenhouse','ashby','lever','rss','smartrecruiters','recruitee','personio','breezy'];
  const recipeValidated=direct.includes(adapter)||(adapter==='workday'&&Boolean(meta.apiUrl));const status=recipeValidated?'READY':'DEGRADED';const key=canonicalSourceKey(baseUrl,adapter);
  let source=db.prepare('SELECT * FROM sources WHERE canonical_key=? OR (canonical_key IS NULL AND name=?) LIMIT 1').get(key,name);
  if(source){const owner=mergedOwnership(source.ownership,ownership),keepExistingLabel=(source.ownership==='SYSTEM'||source.ownership==='USER_ADDED')&&ownership==='AUTO_DISCOVERED';const mergedProv=mergeProvenance(source.provenance_json,provenance);db.prepare(`UPDATE sources SET name=?,kind=?,base_url=?,metadata_json=?,health=CASE WHEN upper(coalesce(health,'')) IN ('READY','UNKNOWN','') THEN 'UNTESTED' ELSE health END,ownership=?,adapter=?,canonical_key=?,provenance_json=?,last_checked=CURRENT_TIMESTAMP WHERE id=?`).run(keepExistingLabel?source.name:name,kind,baseUrl,JSON.stringify(meta),owner,adapter,key,JSON.stringify(mergedProv),source.id);}
  else{const r=db.prepare(`INSERT INTO sources(name,kind,base_url,health,metadata_json,ownership,adapter,canonical_key,provenance_json,last_checked) VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)`).run(name,kind,baseUrl,'UNTESTED',JSON.stringify(meta),ownership,adapter,key,JSON.stringify(provenance||{}));source={id:Number(r.lastInsertRowid)};}
  source=db.prepare('SELECT * FROM sources WHERE id=?').get(source.id);
  const domain=new URL(baseUrl).hostname;db.prepare(`INSERT INTO source_recipes(source_id,domain,adapter,recipe_json,status) VALUES (?,?,?,?,?) ON CONFLICT(source_id,domain) DO UPDATE SET adapter=excluded.adapter,recipe_json=excluded.recipe_json,status=excluded.status,updated_at=CURRENT_TIMESTAMP`).run(source.id,domain,adapter,JSON.stringify(meta),status);
  syncSourceKnowledge(db,source.id);return {sourceId:source.id,adapter,status,recipe:meta,canonicalKey:key,ownership};
}
export function autoOnboardSourceFromJob(db,job,parentSource=null){
  const candidates=[job.applicationUrl,job.sourceUrl].filter(Boolean);for(const url of candidates){const adapter=detectAdapter(url);if(adapter==='playwright'&&!detectPublicAts(url))continue;const u=safeUrl(url);if(!u)continue;const company=job.company||parentSource?.name||u.hostname;try{return onboardSource(db,{name:`${company} Careers`,company,baseUrl:url,kind:'AUTO',ownership:'AUTO_DISCOVERED',provenance:{sourceId:parentSource?.id||null,sourceName:parentSource?.name||null,jobExternalId:job.externalId||null,seenUrl:url}});}catch{}}
  return null;
}

function localeSegment(s=''){return /^[a-z]{2}(?:-[a-z]{2})?$/i.test(s);}

export function detectWorkday(url=''){
  let u;try{u=new URL(url);}catch{return null;}
  const host=u.hostname.toLowerCase();let tenant=null,site=null,locale='';
  if(/\.myworkdayjobs\.com$/.test(host)){
    tenant=u.hostname.split('.')[0];const seg=u.pathname.split('/').filter(Boolean).map(decodeURIComponent);let i=0;
    if(localeSegment(seg[0])){locale=seg[0];i++;}site=seg[i]||null;
    if(site==='wday'&&seg[i+1]==='cxs'){tenant=seg[i+2]||tenant;site=seg[i+3]||null;locale='';}
  }else if(/\.myworkdaysite\.com$/.test(host)){
    const seg=u.pathname.split('/').filter(Boolean).map(decodeURIComponent);const idx=seg.findIndex(x=>x.toLowerCase()==='recruiting');
    if(idx>=0){tenant=seg[idx+1]||null;site=seg[idx+2]||null;if(idx>0&&localeSegment(seg[idx-1]))locale=seg[idx-1];}
  }else return null;
  if(!tenant||!site||['job','jobs'].includes(site.toLowerCase()))return null;
  const origin=u.origin;const apiBase=`${origin}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}`;
  const boardBase=/\.myworkdayjobs\.com$/.test(host)
    ?`${origin}/${locale?`${locale}/`:''}${site}`
    :`${origin}/${locale?`${locale}/`:''}recruiting/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}`;
  return {tenant,site,locale,origin,boardBase,apiBase,apiUrl:`${apiBase}/jobs`};
}

function absoluteJobUrl(recipe,externalPath=''){const p=String(externalPath||'');if(/^https?:\/\//i.test(p))return p;return `${recipe.boardBase}${p.startsWith('/')?'':'/'}${p}`;}
function detailUrl(recipe,externalPath=''){const p=String(externalPath||'');if(!p)return null;const pathOnly=(()=>{try{return new URL(p,recipe.origin).pathname;}catch{return p;}})();return `${recipe.apiBase}${pathOnly.startsWith('/')?'':'/'}${pathOnly}`;}
function detailInfo(json={}){return json.jobPostingInfo||json;}
function detailLocation(info={},fallback=''){const locs=[];if(info.location)locs.push(info.location);if(info.locationName)locs.push(info.locationName);if(Array.isArray(info.additionalLocations))for(const x of info.additionalLocations)locs.push(typeof x==='string'?x:x?.displayName||x?.name||'');if(info.country)locs.push(info.country);return [...new Set(locs.filter(Boolean))].join(', ')||fallback;}

export async function fetchWorkdayDetail({recipe,externalPath,jobUrl,company='',fallback={},fetchImpl=fetch}){
  if(!recipe){const d=detectWorkday(jobUrl||'');if(!d)throw new Error('Workday detail requires a validated board/job URL');recipe=d;}
  let pathValue=externalPath;
  if(!pathValue&&jobUrl){const u=new URL(jobUrl);const boardPath=new URL(recipe.boardBase).pathname.replace(/\/$/,'');pathValue=u.pathname.startsWith(boardPath)?u.pathname.slice(boardPath.length):u.pathname;}
  const url=detailUrl(recipe,pathValue);if(!url)throw new Error('Workday detail path unavailable');
  const r=await fetchImpl(url,{headers:{accept:'application/json','accept-language':'en-US,en;q=0.9'}});if(!r.ok)throw new Error(`Workday detail HTTP ${r.status}`);const info=detailInfo(await r.json());
  return {...fallback,externalId:String(info.jobReqId||fallback.externalId||''),company,title:info.title||fallback.title||'',location:detailLocation(info,fallback.location||''),sourceUrl:jobUrl||absoluteJobUrl(recipe,pathValue),applicationUrl:jobUrl||absoluteJobUrl(recipe,pathValue),jdRaw:String(info.jobDescription||info.description||fallback.jdRaw||''),employerPublishedAt:info.postedOn||fallback.employerPublishedAt||null,postedAt:info.postedOn||fallback.postedAt||null,postingDateConfidence:(info.postedOn||fallback.employerPublishedAt)?'EMPLOYER_REPORTED':(fallback.postingDateConfidence||'UNVERIFIED'),workdayDetailUrl:url};
}

export async function scanWorkday({apiUrl,boardUrl,tenant,site,company,limit=20,includeDetails=false,maxDetails=50,searchText='',fetchImpl=fetch}){
  const recipe=boardUrl?detectWorkday(boardUrl):null;if(!apiUrl&&recipe)apiUrl=recipe.apiUrl;if(!apiUrl)throw new Error('Workday adapter requires a validated CXS apiUrl or Workday boardUrl source recipe');
  if(limit>20||limit<1)limit=20;
  const resolvedRecipe=recipe||(()=>{try{const u=new URL(apiUrl);const m=u.pathname.match(/^\/wday\/cxs\/([^/]+)\/([^/]+)\/jobs\/?$/);if(!m)return null;const t=tenant||decodeURIComponent(m[1]);const s=site||decodeURIComponent(m[2]);const base=`${u.origin}/wday/cxs/${encodeURIComponent(t)}/${encodeURIComponent(s)}`;return {tenant:t,site:s,origin:u.origin,locale:'',apiBase:base,apiUrl,boardBase:`${u.origin}/${s}`};}catch{return null;}})();
  let offset=0,total=null,pagesInspected=0;const out=[];
  while(true){const r=await fetchImpl(apiUrl,{method:'POST',headers:{'content-type':'application/json','accept':'application/json','accept-language':'en-US,en;q=0.9'},body:JSON.stringify({appliedFacets:{},limit,offset,searchText:String(searchText||'')})});pagesInspected++;if(!r.ok)throw new Error(`Workday HTTP ${r.status}`);const j=await r.json();const postings=j.jobPostings||[];if(total===null&&Number.isFinite(Number(j.total)))total=Number(j.total);for(const x of postings){const sourceUrl=resolvedRecipe?absoluteJobUrl(resolvedRecipe,x.externalPath||''):new URL(x.externalPath||'',apiUrl).toString();out.push({externalId:String(x.bulletFields?.find(v=>/\d/.test(String(v)))||x.externalPath||''),company,title:x.title||'',location:x.locationsText||'',sourceUrl,applicationUrl:sourceUrl,jdRaw:'',employerPublishedAt:x.postedOn||null,postedAt:x.postedOn||null,postingDateConfidence:x.postedOn?'EMPLOYER_REPORTED':'UNVERIFIED',workdayExternalPath:x.externalPath||'',workdayRecipe:resolvedRecipe});}offset+=postings.length;if(!postings.length||(total!==null&&offset>=total)||postings.length<limit)break;}
  if(includeDetails&&resolvedRecipe){for(const job of out.slice(0,maxDetails)){try{Object.assign(job,await fetchWorkdayDetail({recipe:resolvedRecipe,externalPath:job.workdayExternalPath,jobUrl:job.sourceUrl,company,fallback:job,fetchImpl}));}catch{}}}
  Object.defineProperty(out,'scanStats',{value:{pagesInspected,itemsInspected:out.length,totalReported:total},enumerable:false});return out;
}

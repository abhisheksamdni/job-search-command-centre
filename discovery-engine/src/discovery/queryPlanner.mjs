function text(v){return String(v||'').trim();}
function enabled(xs){return (xs||[]).filter(x=>x.enabled!==0);}
function hostOf(url=''){try{return new URL(url).hostname.toLowerCase().replace(/^www\./,'');}catch{return '';}}
function unique(xs){return [...new Set(xs.filter(Boolean))];}

export function broadRoleQuery(roles=[]){
  const byFamily=new Map();
  for(const r of enabled(roles)){
    const phrase=text(r.phrase);if(!phrase)continue;
    const family=text(r.family)||'OTHER';const arr=byFamily.get(family)||[];
    if(arr.length<3&&!arr.includes(phrase))arr.push(phrase);byFamily.set(family,arr);
  }
  const selected=[...byFamily.values()].flat().slice(0,8);
  if(!selected.length)return '';
  return selected.map(x=>/\s/.test(x)?`"${x.replaceAll('"','')}"`:x).join(' OR ');
}
function locationLabel(l){return text(l.display_label||[l.city,l.region,l.country_name||l.country].filter(Boolean).join(', '));}
function countryLabel(l){return text(l.country_name||l.country||l.country_code);}
function directAdapter(adapter){return ['greenhouse','ashby','lever','workday','rss','sitemap','smartrecruiters','recruitee','personio','breezy','public-ats'].includes(adapter);}
function locationScopes(locations=[]){
  const rows=enabled(locations);const grouped=new Map();
  for(const l of rows){const code=text(l.country_code).toUpperCase();const country=countryLabel(l);const key=code||country.toLowerCase()||locationLabel(l).toLowerCase();const arr=grouped.get(key)||[];arr.push(l);grouped.set(key,arr);}
  const out=[];
  for(const arr of grouped.values()){
    const first=arr[0];const country=countryLabel(first)||null;const countryCode=text(first.country_code).toUpperCase()||null;
    const label=arr.length>1&&country?country:(locationLabel(first)||country||countryCode||null);
    if(label)out.push({location:label,country,countryCode,confidence:'QUERY_SCOPE_ONLY'});
  }
  return out;
}
function scopedPlan(source,kind,url,keyword,scope){return {url,kind,role:keyword||null,location:scope?.location||null,country:scope?.country||null,countryCode:scope?.countryCode||null,searchScopeLocation:scope?.location||null,searchScopeCountry:scope?.country||scope?.countryCode||null,searchScopeSource:source.name||source.baseUrl||source.base_url||null,searchScopeConfidence:scope?.confidence||null};}
function linkedinPlans(source,keyword,locations){const scopes=locationScopes(locations);const out=[];for(const scope of (scopes.length?scopes:[null])){const u=new URL('https://www.linkedin.com/jobs/search/');if(keyword)u.searchParams.set('keywords',keyword);if(scope?.location)u.searchParams.set('location',scope.location);u.searchParams.set('f_TPR','r604800');out.push(scopedPlan(source,'LINKEDIN_SEARCH',u.toString(),keyword,scope));}return out;}
function indeedPlans(source,keyword,locations){const scopes=locationScopes(locations);const out=[];for(const scope of (scopes.length?scopes:[null])){const u=new URL('https://www.indeed.com/jobs');if(keyword)u.searchParams.set('q',keyword);if(scope?.location)u.searchParams.set('l',scope.location);out.push(scopedPlan(source,'INDEED_SEARCH',u.toString(),keyword,scope));}return out;}
function efcPlans(source,keyword,locations){const scopes=[];const seen=new Set();for(const l of enabled(locations)){const countryCode=text(l.country_code).toUpperCase();if(!countryCode||seen.has(countryCode))continue;seen.add(countryCode);scopes.push({location:countryCode,country:countryLabel(l)||countryCode,countryCode,confidence:'QUERY_SCOPE_ONLY'});}const out=[];for(const scope of (scopes.length?scopes:[null])){const u=new URL('https://www.efinancialcareers.com/jobs/search');if(keyword)u.searchParams.set('q',keyword);if(scope?.countryCode)u.searchParams.set('countryCode',scope.countryCode);u.searchParams.set('pageSize','30');u.searchParams.set('language','en');out.push(scopedPlan(source,'EFC_SEARCH',u.toString(),keyword,scope));}return out;}

export function planSourceQueries(source,roles=[],locations=[]){
  const base=text(source.baseUrl||source.base_url);if(!base)return [];
  const adapter=text(source.adapter).toLowerCase();if(directAdapter(adapter))return [{url:base,kind:'DIRECT',role:adapter==='workday'?broadRoleQuery(roles):null,location:null,country:null,countryCode:null,searchScopeLocation:null,searchScopeCountry:null,searchScopeSource:source.name||base,searchScopeConfidence:null}];
  const host=hostOf(base);const keyword=broadRoleQuery(roles);
  if(host==='linkedin.com')return linkedinPlans(source,keyword,locations);
  if(host==='indeed.com'||host.endsWith('.indeed.com'))return indeedPlans(source,keyword,locations);
  if(host==='efinancialcareers.com'||host.endsWith('.efinancialcareers.com'))return efcPlans(source,keyword,locations);
  return [{url:base,kind:'BASE',role:keyword||null,location:null,country:null,countryCode:null,searchScopeLocation:null,searchScopeCountry:null,searchScopeSource:source.name||base,searchScopeConfidence:null}];
}

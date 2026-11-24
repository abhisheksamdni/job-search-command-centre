const clean=s=>String(s||'').trim();
const html=s=>clean(s).replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ');
export function detectPublicAts(input=''){
 let u;try{u=new URL(input)}catch{return null}const h=u.hostname.toLowerCase(),p=u.pathname.split('/').filter(Boolean);
 if(h.includes('smartrecruiters.com'))return {adapter:'smartrecruiters',account:p[0]||null,apiUrl:p[0]?`https://api.smartrecruiters.com/v1/companies/${p[0]}/postings`:null};
 if(h.includes('recruitee.com'))return {adapter:'recruitee',account:h.split('.')[0],apiUrl:`https://${h}/api/offers/`};
 if(h.includes('personio.'))return {adapter:'personio',account:h.split('.')[0],apiUrl:`${u.origin}/xml`};
 if(h.includes('breezy.hr'))return {adapter:'breezy',account:p[0]||h.split('.')[0],apiUrl:u.origin+u.pathname};
 return null;
}
function normalize(x,company=''){return {externalId:String(x.id||x.uuid||x.slug||x.shortcode||x.job_id||''),company:x.company?.name||x.company||company,title:x.name||x.title||x.position||'',location:x.location?.city||x.location?.name||x.location||'',sourceUrl:x.ref||x.url||x.careers_url||x.absolute_url||'',applicationUrl:x.apply_url||x.url||x.careers_url||x.absolute_url||'',jdRaw:html(x.jobAd?.sections?.jobDescription?.text||x.description||x.descriptionHtml||x.content||''),employerPublishedAt:x.releasedDate||x.published_at||x.created_at||null};}
export async function scanPublicAts({url,company='',fetchImpl=fetch}){const d=detectPublicAts(url);if(!d)throw new Error('Unsupported public ATS');const endpoint=d.apiUrl||url;const r=await fetchImpl(endpoint,{headers:{accept:'application/json, text/xml, application/xml;q=0.9'}});if(!r.ok)throw new Error(`Public ATS HTTP ${r.status}`);const type=r.headers?.get?.('content-type')||'';if(type.includes('json')){const j=await r.json();const rows=j.content||j.offers||j.jobs||j.results||j;return (Array.isArray(rows)?rows:[]).map(x=>normalize(x,company)).filter(x=>x.title);}const txt=await r.text();const jobs=[...txt.matchAll(/<(?:position|job)>[\s\S]*?<name>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/name>[\s\S]*?<\/[^>]+>/gi)].map((m,i)=>({externalId:String(i),company,title:html(m[1]),location:'',sourceUrl:url,applicationUrl:url,jdRaw:''}));return jobs;}
export async function fetchPublicAtsDetail({url,company='',fallback={},fetchImpl=fetch}){const jobs=await scanPublicAts({url,company,fetchImpl});return jobs.find(j=>j.externalId&&j.externalId===fallback.externalId)||jobs.find(j=>j.title===fallback.title)||fallback;}

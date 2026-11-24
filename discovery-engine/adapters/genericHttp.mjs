import { parseJobPostingJsonLdStrings, filterJobLinks, selectBestJdText } from './genericPlaywright.mjs';
import { parseSystemRadarHtml, systemRadarKind } from './systemRadars.mjs';

function decodeEntities(s=''){return String(s).replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)));}
function stripTags(s=''){return decodeEntities(String(s).replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<br\s*\/?>/gi,'\n').replace(/<\/(?:p|li|h\d|div|section|article)>/gi,'\n').replace(/<[^>]+>/g,' ')).replace(/[ \t]+/g,' ').replace(/\n\s+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();}
function attr(tag,name){return tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`,'i'))?.[1]||'';}
function detailLocation(html=''){const source=String(html);for(const rx of [/<[^>]+data-(?:testid|automation-id)=["'][^"']*location[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i,/<[^>]+class=["'][^"']*location[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i]){const m=source.match(rx);const x=stripTags(m?.[1]||'').trim();if(x&&x.length<240)return x;}return '';}

export function parsePublicHtmlJobs(html='',baseUrl='',company=''){
  const scripts=[...String(html).matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);
  const structured=parseJobPostingJsonLdStrings(scripts,baseUrl,company);if(structured.length)return structured;
  const radar=parseSystemRadarHtml(html,baseUrl,company);if(radar.length)return radar;
  if(systemRadarKind(baseUrl))return [];
  const links=[];for(const m of String(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)){const href=attr(m[1],'href');if(!href)continue;links.push({title:stripTags(m[2]),sourceUrl:href});}
  return filterJobLinks(links,baseUrl).map(x=>({...x,company}));
}

export async function scanGenericHttp({url,company='',fetchImpl=fetch,timeoutMs=15000}){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),Math.max(1,timeoutMs));
  try{const r=await fetchImpl(url,{signal:controller.signal,headers:{accept:'text/html,application/xhtml+xml','user-agent':'JCC-Local/2.0'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);const type=r.headers?.get?.('content-type')||'';if(type&&!/html|text/i.test(type))throw new Error(`Unsupported content type ${type}`);return parsePublicHtmlJobs(await r.text(),r.url||url,company);}finally{clearTimeout(timer);}
}

export function parsePublicJobDetailHtml(html='',url='',company='',fallbackTitle=''){
  const scripts=[...String(html).matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]);
  const structured=parseJobPostingJsonLdStrings(scripts,url,company);if(structured.length)return structured[0];
  const title=stripTags((String(html).match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)||[])[1]||fallbackTitle);const candidates=[];
  for(const rx of [/<main\b[^>]*>([\s\S]*?)<\/main>/i,/<article\b[^>]*>([\s\S]*?)<\/article>/i,/<body\b[^>]*>([\s\S]*?)<\/body>/i]){const m=String(html).match(rx);if(m)candidates.push(stripTags(m[1]));}
  const location=detailLocation(html);return {title:title||fallbackTitle,company,location,locationStatus:location?'LOCATION_INFERRED_FROM_DETAIL':'LOCATION_UNVERIFIED',sourceUrl:url,applicationUrl:url,jdRaw:selectBestJdText(candidates)};
}

export async function fetchGenericHttpDetail({url,company='',title='',fetchImpl=fetch,timeoutMs=15000}){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),Math.max(1,timeoutMs));
  try{const r=await fetchImpl(url,{signal:controller.signal,headers:{accept:'text/html,application/xhtml+xml','user-agent':'JCC-Local/2.0'}});if(!r.ok)throw new Error(`HTTP detail ${r.status}`);return parsePublicJobDetailHtml(await r.text(),r.url||url,company,title);}finally{clearTimeout(timer);}
}

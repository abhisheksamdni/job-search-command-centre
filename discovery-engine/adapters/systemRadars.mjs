function hostOf(url=''){try{return new URL(url).hostname.toLowerCase().replace(/^www\./,'');}catch{return '';}}
function clean(v=''){return String(v||'').replace(/\s+/g,' ').trim();}
function decode(v=''){return clean(String(v||'').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/<[^>]+>/g,' '));}
function attr(tag='',name=''){return String(tag).match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`,'i'))?.[1]||'';}
function absolute(href='',baseUrl=''){try{return new URL(href,baseUrl).toString().replace(/#.*$/,'');}catch{return '';}}
function classText(block='',needle=''){const rx=new RegExp(`<[^>]+class=["'][^"']*${needle}[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`,'i');return decode(block.match(rx)?.[1]||'');}
function dataText(block='',name=''){const rx=new RegExp(`<[^>]+data-testid=["'][^"']*${name}[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`,'i');return decode(block.match(rx)?.[1]||'');}
function timeValue(block=''){const m=String(block).match(/<time\b([^>]*)>([\s\S]*?)<\/time>/i);return m?(attr(m[1],'datetime')||decode(m[2])):null;}

export function systemRadarKind(url=''){
  const host=hostOf(url);
  if(host==='linkedin.com'||host.endsWith('.linkedin.com'))return 'LINKEDIN';
  if(host==='indeed.com'||host.endsWith('.indeed.com'))return 'INDEED';
  if(host==='efinancialcareers.com'||host.endsWith('.efinancialcareers.com'))return 'EFC';
  return null;
}

function normalizeCard(card={},baseUrl='',fallbackCompany=''){
  const sourceUrl=absolute(card.url||card.sourceUrl||'',baseUrl);const title=clean(card.title);if(!title||!sourceUrl)return null;
  const location=clean(card.location);const company=clean(card.company)||clean(fallbackCompany);const posted=clean(card.postedAt||card.sourcePublishedAt)||null;
  return {externalId:clean(card.externalId)||'',title,company,location,locationStatus:location?'LOCATION_VERIFIED':'LOCATION_UNVERIFIED',sourceUrl,applicationUrl:sourceUrl,sourcePublishedAt:posted,postedAt:posted,postingDateConfidence:posted?'SOURCE_REPORTED':'UNVERIFIED',jdRaw:''};
}

function blocks(html='',kind=''){
  const source=String(html||'');const out=[];let rx;
  if(kind==='LINKEDIN')rx=/<(?:li|div)\b[^>]*(?:base-search-card|job-search-card|data-entity-urn=["'][^"']*jobPosting)[^>]*>[\s\S]*?<\/(?:li|div)>/gi;
  else if(kind==='INDEED')rx=/<(?:div|li)\b[^>]*(?:data-jk=|job_seen_beacon|cardOutline)[^>]*>[\s\S]*?<\/(?:div|li)>/gi;
  else if(kind==='EFC')rx=/<(?:article|li|div)\b[^>]*(?:data-testid=["'][^"']*job|job-card|jobCard)[^>]*>[\s\S]*?<\/(?:article|li|div)>/gi;
  if(rx)for(const m of source.matchAll(rx))out.push(m[0]);
  return out;
}

export function parseSystemRadarHtml(html='',baseUrl='',fallbackCompany=''){
  const kind=systemRadarKind(baseUrl);if(!kind)return [];
  const candidates=blocks(html,kind);const jobs=[];const seen=new Set();
  for(const block of candidates){
    let anchor=null,title='',company='',location='',externalId='';
    if(kind==='LINKEDIN'){
      const m=block.match(/<a\b([^>]*href=["'][^"']*\/jobs\/view\/[^"']*["'][^>]*)>([\s\S]*?)<\/a>/i);anchor=m?{tag:m[1],body:m[2],href:attr(m[1],'href')}:null;
      title=classText(block,'base-search-card__title')||decode(anchor?.body||'');company=classText(block,'base-search-card__subtitle');location=classText(block,'job-search-card__location');externalId=(block.match(/data-entity-urn=["'][^"']*jobPosting:([0-9A-Za-z_-]+)/i)||[])[1]||'';
    }else if(kind==='INDEED'){
      const m=block.match(/<a\b([^>]*href=["'][^"']*(?:\/viewjob|\/rc\/clk|jk=)[^"']*["'][^>]*)>([\s\S]*?)<\/a>/i);anchor=m?{tag:m[1],body:m[2],href:attr(m[1],'href')}:null;
      title=attr(anchor?.tag||'','aria-label')||attr(anchor?.tag||'','title')||decode(anchor?.body||'');company=dataText(block,'company-name')||classText(block,'companyName');location=dataText(block,'text-location')||classText(block,'companyLocation');externalId=attr(block.match(/<[^>]+data-jk=["'][^"']+["'][^>]*>/i)?.[0]||'','data-jk')||'';
    }else{
      const m=block.match(/<a\b([^>]*href=["'][^"']*\/jobs?\/[^"']+["'][^>]*)>([\s\S]*?)<\/a>/i);anchor=m?{tag:m[1],body:m[2],href:attr(m[1],'href')}:null;
      title=classText(block,'title')||decode(anchor?.body||'');company=classText(block,'company')||classText(block,'employer');location=classText(block,'location');const idTag=block.match(/<[^>]+data-(?:job-)?id=["'][^"']+["'][^>]*>/i)?.[0]||'';externalId=attr(idTag,'data-job-id')||attr(idTag,'data-id')||'';
    }
    const normalized=normalizeCard({url:anchor?.href,title,company,location,externalId,postedAt:timeValue(block)},baseUrl,fallbackCompany);if(!normalized||seen.has(normalized.sourceUrl))continue;seen.add(normalized.sourceUrl);jobs.push(normalized);
  }
  return jobs;
}

export async function extractSystemRadarCardsFromPage(page,url='',fallbackCompany=''){
  const kind=systemRadarKind(url);if(!kind)return [];
  const records=await page.evaluate(({kind})=>{
    const first=(node,selectors)=>{for(const s of selectors){const x=node.querySelector(s);if(x)return x;}return null;};
    const txt=(node,selectors)=>{const x=first(node,selectors);return (x?.textContent||'').replace(/\s+/g,' ').trim();};
    let selector,linkSel,titleSel,companySel,locationSel;
    if(kind==='LINKEDIN'){selector='[data-entity-urn*="jobPosting"], .base-search-card';linkSel=['a.base-card__full-link','a[href*="/jobs/view/"]'];titleSel=['.base-search-card__title','h3'];companySel=['.base-search-card__subtitle','h4'];locationSel=['.job-search-card__location','[class*="location"]'];}
    else if(kind==='INDEED'){selector='[data-jk], .job_seen_beacon, .cardOutline';linkSel=['a.jcs-JobTitle','a[href*="/viewjob"]','a[href*="jk="]'];titleSel=['a.jcs-JobTitle span','a.jcs-JobTitle','h2'];companySel=['[data-testid="company-name"]','.companyName'];locationSel=['[data-testid="text-location"]','.companyLocation'];}
    else{selector='article, [data-testid*="job" i], [class*="job-card" i]';linkSel=['a[href*="/jobs/"]','a[href*="/job/"]'];titleSel=['[class*="title" i]','h2','h3'];companySel=['[class*="company" i]','[class*="employer" i]'];locationSel=['[class*="location" i]'];}
    const nodes=[...document.querySelectorAll(selector)];const out=[];
    for(const node of nodes){const link=first(node,linkSel);if(!link?.href)continue;const title=(link.getAttribute('aria-label')||link.getAttribute('title')||txt(node,titleSel)||link.textContent||'').replace(/\s+/g,' ').trim();if(!title)continue;const time=node.querySelector('time');out.push({url:link.href,title,company:txt(node,companySel),location:txt(node,locationSel),postedAt:time?.getAttribute('datetime')||time?.textContent||'',externalId:node.getAttribute('data-jk')||node.getAttribute('data-job-id')||node.getAttribute('data-entity-urn')||''});}
    return out;
  },{kind});
  const seen=new Set(),jobs=[];for(const r of records){const j=normalizeCard(r,url,fallbackCompany);if(!j||seen.has(j.sourceUrl))continue;seen.add(j.sourceUrl);jobs.push(j);}return jobs;
}

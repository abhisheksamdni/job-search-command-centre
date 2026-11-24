import { COUNTRY_ALIASES, COUNTRY_BY_CODE, CITY_HINTS } from '../data/countries.mjs';

const fold=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[._]/g,' ').replace(/\s+/g,' ').trim();
const cleanPart=s=>String(s||'').replace(/\s+/g,' ').trim();
const aliasEntries=Object.entries(COUNTRY_ALIASES).sort((a,b)=>b[0].length-a[0].length);
const REGION_ALIASES={ma:'Massachusetts',ny:'New York',ca:'California',il:'Illinois',nsw:'New South Wales',vic:'Victoria'};

function countryFromText(raw=''){
  const f=fold(raw); if(!f)return null;
  const direct=COUNTRY_ALIASES[f]; if(direct)return {code:direct,name:COUNTRY_BY_CODE[direct]||raw};
  for(const [alias,code] of aliasEntries){
    if(alias.length<3)continue;
    const i=f.indexOf(alias); if(i<0)continue;
    const before=i===0||/[^a-z0-9]/.test(f[i-1]); const after=i+alias.length===f.length||/[^a-z0-9]/.test(f[i+alias.length]);
    if(before&&after)return {code,name:COUNTRY_BY_CODE[code]||alias};
  }
  return null;
}
function cityHint(raw=''){
  const f=fold(raw); const keys=Object.keys(CITY_HINTS).sort((a,b)=>b.length-a.length);
  for(const key of keys){const i=f.indexOf(key);if(i<0)continue;const before=i===0||/[^a-z0-9]/.test(f[i-1]);const after=i+key.length===f.length||/[^a-z0-9]/.test(f[i+key.length]);if(before&&after)return CITY_HINTS[key];}
  return null;
}
export function normalizedLocationKey({countryCode='',city='',region=''}={}){return `${fold(countryCode)}|${fold(city)}|${fold(region)}`;}
export function displayLocation({country=null,city=null,region=null}={}){return [city,region,country].filter(Boolean).join(', ');}

export function normalizeLocation(raw='') {
  const original=cleanPart(raw); const f=fold(original);
  const remote=/\b(remote|home based|work from home|anywhere)\b/i.test(original);
  const hybrid=/\bhybrid\b/i.test(original);
  const workMode=remote?'REMOTE':hybrid?'HYBRID':/\b(on[ -]?site|office based)\b/i.test(original)?'ONSITE':'UNSPECIFIED';
  const countryHit=countryFromText(original); const hint=cityHint(original);
  let countryCode=countryHit?.code||hint?.[0]||null; let country=countryCode?(COUNTRY_BY_CODE[countryCode]||countryHit?.name):null;
  const parts=original.split(',').map(cleanPart).filter(Boolean);
  let city=hint?.[1]||null; let region=hint?.[2]||null;
  if(!city && parts.length>1){
    const first=parts[0]; if(!countryFromText(first)&&!/\b(remote|hybrid)\b/i.test(first))city=first;
  }
  if(parts.length>=3){const mid=parts[parts.length-2];if(!countryFromText(mid)&&fold(mid)!==fold(city))region=REGION_ALIASES[fold(mid)]||mid;}
  if(!countryHit && parts.length===2 && city){const second=fold(parts[1]);if(REGION_ALIASES[second])region=REGION_ALIASES[second];}
  const confidence=countryHit&&city?0.98:countryHit?0.94:hint?0.9:remote?0.55:0.35;
  return {locationRaw:original,country,countryCode,city,region,remote,hybrid,workMode,confidence,normalizedKey:normalizedLocationKey({countryCode,city,region})};
}

export function normalizeTargetLocationInput(input={}){
  if(typeof input==='string')input={label:input};
  const label=cleanPart(input.label||input.displayLabel||'');
  if(label){
    const exactCountry=countryFromText(label); const exact=COUNTRY_ALIASES[fold(label)];
    if(exact && !label.includes(',')){
      const country=COUNTRY_BY_CODE[exact]||label;return {displayLabel:country,countryName:country,countryCode:exact,city:null,region:null,normalizedKey:normalizedLocationKey({countryCode:exact}),enabled:input.enabled===0?0:1,origin:input.origin||'USER'};
    }
    const n=normalizeLocation(label); const countryName=n.country; const unresolvedCity=!n.city&&!n.countryCode?label:null;
    const city=n.city||unresolvedCity; const display=displayLocation({country:countryName,city,region:n.region})||label;
    return {displayLabel:display,countryName,countryCode:n.countryCode,city,region:n.region,normalizedKey:normalizedLocationKey({countryCode:n.countryCode,city,region:n.region}),enabled:input.enabled===0?0:1,origin:input.origin||'USER'};
  }
  let code=cleanPart(input.countryCode).toUpperCase()||null; let countryName=cleanPart(input.country)||null;
  if(!code&&countryName){const hit=countryFromText(countryName);code=hit?.code||null;countryName=hit?.name||countryName;}
  if(code)countryName=COUNTRY_BY_CODE[code]||countryName;
  const city=cleanPart(input.city)||null; const region=cleanPart(input.region)||null;
  if(!code&&!city)throw new Error('Enter a country or city');
  return {displayLabel:displayLocation({country:countryName,city,region}),countryName,countryCode:code,city,region,normalizedKey:normalizedLocationKey({countryCode:code,city,region}),enabled:input.enabled===0?0:1,origin:input.origin||'USER'};
}

export function matchesConfiguredLocation(normalized, targets=[]) {
  if(!targets.filter(t=>t.enabled!==0).length)return true;
  return targets.filter(t=>t.enabled!==0).some(t=>{
    const tc=String(t.country_code||t.countryCode||'').toUpperCase(); const jc=String(normalized.countryCode||'').toUpperCase();
    const tcity=fold(t.city); const jcity=fold(normalized.city||normalized.locationRaw); const treg=fold(t.region); const jreg=fold(normalized.region||normalized.locationRaw);
    if(tc&&jc&&tc!==jc)return false;
    if(tc&&!jc && !fold(normalized.locationRaw).includes(fold(t.country||t.country_name||'')))return false;
    if(tcity && !(jcity===tcity || fold(normalized.locationRaw).includes(tcity)))return false;
    if(treg && !(jreg===treg || fold(normalized.locationRaw).includes(treg)))return false;
    if(normalized.remote && tc && jc && tc!==jc)return false;
    return Boolean(tc||tcity||treg);
  });
}

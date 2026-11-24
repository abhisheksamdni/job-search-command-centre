import { canonicalizeUrl } from '../utils/url.mjs';

const LOCATION_RANK={LOCATION_UNVERIFIED:0,LOCATION_QUERY_SCOPE_ONLY:1,LOCATION_INFERRED_FROM_DETAIL:3,LOCATION_VERIFIED:4,LOCATION_MISMATCH:4};
function usefulCompany(v=''){const s=String(v||'').trim();return s&&!/^(unknown|linkedin jobs|indeed|efinancialcareers)$/i.test(s);}
function provenance(job={}){const a=[];if(Array.isArray(job.discoveryProvenance))a.push(...job.discoveryProvenance);else if(job.discoveryQueryUrl||job.searchScopeLocation)a.push({discoveryQueryKind:job.discoveryQueryKind||null,discoveryQueryUrl:job.discoveryQueryUrl||null,discoveryQueryRole:job.discoveryQueryRole||null,searchScopeLocation:job.searchScopeLocation||null,searchScopeCountry:job.searchScopeCountry||null,searchScopeSource:job.searchScopeSource||null,searchScopeConfidence:job.searchScopeConfidence||null});return a;}
function uniqueObjects(items=[]){const seen=new Set(),out=[];for(const x of items){const k=JSON.stringify(x);if(seen.has(k))continue;seen.add(k);out.push(x);}return out;}
function merge(a,b){
  const out={...a};const ar=LOCATION_RANK[a.locationStatus]??(a.location?2:0),br=LOCATION_RANK[b.locationStatus]??(b.location?2:0);
  if((!usefulCompany(out.company)&&usefulCompany(b.company))||(!out.company&&b.company))out.company=b.company;
  if(b.location&&(!out.location||br>ar)){out.location=b.location;out.locationStatus=b.locationStatus||'LOCATION_VERIFIED';}
  else if(!out.location&&br>ar)out.locationStatus=b.locationStatus;
  if(String(b.jdRaw||'').length>String(out.jdRaw||'').length)out.jdRaw=b.jdRaw;
  for(const k of ['externalId','employerPublishedAt','sourcePublishedAt','postedAt','publishedPrecision','postingDateConfidence','applicationUrl','sourceUrl'])if(!out[k]&&b[k])out[k]=b[k];
  out.discoveryProvenance=uniqueObjects([...provenance(a),...provenance(b)]);
  if(!out.searchScopeLocation&&b.searchScopeLocation)out.searchScopeLocation=b.searchScopeLocation;
  if(!out.searchScopeCountry&&b.searchScopeCountry)out.searchScopeCountry=b.searchScopeCountry;
  if(!out.searchScopeSource&&b.searchScopeSource)out.searchScopeSource=b.searchScopeSource;
  if(!out.searchScopeConfidence&&b.searchScopeConfidence)out.searchScopeConfidence=b.searchScopeConfidence;
  return out;
}
export function dedupJobs(jobs=[]){const map=new Map();for(const job of jobs){const url=canonicalizeUrl(job.applicationUrl||job.sourceUrl||'');const key=url||`${job.company}::${job.title}::${job.location}`.toLowerCase();const enriched={...job,canonicalJobUrl:url,discoveryProvenance:provenance(job)};if(!map.has(key))map.set(key,enriched);else map.set(key,merge(map.get(key),enriched));}return [...map.values()];}

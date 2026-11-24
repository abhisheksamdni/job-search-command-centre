import { classifySeniority, seniorityCompatibility, SENIORITY_ORDER } from './professionalFit.mjs';

// Only remove level modifiers. Role nouns such as analyst, trader, manager and
// associate are material: dropping them made "Investment Manager" match the
// configured target "Investment Analyst" merely because both contain
// "investment".
const LEVEL_TOKENS=new Set(['senior','junior','graduate','lead','head','director','chief','vp','vice','president','intern']);
const ROLE_NOUNS=new Set(['analyst','associate','manager','specialist','officer','trader','dealer','engineer','researcher','strategist']);
const RELATED=[/trading operations/i,/trade support/i,/market risk/i,/investment operations/i,/portfolio operations/i,/execution support/i,/research assistant/i,/market specialist/i,/market analyst/i,/\bdealer\b/i,/\bexecution (?:dealer|specialist|trader)\b/i];
const FAMILY_HINTS={trading:/\b(?:trad(?:e|er|ing)|execution|dealer|dealing|market mak|sales trading)\b/i,investment:/\b(?:investment|portfolio|asset management|fund management)\b/i,research:/\b(?:equity research|investment research|market research|researcher|strategist)\b/i,risk:/\b(?:market risk|investment risk|trading risk|risk analyst|risk manager)\b/i,operations:/\b(?:operations|trade support|reconciliation|settlement|middle office|back office)\b/i};
const RANK=Object.fromEntries(SENIORITY_ORDER.map((x,i)=>[x,i]));
function norm(s=''){return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function familyOf(s=''){const text=String(s||'');if(FAMILY_HINTS.operations.test(text))return'operations';for(const [k,re] of Object.entries(FAMILY_HINTS))if(k!=='operations'&&re.test(text))return k;return null;}
function roleVariants(s=''){
  const raw=String(s||'').trim();
  const compact=raw.match(/^(.*?)([^\s/]+)\/([^\s/]+)$/);
  if(!compact)return [raw];
  const prefix=compact[1]||'';
  return [`${prefix}${compact[2]}`,`${prefix}${compact[3]}`];
}
function requiredTokens(s=''){return norm(s).split(' ').filter(x=>x.length>2&&!LEVEL_TOKENS.has(x));}
function phraseMatches(title,phrase){
  const normalizedTitle=norm(title);
  const variants=roleVariants(phrase).map(norm).filter(Boolean);
  for(const variant of variants){
    const tokens=requiredTokens(variant);
    const exactPhrase=normalizedTitle===variant||` ${normalizedTitle} `.includes(` ${variant} `);
    if(exactPhrase)return {matched:true,exactPhrase,tokens};
  }
  return {matched:false,exactPhrase:false,tokens:[]};
}
function compatibleFamily(job,target){if(!job||!target)return true;if(job===target)return true;return (job==='trading'&&target==='investment')||(job==='investment'&&target==='research')||(job==='research'&&target==='investment');}
function normalizedFamily(role={}){const raw=String(role.family||familyOf(role.phrase)||'').toLowerCase().replace(/_research$/,'').replace(/^investment_research$/,'investment');if(raw.includes('trading'))return'trading';if(raw.includes('investment'))return'investment';if(raw.includes('research'))return'research';if(raw.includes('risk'))return'risk';if(raw.includes('operations'))return'operations';return familyOf(role.phrase);}
function materialTargetMismatch(job,target){const gap=(job?.rank??RANK.MID)-(target?.rank??RANK.MID);return gap>=4||((job?.rank??0)>=RANK.DIRECTOR&&gap>=3);}

export function classifyRole(title,targetRoles=[]){
  const t=norm(title);if(!t)return {classification:'ROLE_REJECTED',family:null,matched:null,reason:'empty title',seniority:classifySeniority(title)};
  const jobSeniority=classifySeniority(title),jobFamily=familyOf(title);let best=null,seniorityRejected=null;
  for(const role of targetRoles.filter(r=>r.enabled!==0)){
    const p=norm(role.phrase);if(!p)continue;const targetSeniority=classifySeniority(role.phrase),targetFamily=normalizedFamily(role),match=phraseMatches(t,role.phrase),exactPhrase=match.exactPhrase,tokens=match.tokens,titleTokens=new Set(t.split(' ')),shared=tokens.filter(x=>titleTokens.has(x));
    const functionMatch=match.matched;
    if(!functionMatch){
      const domainOverlap=requiredTokens(role.phrase).filter(x=>!ROLE_NOUNS.has(x)).some(x=>titleTokens.has(x));
      if(domainOverlap&&materialTargetMismatch(jobSeniority,targetSeniority))seniorityRejected={role,jobSeniority,targetSeniority,gap:jobSeniority.rank-targetSeniority.rank};
      continue;
    }
    if(jobFamily==='operations'&&targetFamily==='trading'&&!exactPhrase)continue;if(!compatibleFamily(jobFamily,targetFamily)&&!exactPhrase)continue;
    if(materialTargetMismatch(jobSeniority,targetSeniority)){seniorityRejected={role,jobSeniority,targetSeniority,gap:jobSeniority.rank-targetSeniority.rank};continue;}
    const comp=seniorityCompatibility(jobSeniority,targetSeniority),score=(exactPhrase?100:78)+(jobFamily===targetFamily?10:0)-Math.max(0,comp.gap)*4+shared.length;if(!best||score>best.score)best={score,role,targetSeniority,targetFamily};
  }
  if(best)return {classification:'ROLE_MATCH',family:best.role.family||jobFamily,matched:best.role.phrase,reason:'configured role function with compatible seniority',seniority:jobSeniority,targetSeniority:best.targetSeniority.level};
  if(seniorityRejected)return {classification:'ROLE_REJECTED',family:jobFamily,matched:seniorityRejected.role.phrase,reason:`seniority mismatch: ${jobSeniority.level} role exceeds configured ${seniorityRejected.targetSeniority.level} target`,seniority:jobSeniority,targetSeniority:seniorityRejected.targetSeniority.level,seniorityMismatch:true};
  if(RELATED.some(rx=>rx.test(title)))return {classification:'ROLE_RELATED',family:jobFamily,matched:null,reason:'adjacent role; continue to evidence-based Recruiter evaluation',seniority:jobSeniority};
  return {classification:'ROLE_REJECTED',family:jobFamily,matched:null,reason:'no compatible configured role function/seniority',seniority:jobSeniority};
}

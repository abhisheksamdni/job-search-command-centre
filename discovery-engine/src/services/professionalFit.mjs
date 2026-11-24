import { sha256Text } from '../utils/hash.mjs';

const MONTH='(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const DATE_RANGE=new RegExp(`\\b(${MONTH})\\s+(\\d{4})\\s*(?:-|–|—|to)\\s*(?:(?:(${MONTH})\\s+(\\d{4}))|(Present|Current|Now))\\b`,'i');
export const SENIORITY_ORDER=['INTERN','GRADUATE','JUNIOR','ANALYST','ASSOCIATE','MID','SENIOR','VP','DIRECTOR','HEAD','C_SUITE','PARTNER'];
const SENIORITY_RANK=Object.fromEntries(SENIORITY_ORDER.map((x,i)=>[x,i]));
const FINANCE=/\b(?:trading|trader|investment|portfolio|capital markets?|financial markets?|equity|equities|derivative|derivatives|futures|options|securities|asset management|market microstructure|risk|execution|broker|dealer|quant|systematic trading|market analyst|research)\b/i;
const NON_FINANCE=/\b(?:food|foods|agro|manufactur|factory|logistics|warehouse|supply chain|fmcg|production)\b/i;
const TOOLS=['python','sql','excel','bloomberg','reuters','refinitiv','mt4','mt5','vba','c++','pine script','power bi','tableau','matlab'];
const PRODUCTS=['equities','equity','options','futures','derivatives','commodities','fixed income','forex','fx','crypto','digital assets','etf','securities lending','swaps'];
const FUNCTIONS=['trading','trade execution','execution','dealing','market making','investment management','portfolio management','portfolio analysis','research','market analysis','risk management','risk monitoring','operations','pricing','hedging','compliance','strategy research','systematic trading'];
const SKILLS=['market microstructure','data analysis','risk management','risk monitoring','portfolio analysis','market analysis','strategy research','systematic trading','quantitative trading','algorithmic trading','order book','liquidity','margin','p&l','pnl'];
const METRIC=/(?:£|\$|€|₹)?\b\d+(?:[.,]\d+)?(?:%|x|\+)?\b/g;
const LEADERSHIP_VERB=/\b(?:managed|managing|led|leading|supervised|supervising|headed|directed|oversaw|mentored|managed a team|team lead)\b/i;
const ACTION_VERB=/\b(?:executed|traded|analysed|analyzed|monitored|managed|built|developed|prepared|supported|researched|reviewed|delivered|created|maintained|processed|mentored|collaborated|worked|improved|reconciled|identified|converted)\b/i;
const SECTION_RE=/^(profile|summary|professional summary|experience|work experience|employment|education|certifications?|skills|projects?|research experience(?: and projects?)?|achievements?|awards?|languages?|extracurricular activities?)$/i;
const BULLET_RE=/^\s*[•●▪◦*-]\s+/;

function norm(s=''){return String(s||'').replace(/\s+/g,' ').trim();}
function lower(s=''){return norm(s).toLowerCase();}
function monthIndex(name){return ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].findIndex(x=>lower(name).startsWith(x));}
function toMonth(year,month){return Number(year)*12+Math.max(0,monthIndex(month));}
function monthLabel(value){if(!Number.isFinite(value))return null;const y=Math.floor(value/12),m=value%12;return `${y}-${String(m+1).padStart(2,'0')}`;}
function termsIn(text,list){const l=lower(text);return list.filter(x=>{const escaped=x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s+');return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`,'i').test(l);});}
function uniq(a){return [...new Set(a.filter(Boolean))];}
function conceptWords(values=[]){return uniq(values.flatMap(x=>lower(x).replace(/[^a-z0-9+.#]+/g,' ').split(/\s+/)).filter(x=>x.length>2&&!['and','the','with','for','from','years','year','experience','required','preferred','minimum','least'].includes(x)));}
const CONCEPT_GROUPS=[['trading','trade','trader','execution','execute','dealer','dealing'],['investment','portfolio','asset','fund'],['research','analysis','analytical','analyse','analyze','strategy'],['risk','exposure','margin','pnl'],['derivatives','derivative','options','futures','swaps'],['forex','fx','foreign','exchange'],['crypto','digital','assets','cryptocurrency']];
function expandConcepts(values=[]){const source=conceptWords(values),out=new Set(source);for(const x of source)for(const g of CONCEPT_GROUPS)if(g.includes(x))g.forEach(v=>out.add(v));return out;}
function anyConcept(hay,values=[]){const expanded=expandConcepts(values);if(!expanded.size)return true;return [...expanded].some(x=>hay.includes(x));}

const SENIORITY_RULES=[
  ['C_SUITE',/\b(?:chief\s+(?:investment|executive|financial|operating|risk|technology|information)\s+officer|cio|ceo|cfo|coo|cro|cto)\b/i],
  ['PARTNER',/\b(?:managing\s+partner|partner)\b/i],
  ['HEAD',/\b(?:global\s+head|regional\s+head|head\s+of|desk\s+head)\b/i],
  ['DIRECTOR',/\b(?:managing\s+director|executive\s+director|investment\s+director|director)\b/i],
  ['VP',/\b(?:vice\s+president|\bvp\b)\b/i],
  ['SENIOR',/\b(?:senior|lead|principal)\b/i],
  ['ASSOCIATE',/\bassociate\b/i],
  ['ANALYST',/\banalyst\b/i],
  ['JUNIOR',/\bjunior\b/i],
  ['GRADUATE',/\b(?:graduate|trainee|entry[- ]level)\b/i],
  ['INTERN',/\b(?:intern|internship)\b/i]
];
function senioritySignal(text=''){for(const [level,re] of SENIORITY_RULES){const m=String(text||'').match(re);if(m)return {level,rank:SENIORITY_RANK[level],evidence:m[0]};}return null;}
export function classifySeniority(title='',jdText=''){
  const fromTitle=senioritySignal(title);if(fromTitle)return fromTitle;
  if(/\b(?:trader|dealer|specialist|researcher|consultant)\b/i.test(title))return {level:'MID',rank:SENIORITY_RANK.MID,evidence:norm(title)};
  const fromJd=senioritySignal(jdText);if(fromJd)return fromJd;
  return {level:'MID',rank:SENIORITY_RANK.MID,evidence:null};
}

function looksEmployer(text=''){return text.length<110&&!/[.!?]$/.test(text)&&/\b(?:capital|bank|markets|management|partners|foods|services|limited|ltd|plc|llp|university|group|company|corp|inc)\b/i.test(text);}
function looksRole(text=''){return text.length<140&&!/[.!?]$/.test(text)&&!ACTION_VERB.test(text)&&/\b(?:analyst|trader|dealer|manager|associate|intern|director|head|officer|specialist|executive|consultant|researcher|controller|underwriter)\b/i.test(text);}
function titleFromDateLine(text,dateText){const before=norm(text.replace(dateText,'').replace(/[|,:;\-–—]+\s*$/,'').replace(/^\s*[|,:;\-–—]+/,''));return looksRole(before)?before:null;}
function nearbyIdentity(lines,index,currentEmployer,currentRole){let employer=currentEmployer,role=currentRole;for(let d=1;d<=3;d++){for(const j of [index-d,index+d]){if(j<0||j>=lines.length)continue;const x=lines[j];if(!x||DATE_RANGE.test(x))continue;if(!employer&&looksEmployer(x))employer=x;if(!role&&looksRole(x))role=x;}if(employer&&role)break;}return{employer,role};}
function logicalCvLines(cvText=''){
  const out=[];let section='GENERAL';const rawLines=String(cvText||'').split(/\r?\n/);
  for(let i=0;i<rawLines.length;i++){
    const raw=rawLines[i],text=norm(raw);if(!text)continue;
    if(SECTION_RE.test(text)){section=text.toUpperCase();out.push({raw:text,text,lineNumber:i+1,section,heading:true,bullet:false});continue;}
    const bullet=BULLET_RE.test(raw),body=norm(raw.replace(BULLET_RE,'')),prev=out.at(-1),newSkillLabel=/^(?:technical|soft|management) skills?|^fields? of interest\s*:/i.test(text);
    const structural=Boolean(DATE_RANGE.test(text)||looksEmployer(text)||looksRole(text));
    const joinsProfile=/^(?:PROFILE|SUMMARY|PROFESSIONAL SUMMARY)$/.test(section)&&prev&&!prev.heading&&prev.section===section;
    const joinsBullet=!bullet&&prev?.bullet&&!structural;
    const joinsSkill=!bullet&&!newSkillLabel&&section==='SKILLS'&&prev&&!prev.heading&&prev.section===section;
    if(joinsProfile||joinsBullet||joinsSkill){prev.raw=`${prev.raw} ${text}`;prev.text=norm(`${prev.text} ${text}`);continue;}
    out.push({raw:bullet?`• ${body}`:text,text:body,lineNumber:i+1,section,heading:false,bullet});
  }
  return out;
}
function inferredDomains(text='',functions=[]){const out=['FINANCE'];if(/\b(?:trad|execution|dealer|market mak)/i.test(text)||functions.some(x=>/trad|execution|dealing|market making/i.test(x)))out.push('TRADING');if(/\b(?:investment|portfolio|asset management|fund management)/i.test(text)||functions.some(x=>/investment|portfolio/i.test(x)))out.push('INVESTMENT');if(/\b(?:research|analys|strategy)/i.test(text)||functions.some(x=>/research|analysis/i.test(x)))out.push('RESEARCH');if(/\b(?:risk|exposure|margin|limits?|p&l|pnl)/i.test(text)||functions.some(x=>/risk/i.test(x)))out.push('RISK');if(/\b(?:operations|settlement|reconcil)/i.test(text)||functions.some(x=>/operations/i.test(x)))out.push('OPERATIONS');if(/\b(?:compliance|regulatory|aml|kyc|sanctions)/i.test(text)||functions.some(x=>/compliance/i.test(x)))out.push('REGULATORY');return uniq(out);}

export function parseExperienceRanges(cvText=''){
  const lines=String(cvText||'').split(/\r?\n/).map(norm);const now=new Date(),currentMonth=now.getUTCFullYear()*12+now.getUTCMonth();const ranges=[];
  let employer=null,role=null;
  for(let i=0;i<lines.length;i++){
    const text=lines[i];if(!text)continue;
    if(looksEmployer(text)&&!DATE_RANGE.test(text)){employer=text;continue;}
    if(looksRole(text)&&!DATE_RANGE.test(text)){role=text;continue;}
    const m=text.match(DATE_RANGE);if(!m)continue;
    const start=toMonth(m[2],m[1]),endInclusive=m[5]?currentMonth:toMonth(m[4],m[3]);if(!Number.isFinite(start)||!Number.isFinite(endInclusive)||endInclusive<start)continue;
    const inlineRole=titleFromDateLine(text,m[0]);if(inlineRole)role=inlineRole;const nearby=nearbyIdentity(lines,i,employer,role);employer=nearby.employer;role=nearby.role;
    const block=[text];for(let j=i+1;j<Math.min(lines.length,i+10);j++){
      const next=lines[j];if(!next)continue;if(DATE_RANGE.test(next)||/^(?:education|skills|certifications?|projects?|achievements?|awards?)$/i.test(next)||looksEmployer(next)||looksRole(next))break;block.push(next);
    }
    const context=norm([employer,role,...block].filter(Boolean).join(' | '));
    const explicitFinance=FINANCE.test(context),explicitNonFinance=NON_FINANCE.test(`${employer||''} ${role||''}`)&&!FINANCE.test(`${role||''} ${block.join(' ')}`);const financial=explicitFinance&&!explicitNonFinance;
    const functions=termsIn(context,FUNCTIONS),assetClasses=termsIn(context,PRODUCTS),tools=termsIn(context,TOOLS),skills=termsIn(context,SKILLS),domains=financial?inferredDomains(context,functions):['OTHER'];
    const seniority=classifySeniority(role||'',context);const leadership=financial&&(seniority.rank>=SENIORITY_RANK.SENIOR||LEADERSHIP_VERB.test(context));
    ranges.push({lineIndex:i,start,end:endInclusive+1,months:endInclusive-start+1,startDate:monthLabel(start),endDate:m[5]?'PRESENT':monthLabel(endInclusive),context,employer,role,dateText:m[0],financial,functions,domains,assetClasses,products:assetClasses,tools,skills,leadership,seniority});
  }
  return ranges;
}

function unionMonths(ranges){const sorted=ranges.map(x=>[x.start,x.end]).sort((a,b)=>a[0]-b[0]);if(!sorted.length)return 0;let [s,e]=sorted[0],total=0;for(const [ns,ne] of sorted.slice(1)){if(ns<=e)e=Math.max(e,ne);else{total+=e-s;s=ns;e=ne;}}return total+(e-s);}
function criterionHit(range,criteria={}){
  if(!range.financial)return false;const hay=lower([range.context,...range.functions,...range.domains,...range.assetClasses,...range.skills].join(' '));
  const assets=[...(criteria.assetClass||[]),...(criteria.product||[])];if(assets.length&&!anyConcept(hay,assets))return false;
  const domains=(criteria.domain||[]).filter(x=>!/^(?:finance|financial|market|markets)$/i.test(x));if(domains.length&&!anyConcept(hay,domains))return false;
  const functions=criteria.function||[];if(functions.length&&!anyConcept(hay,functions))return false;
  const requested=conceptWords([...(criteria.role||[]),...(criteria.responsibility||[])]);if(!requested.length)return true;const generic=new Set(['finance','financial','market','markets','experience','relevant','previous','proven']);const meaningful=requested.filter(x=>!generic.has(x));if(!meaningful.length)return true;const expanded=expandConcepts(meaningful),hits=[...expanded].filter(x=>hay.includes(x));return hits.length>=Math.min(2,meaningful.length)||hits.length/Math.max(1,meaningful.length)>=0.34;
}

export function relevantExperience(cvText='',criteria={}){const ranges=parseExperienceRanges(cvText).filter(x=>criterionHit(x,criteria));const months=unionMonths(ranges);return {months,years:Number((months/12).toFixed(1)),ranges,criteria:{function:criteria.function||[],domain:criteria.domain||[],assetClass:criteria.assetClass||[],product:criteria.product||[],role:criteria.role||[],responsibility:criteria.responsibility||[]}};}
export function leadershipExperience(cvText=''){const ranges=parseExperienceRanges(cvText).filter(x=>x.financial&&x.leadership);const months=unionMonths(ranges);return {months,years:Number((months/12).toFixed(1)),ranges};}
export function candidateFinancialSeniority(cvText=''){
  const ranges=parseExperienceRanges(cvText).filter(x=>x.financial);let best={level:'JUNIOR',rank:SENIORITY_RANK.JUNIOR,evidence:null};for(const r of ranges)if(r.seniority.rank>best.rank)best={...r.seniority,evidence:r.role||r.context};if(best.evidence)return best;
  const lines=String(cvText||'').split(/\r?\n/).map(norm).filter(Boolean);for(const line of lines){if(!FINANCE.test(line)||NON_FINANCE.test(line))continue;const s=classifySeniority(line,line);if(s.rank>best.rank)best={...s,evidence:line};}return best;
}

export function evidenceRecords(cvText='',meta={}){
  const lines=logicalCvLines(cvText),normalized=lines.map(x=>x.text),ranges=parseExperienceRanges(cvText);let section='GENERAL',employer=null,role=null,dates=null,currentRange=null;const out=[];
  for(let i=0;i<lines.length;i++){
    const logical=lines[i],raw=logical.raw,text=logical.text,sourceLine=logical.lineNumber;if(!text)continue;
    if(SECTION_RE.test(text)){section=text.toUpperCase();employer=null;role=null;dates=null;currentRange=null;continue;}
    if(!['EDUCATION','CERTIFICATIONS','CERTIFICATION'].includes(section)&&looksEmployer(text)&&!DATE_RANGE.test(text)){employer=text;if(currentRange&&!currentRange.employer&&Math.abs((currentRange.lineIndex??sourceLine-1)-(sourceLine-1))<=3)currentRange.employer=text;continue;}
    const dm=text.match(DATE_RANGE);if(dm){dates=dm[0];const inline=titleFromDateLine(text,dates);if(inline)role=inline;currentRange=ranges.find(r=>r.lineIndex===sourceLine-1)||ranges.find(r=>r.dateText===dates&&(role?lower(r.role)===lower(role):true))||ranges.find(r=>r.dateText===dates)||currentRange;if(currentRange){employer=currentRange.employer||employer;role=currentRange.role||role;}continue;}
    if(!['EDUCATION','CERTIFICATIONS','CERTIFICATION'].includes(section)&&looksRole(text)){role=text;const nearest=ranges.find(r=>Math.abs((r.lineIndex??-99)-(sourceLine-1))<=3&&lower(r.role)===lower(role));if(nearest){currentRange=nearest;employer=nearest.employer||employer;dates=nearest.dateText||dates;}continue;}
    if(text.length<12&&!/^(?:SKILLS?|CERTIFICATIONS?|CERTIFICATION|EDUCATION)$/i.test(section))continue;
    if(!currentRange&&/^(?:GENERAL|EXPERIENCE|WORK EXPERIENCE|EMPLOYMENT)$/i.test(section)){const nearby=ranges.filter(r=>Math.abs((r.lineIndex??-99)-(sourceLine-1))<=8).sort((a,b)=>Math.abs(a.lineIndex-(sourceLine-1))-Math.abs(b.lineIndex-(sourceLine-1)))[0];if(nearby){currentRange=nearby;employer=nearby.employer||employer;role=nearby.role||role;dates=nearby.dateText||dates;}}
    const metrics=[...text.matchAll(METRIC)].map(x=>x[0]),context=norm(`${currentRange?.context||''} ${employer||''} ${role||''} ${text}`),financial=(currentRange?.financial??(FINANCE.test(context)&&!NON_FINANCE.test(`${employer||''} ${role||''}`))),functions=uniq([...(currentRange?.functions||[]),...termsIn(text,FUNCTIONS)]),assetClasses=uniq([...(currentRange?.assetClasses||[]),...termsIn(text,PRODUCTS)]),tools=uniq([...(currentRange?.tools||[]),...termsIn(text,TOOLS)]),skills=uniq([...(currentRange?.skills||[]),...termsIn(text,SKILLS)]),domains=financial?uniq([...(currentRange?.domains||[]),...inferredDomains(text,functions)]):['OTHER'];
    const leadershipEvidence=[];if(financial&&LEADERSHIP_VERB.test(text))leadershipEvidence.push(text);if(financial&&role&&classifySeniority(role).rank>=SENIORITY_RANK.SENIOR)leadershipEvidence.push(role);
    const fingerprint=sha256Text(`${meta.documentSha||''}|${sourceLine}|${text.toLowerCase()}`);out.push({exactSourceText:text,lineNumber:sourceLine,section,employer:currentRange?.employer||employer,title:currentRange?.role||role,role:currentRange?.role||role,dates:currentRange?.dateText||dates,startDate:currentRange?.startDate||null,endDate:currentRange?.endDate||null,durationMonths:currentRange?.months||null,function:functions,functions,domain:financial?'FINANCE':'OTHER',domains,assetClasses,products:assetClasses,tools,skills,leadershipEvidence,metric:metrics.length?metrics:null,sourceCvVersionId:meta.cvVersionId||null,sourceDocumentSha:meta.documentSha||null,sourceDocumentName:meta.documentName||null,sourceFingerprint:fingerprint});
  }
  if(!out.length){for(let i=0;i<normalized.length;i++){const text=normalized[i];if(text.length<12||SECTION_RE.test(text))continue;const financial=FINANCE.test(text)&&!NON_FINANCE.test(text),functions=termsIn(text,FUNCTIONS),assetClasses=termsIn(text,PRODUCTS),tools=termsIn(text,TOOLS),skills=termsIn(text,SKILLS),sourceLine=lines[i]?.lineNumber||i+1,fingerprint=sha256Text(`${meta.documentSha||''}|${sourceLine}|${text.toLowerCase()}`);out.push({exactSourceText:text,lineNumber:sourceLine,section:'GENERAL',employer:null,title:null,role:null,dates:null,startDate:null,endDate:null,durationMonths:null,function:functions,functions,domain:financial?'FINANCE':'OTHER',domains:financial?inferredDomains(text,functions):['OTHER'],assetClasses,products:assetClasses,tools,skills,leadershipEvidence:financial&&LEADERSHIP_VERB.test(text)?[text]:[],metric:[...text.matchAll(METRIC)].map(x=>x[0])||null,sourceCvVersionId:meta.cvVersionId||null,sourceDocumentSha:meta.documentSha||null,sourceDocumentName:meta.documentName||null,sourceFingerprint:fingerprint});}}
  return out;
}

export function seniorityCompatibility(jobSeniority,candidateSeniority){const jr=jobSeniority?.rank??SENIORITY_RANK.MID,cr=candidateSeniority?.rank??SENIORITY_RANK.MID,gap=jr-cr;return {gap,acceptable:gap<=2,materialMismatch:gap>=4||(jr>=SENIORITY_RANK.DIRECTOR&&gap>=3),clearExecutiveMismatch:jr>=SENIORITY_RANK.DIRECTOR&&gap>=3};}

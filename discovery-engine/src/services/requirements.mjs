import { classifySeniority } from './professionalFit.mjs';

const MANDATORY=/\b(must|required|essential|minimum|at least|need(?:s)? to|you have|you will have|proven experience|previous experience)\b/i;
const PREFERRED=/\b(preferred|desirable|ideally|would be beneficial)\b/i;
const BONUS=/\b(nice to have|advantageous?|bonus|a plus|(?:helpful|useful)?\s*but not required|not required)\b/i;
const BEHAVIOURAL=/\b(communication|collaborat|teamwork|stakeholder|attention to detail|organis|problem.solv|self.starter|leadership|interpersonal|adaptab|initiative|proactive|resilien|ownership|fast-paced|performance-oriented)\b/i;
const RESPONSIBILITY=/\b(responsib|you will|role will|monitor|manage|execute|analyse|analyze|research|support|develop|maintain|review|prepare|coordinate|deliver|build|trade|hedg|price|reconcil|oversee|evaluate|assess)\b/i;
const REQUIREMENT_SIGNAL=/\b(experience|knowledge|proficien|skill|degree|certif|licen[cs]e|series\s+(?:7|55|63)|language|python|sql|excel|bloomberg|reuters|refinitiv|mt5|mt4|trading|derivatives|equities|fixed income|portfolio|investment|research|risk|execution|options|futures|forex|fx|crypto|digital asset|compliance|regulatory|margin|liquidity|hedging|pricing|swaps|commission|years?|leadership|education|qualification|authorization|authorisation|visa|sponsor|quantitative|analytical|analysis|scalping|latency arbitrage|market microstructure|programming|backtesting|validation)\b/i;
const BACKGROUND_SIGNAL=/\b(background in|track record|industry exposure|financial services|capital markets|professional background|commercial awareness|market knowledge)\b/i;
const MARKETING_NOISE=/\b(build a better future|fulfilling career|make (?:your|an?) impact|empowered to|feel supported|we love hearing|great place to work|exciting opportunity|growing team|pivotal role|established global|different experiences|our values|our culture|employee benefits?|parental leave|competitive benefits?|equal opportunit|diversity|inclusion|disability|race|religion|sexual orientation|gender identity|veteran status|structured onboarding|performance-based progression|long-term career|the role offers|opportunity to build|our client is seeking)\b/i;
const COMPANY_NOISE=/\b(?:we are|our company|our business|founded in|operates? in|offices? in|employees? worldwide|years? of (?:unbroken )?profitability|global business|diverse client base)\b/i;
const TOOLS=['python','sql','excel','bloomberg','reuters','refinitiv','mt4','mt5','vba','c++','power bi','tableau','matlab','r'];
const ASSETS=['equities','equity','options','futures','derivatives','commodities','fixed income','forex','fx','crypto','digital assets','etf','securities lending'];
const PRODUCTS=['options','futures','swaps','etf','securities lending','forex','fx','derivatives','equities','commodities','fixed income','crypto','digital assets'];
const FUNCTIONS=['trading','trade execution','execution','dealing','market making','research','portfolio management','portfolio analysis','risk management','risk monitoring','investment management','market operations','operations','compliance','pricing','hedging','market analysis','strategy research','systematic trading'];
const TECHNICAL=['market microstructure','order book','data analysis','quantitative trading','algorithmic trading','systematic trading','latency arbitrage','scalping','pricing','hedging','margin','stop-out','stop out','liquidity provider','a-book','b-book'];
const QUALS=['degree','msc','mba','bachelor','master','phd'];
const CERTS=['cfa','cisi','epat','frm','caia','acca','series 7','series 55','series 63','licence','license','certification'];
const LANGUAGES=['english','german','french','spanish','italian','dutch','arabic','mandarin','cantonese','hindi'];
const REGULATORY=['fca','mifid','mas','finra','sec','aml','kyc','sanctions','compliance','regulatory'];

function norm(s=''){return String(s||'').replace(/\s+/g,' ').trim();}
function stripMarkupResidue(value=''){
  let out=String(value||'');
  for(let i=0;i<6;i++){
    const next=out
      .replace(/&amp;?/gi,'&')
      .replace(/&lt;?/gi,'<')
      .replace(/&gt;?/gi,'>')
      .replace(/&nbsp;?/gi,' ')
      .replace(/&quot;?/gi,'"')
      .replace(/&apos;?|&#39;?/gi,"'");
    if(next===out)break;out=next;
  }
  return out
    .replace(/<\s*br\s*\/?\s*>/gi,'\n')
    .replace(/<\s*\/\s*(?:p|li|ul|ol|div|section|article|h[1-6])\s*>/gi,'\n')
    .replace(/<\s*(?:p|li|ul|ol|div|section|article|h[1-6])\b[^>]*>/gi,'\n')
    .replace(/<[^>]*>/g,' ')
    .replace(/&(?:lt|gt|nbsp|amp|quot|apos)(?:;|\b)/gi,' ');
}
function uniq(a){return [...new Set(a.filter(Boolean))];}
function escaped(s){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s+');}
function hasTerm(text,term){return new RegExp(`(?:^|[^a-z0-9])${escaped(term)}(?:$|[^a-z0-9])`,'i').test(String(text||''));}
function findTerms(text,list){return list.filter(x=>hasTerm(text,x));}
export function parseYears(text=''){
  const t=String(text);let m=t.match(/\b(\d{1,2})\s*(?:-|–|—|to)\s*(\d{1,2})\s*(?:years?|yrs?)\b/i);if(m)return {minYears:Number(m[1]),maxYears:Number(m[2])};
  m=t.match(/\bup to\s+(\d{1,2})\s*(?:years?|yrs?)\b/i);if(m)return {minYears:null,maxYears:Number(m[1])};
  m=t.match(/\b(?:minimum\s+(?:of\s+)?|at\s+least\s+)?(\d{1,2})\s*\+\s*(?:years?|yrs?)\b/i);if(m)return {minYears:Number(m[1]),maxYears:null};
  m=t.match(/\b(?:minimum\s+(?:of\s+)?|at\s+least\s+)(\d{1,2})\s*(?:years?|yrs?)\b/i);if(m)return {minYears:Number(m[1]),maxYears:null};
  m=t.match(/\b(\d{1,2})\s*(?:years?|yrs?)\b/i);if(m)return {minYears:Number(m[1]),maxYears:null};
  return {minYears:null,maxYears:null};
}
function mandatoryStrength(text,category,minYears){if(category==='MANDATORY')return /\b(must|required|essential|minimum|at least)\b/i.test(text)||minYears!=null?'CLEAR':'STRONG';if(category==='CORE')return'CORE';if(category==='PREFERRED')return'PREFERRED';if(category==='BONUS')return'BONUS';return'NORMAL';}
function informationClass(text,sourceSection=''){
  if(MARKETING_NOISE.test(text))return'EMPLOYER_MARKETING_OR_EEO';
  if(COMPANY_NOISE.test(text)&&!REQUIREMENT_SIGNAL.test(text)&&!RESPONSIBILITY.test(text))return'COMPANY_BACKGROUND';
  if(PREFERRED.test(text)||BONUS.test(text))return'PREFERRED_OR_BONUS';
  if(MANDATORY.test(text))return'MANDATORY_EXPERIENCE_OR_QUALIFICATION';
  if(RESPONSIBILITY.test(text)||/responsibilit|what you(?:'|’)ll do|the role/i.test(sourceSection))return'CORE_JOB_ACTIVITY';
  if(BEHAVIOURAL.test(text))return'BEHAVIOURAL_REQUIREMENT';
  if(BACKGROUND_SIGNAL.test(text))return'CANDIDATE_BACKGROUND';
  if(REQUIREMENT_SIGNAL.test(text))return'CANDIDATE_REQUIREMENT';
  return'NON_REQUIREMENT_CONTEXT';
}
function categoryFor(text,forced=null,{minYears=null,sourceSection=null}={}){
  if(forced)return forced;
  const info=informationClass(text,sourceSection);
  if(['EMPLOYER_MARKETING_OR_EEO','COMPANY_BACKGROUND','NON_REQUIREMENT_CONTEXT'].includes(info))return'NOT_A_REQUIREMENT';
  if(BONUS.test(text))return'BONUS';
  if(PREFERRED.test(text))return'PREFERRED';
  if(MANDATORY.test(text))return'MANDATORY';
  if(minYears!=null&&/requirements?|qualifications?|experience/i.test(sourceSection||''))return'MANDATORY';
  if(minYears!=null)return'MANDATORY';
  if(BEHAVIOURAL.test(text))return'BEHAVIOURAL';
  if(BACKGROUND_SIGNAL.test(text)&&!RESPONSIBILITY.test(text))return'BACKGROUND';
  if(RESPONSIBILITY.test(text))return'CORE';
  return REQUIREMENT_SIGNAL.test(text)?'IMPORTANT':'NOT_A_REQUIREMENT';
}
function importanceFor(category,text){
  if(category==='MANDATORY')return 5;
  if(category==='CORE')return 4;
  if(category==='IMPORTANT')return 3;
  if(category==='PREFERRED')return 2;
  if(category==='BONUS')return 1;
  if(category==='BEHAVIOURAL')return /\b(?:leadership|ownership|high[- ]pressure|stakeholder)\b/i.test(text)?2:1;
  if(category==='BACKGROUND')return 2;
  return 0;
}
function typeFor(text,meta){
  if(meta.workAuthorizationConstraint)return'WORK_AUTHORIZATION';if(meta.locationConstraint)return'LOCATION';if(meta.language.length)return'LANGUAGE';if(meta.regulatoryRequirement.length)return'REGULATORY';if(meta.certification.length)return'CERTIFICATION';if(meta.qualification.length)return'QUALIFICATION';
  if((meta.minYears!=null||meta.maxYears!=null)&&(meta.leadership||meta.domain.length||meta.function.length||meta.assetClass.length))return'RELEVANT_EXPERIENCE';if(meta.minYears!=null||meta.maxYears!=null)return'EXPERIENCE_YEARS';if(meta.seniority)return'SENIORITY';if(meta.tool.length)return'TOOL';if(meta.assetClass.length)return'ASSET_CLASS';if(meta.product.length)return'PRODUCT';if(meta.technicalSkill.length)return'TECHNICAL_SKILL';if(meta.function.length)return'RESPONSIBILITY';if(meta.domain.length)return'DOMAIN';if(BEHAVIOURAL.test(text))return'BEHAVIOURAL';if(RESPONSIBILITY.test(text))return'RESPONSIBILITY';return'BACKGROUND';
}
function inferDomain(text){return uniq([/\b(?:investment|portfolio|asset management|fund management)\b/i.test(text)?'INVESTMENT':null,/\b(?:trading|execution|dealer|market making|forex|fx)\b/i.test(text)?'TRADING':null,/\b(?:risk|exposure|margin)\b/i.test(text)?'RISK':null,/\b(?:compliance|regulatory|aml|kyc|sanctions)\b/i.test(text)?'REGULATORY':null,/\b(?:research|analysis|analytical|strategy)\b/i.test(text)?'RESEARCH':null,/\b(?:operations|settlement|reconciliation)\b/i.test(text)?'OPERATIONS':null]);}
function explicitSeniority(text){const s=classifySeniority(text,'');return /\b(?:intern|graduate|trainee|junior|analyst|associate|mid[- ]?level|senior|lead|principal|vice president|\bvp\b|director|head of|chief|cio|partner)\b/i.test(text)?s.level:null;}
function atomicPieces(jd=''){
  const prepared=stripMarkupResidue(jd).replace(/\r\n?/g,'\n');const pieces=[];let section=null,pos=0;
  for(const rawLine of prepared.split('\n')){
    const trimmed=rawLine.trim();if(!trimmed)continue;const heading=trimmed.match(/^#{1,6}\s+(.+)$/);if(heading){section=norm(heading[1]);continue;}
    const headingLike=/^[A-Z][A-Za-z &/\-]{2,60}:?$/.test(trimmed)&&!/[.!?]$/.test(trimmed)&&(trimmed===trimmed.toUpperCase()||/^(?:Responsibilities|Requirements|Qualifications|Experience|Skills|About(?: the role| you)?|What you(?:'|’)ll do|The role|Education|Preferred|Essential)\b/i.test(trimmed));
    if(headingLike&&!/^(?:must|required|preferred)\b/i.test(trimmed)){section=trimmed.replace(/:$/,'');continue;}
    const line=norm(trimmed.replace(/^\s*(?:[-*•▪◦]|\d+[.)])\s*/,''));if(!line)continue;const protectedLine=line.replace(/\be\.g\./gi,'e.g<DOT>').replace(/\bi\.e\./gi,'i.e<DOT>'),sentences=protectedLine.split(/(?<=[.!?;])\s+(?=[A-Z0-9])/).map(x=>norm(x.replace(/(?:e\.g|i\.e)<DOT>/gi,m=>m.replace('<DOT>','.')))).filter(Boolean);
    for(const s of (sentences.length?sentences:[line]))if(s.length>=8&&s.length<=900){pos++;pieces.push({text:s,sourceSection:section,sourcePosition:pos});}
  }
  return pieces;
}

export function enrichRequirement(text,forcedCategory=null,id=null,sourcePosition=null,sourceSection=null){
  const cleanText=norm(text),yr=parseYears(cleanText),tool=findTerms(cleanText,TOOLS),assetClass=findTerms(cleanText,ASSETS),product=findTerms(cleanText,PRODUCTS),fn=findTerms(cleanText,FUNCTIONS),technicalSkill=findTerms(cleanText,TECHNICAL),qualification=findTerms(cleanText,QUALS),certification=findTerms(cleanText,CERTS),language=findTerms(cleanText,LANGUAGES),regulatoryRequirement=findTerms(cleanText,REGULATORY),domain=inferDomain(cleanText),seniority=explicitSeniority(cleanText),leadership=/\b(?:senior leadership|leadership|manage(?:ment)? team|lead a team|people management|head of|director|chief)\b/i.test(cleanText),locationConstraint=/\b(?:based in|located in|relocat|onsite|on-site|hybrid|remote|must reside|location)\b/i.test(cleanText)?cleanText:null,workAuthorizationConstraint=/\b(?:work authori[sz]ation|right to work|visa|sponsor(?:ship)?|work permit)\b/i.test(cleanText)?cleanText:null;
  const category=categoryFor(cleanText,forcedCategory,{minYears:yr.minYears,sourceSection}),infoClass=informationClass(cleanText,sourceSection),importance=importanceFor(category,cleanText);const meta={minYears:yr.minYears,maxYears:yr.maxYears,tool,assetClass,product,function:fn,technicalSkill,qualification,certification,language,regulatoryRequirement,domain,seniority,leadership,locationConstraint,workAuthorizationConstraint};
  return {id:id||null,originalText:String(text||''),exactJdWording:String(text||''),cleanText,category,informationClass:infoClass,candidateRelevant:category!=='NOT_A_REQUIREMENT',importance,mandatory:category==='MANDATORY',preferred:['PREFERRED','BONUS'].includes(category),requirementType:typeFor(cleanText,meta),mandatoryStrength:mandatoryStrength(cleanText,category,yr.minYears),minYears:yr.minYears,maxYears:yr.maxYears,seniority,leadership,domain,function:fn,assetClass,product,tool,technicalSkill,qualification,certification,language,regulatoryRequirement,locationConstraint,workAuthorizationConstraint,sourceSection:sourceSection||null,sourcePosition};
}

export function extractRequirements(jdClean=''){
  const out=[],seen=new Set();let n=0;for(const piece of atomicPieces(jdClean)){
    const key=piece.text.toLowerCase();if(seen.has(key))continue;seen.add(key);n++;out.push(enrichRequirement(piece.text,null,`REQ-${String(n).padStart(3,'0')}`,piece.sourcePosition,piece.sourceSection));
  }return out.slice(0,180);
}

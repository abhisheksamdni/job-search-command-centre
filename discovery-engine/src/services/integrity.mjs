const BULLET=/^\s*[•●▪◦*-]\s+/;
const HEADING=new Set(['PROFILE','SUMMARY','PROFESSIONAL SUMMARY','WORK EXPERIENCE','EXPERIENCE','EMPLOYMENT','EDUCATION','SKILLS','CERTIFICATIONS','CERTIFICATES','PROJECTS','RESEARCH EXPERIENCE','RESEARCH EXPERIENCE AND PROJECTS','ACHIEVEMENTS','AWARDS','LANGUAGE','LANGUAGES','EXTRACURRICULAR ACTIVITY','EXTRACURRICULAR ACTIVITIES']);
const COMMON_CAPITALIZED=new Set(['The','A','An','And','For','With','Using','Through','Across','Led','Built','Managed','Improved','Supported','Executed','Developed','Prepared','Analysed','Analyzed','Delivered','Created','Maintained','Monitored','Worked']);
const SCOPE_GROUPS=[
  ['MANAGERIAL_SCOPE',/\b(?:managed|managing|leading|supervised|supervising|headed|directed|owned|oversaw)\b|(?<!-)\bled\b/i],
  ['LEADERSHIP_SCOPE',/\b(?:leadership|team lead|people management|direct reports?)\b/i],
  ['ACHIEVEMENT_SCOPE',/\b(?:achieved|increased|reduced|saved|generated|won|awarded|ranked|outperformed)\b/i],
  ['PERFORMANCE_SCOPE',/\b(?:p\s*&\s*l|pnl|profit(?:ability)?|returns?|alpha|outperform(?:ed|ance)?|aum|assets under management)\b/i],
  ['CLIENT_SCOPE',/\b(?:clients?|customers?|mandates?)\b/i],
  ['REGULATORY_SCOPE',/\b(?:sanctions?|aml|anti-money laundering|kyc|fca|mifid|regulatory compliance)\b/i]
];

function clean(s=''){return String(s).replace(BULLET,'').replace(/\s+/g,' ').trim();}
function records(text=''){let section='GENERAL';const out=[];for(const [index,raw] of String(text).split(/\r?\n/).entries()){const value=clean(raw);if(!value)continue;const upper=value.toUpperCase();if(HEADING.has(upper)){section=upper;out.push({raw:value,clean:value,index,section,heading:true});continue;}const prev=out.at(-1),bullet=BULLET.test(raw),date=/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\b/i.test(value),skillLabel=/^(?:Technical|Soft|Management) Skills?|^Fields? of Interest\s*:/i.test(value),joinsProfile=['PROFILE','SUMMARY','PROFESSIONAL SUMMARY'].includes(section)&&prev&&!prev.heading&&prev.section===section,joinsBullet=!bullet&&prev&&BULLET.test(prev.raw)&&!date,joinsSkill=!bullet&&!skillLabel&&section==='SKILLS'&&prev&&!prev.heading&&prev.section===section;if(joinsProfile||joinsBullet||joinsSkill){prev.raw=`${prev.raw} ${value}`;prev.clean=clean(`${prev.clean} ${value}`);continue;}out.push({raw:bullet?`• ${value}`:value,clean:value,index,section,heading:false});}return out;}
function words(s=''){return [...new Set(clean(s).toLowerCase().replace(/[^a-z0-9+.# -]/g,' ').split(/\s+/).filter(x=>x.length>2))];}
function nums(s=''){return [...clean(s).matchAll(/(?:£|\$|€)?\b\d+(?:[.,]\d+)?(?:%|x|\+)?\b/gi)].map(m=>m[0].toLowerCase());}
function dateFacts(s=''){return [...clean(s).matchAll(/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{4}\b|\b(?:19|20)\d{2}\b/gi)].map(m=>m[0].toLowerCase());}
function properFacts(s=''){
  const toks=clean(s).match(/[A-Za-z][A-Za-z0-9+.#'-]*/g)||[];const out=[];
  for(let i=0;i<toks.length;i++){
    const t=toks[i];if(i===0&&COMMON_CAPITALIZED.has(t))continue;
    if(/^[A-Z]{2,}[A-Z0-9+.#-]*$/.test(t))out.push(t.toLowerCase());
    else if(i>0&&/^[A-Z][A-Za-z0-9+.#'-]{2,}$/.test(t)&&!COMMON_CAPITALIZED.has(t))out.push(t.toLowerCase());
  }
  return [...new Set(out)];
}
function scopeFacts(s=''){const text=clean(s);return SCOPE_GROUPS.filter(([,re])=>re.test(text)).map(([code])=>code);}
function missing(candidate,source){const have=new Set(source);return [...new Set(candidate)].filter(x=>!have.has(x));}
function overlap(a,b){const aw=words(a),bw=new Set(words(b));if(!aw.length)return 0;return aw.filter(x=>bw.has(x)).length/aw.length;}
function bestSupport(line,master){let best=null;for(const m of master){if(m.clean.toLowerCase()===line.clean.toLowerCase())return {...m,score:1,exact:true};const score=(overlap(line.clean,m.clean)+overlap(m.clean,line.clean))/2;if(!best||score>best.score)best={...m,score,exact:false};}return best;}
function issue(line,reason,support=null,details={}){return {line:line.clean,reason,supportLine:support?.clean||null,...details};}
function isHighValue(line){return BULLET.test(line.raw)||nums(line.clean).length>0||dateFacts(line.clean).length>0||properFacts(line.clean).length>0||line.clean.length>=35;}
const TOOLS=['python','sql','excel','bloomberg','reuters','refinitiv','mt4','mt5','vba','c++','power bi','tableau','matlab'];const ASSETS=['equities','equity','options','futures','derivatives','commodities','fixed income','forex','fx','crypto','digital assets','etf','securities lending','swaps'];const ACTION=/\b(?:managed|led|executed|traded|analysed|analyzed|monitored|built|developed|delivered|created|maintained|processed|mentored|improved|reconciled|identified|owned|oversaw)\b/i;const QUAL=['degree','msc','mba','bachelor','master','phd','cfa','cisi','epat','frm','caia','acca','series 7','series 55','series 63'];const SENIOR=['chief investment officer','director','head of','vice president','principal','senior'];
function canonicalTerm(x){const t=String(x).toLowerCase();if(['forex','fx'].includes(t))return'forex/fx';if(['equity','equities'].includes(t))return'equity';if(['crypto','digital assets'].includes(t))return'crypto/digital-assets';return t;}
function hasTerm(text,term){const source=String(text).toLowerCase(),needle=String(term).toLowerCase();if(!needle)return false;let from=0;while(true){const i=source.indexOf(needle,from);if(i<0)return false;const before=i===0?'':source[i-1],after=i+needle.length>=source.length?'':source[i+needle.length];if(!/[a-z0-9]/.test(before)&&!/[a-z0-9]/.test(after))return true;from=i+1;}}
function termFacts(s,list){const v=clean(s).toLowerCase();return [...new Set(list.filter(x=>hasTerm(v,x)).map(canonicalTerm))];}
function aggregateProfileSupported(line,masterText){const connectors=new Set('relevant experience includes in across with and the of to for a an role market markets professional experienced combining'.split(' ')),master=new Set(words(masterText)),candidate=words(line.clean).filter(x=>!connectors.has(x));return candidate.length===0||candidate.filter(x=>master.has(x)).length/candidate.length>=0.72;}
function globalFactIssues(masterText,tailoredText){const pseudo={clean:'whole CV'},out=[];const checks=[['NEW_NUMBER','new numeric claim',nums],['DATE_DRIFT','employment/date drift',dateFacts],['NEW_TOOL','new tool',s=>termFacts(s,TOOLS)],['NEW_ASSET_CLASS','new product or asset class',s=>termFacts(s,ASSETS)],['QUALIFICATION_DRIFT','education or qualification drift',s=>termFacts(s,QUAL)],['SENIORITY_INFLATION','seniority inflation',s=>termFacts(s,SENIOR)]];for(const [code,label,fn] of checks){const vals=missing(fn(tailoredText),fn(masterText));if(vals.length)out.push(issue(pseudo,label+': '+vals.join(', '),null,{code,values:vals}));}const scope=missing(scopeFacts(tailoredText),scopeFacts(masterText));if(scope.length)out.push(issue(pseudo,'unsupported scope inflation: '+scope.join(', '),null,{code:'SCOPE_INFLATION',values:scope}));return out;}

export function verifyTailored({masterText='',tailoredText=''}){
  const master=records(masterText),tailored=records(tailoredText),unsupported=[...globalFactIssues(masterText,tailoredText)];
  for(const line of tailored){
    const support=bestSupport(line,master);if(support?.exact)continue;
    if(HEADING.has(line.clean.toUpperCase())){unsupported.push(issue(line,'unsupported heading change',support));continue;}
    if(['PROFILE','SUMMARY','PROFESSIONAL SUMMARY'].includes(line.section)){if(aggregateProfileSupported(line,masterText))continue;unsupported.push(issue(line,'profile introduces meaning not sufficiently supported by Master CV evidence',support,{code:'PROFILE_MEANING_DRIFT'}));continue;}
    if(!support){unsupported.push(issue(line,'no source evidence line',null,{code:'NO_SOURCE_EVIDENCE'}));continue;}
    const newNums=missing(nums(line.clean),nums(support.clean));if(newNums.length){unsupported.push(issue(line,`new numeric claim: ${newNums.join(', ')}`,support,{code:'NEW_NUMBER',values:newNums}));continue;}
    const droppedNums=missing(nums(support.clean),nums(line.clean));if(droppedNums.length){unsupported.push(issue(line,`changed or removed numeric evidence: ${droppedNums.join(', ')}`,support,{code:'NUMBER_DRIFT',values:droppedNums}));continue;}
    const newDates=missing(dateFacts(line.clean),dateFacts(support.clean));if(newDates.length){unsupported.push(issue(line,`employment/date drift: ${newDates.join(', ')}`,support,{code:'DATE_DRIFT',values:newDates}));continue;}
    const newProper=missing(properFacts(line.clean),properFacts(support.clean)).filter(x=>!(x==='fx'&&/\bforex\b/i.test(support.clean))&&!(x==='pnl'&&/\bp\s*&\s*l\b/i.test(support.clean)));if(newProper.length){unsupported.push(issue(line,`unsupported employer/title/tool term: ${newProper.join(', ')}`,support,{code:'PROTECTED_FACT_DRIFT',values:newProper}));continue;}
    const newScope=missing(scopeFacts(line.clean),scopeFacts(support.clean));if(newScope.length){unsupported.push(issue(line,`unsupported scope inflation: ${newScope.join(', ')}`,support,{code:'SCOPE_INFLATION',values:newScope}));continue;}
    if(ACTION.test(line.clean)&&!ACTION.test(support.clean)&&support.score<0.7){unsupported.push(issue(line,'invented or materially changed responsibility',support,{code:'RESPONSIBILITY_DRIFT'}));continue;}
    if(line.clean.length<20){unsupported.push(issue(line,'changed short factual line without exact source support',support,{code:'SHORT_FACT_DRIFT'}));continue;}
    if(support.score<0.34)unsupported.push(issue(line,'insufficient evidence overlap',support,{code:'LOW_EVIDENCE_OVERLAP',score:Number(support.score.toFixed(3))}));
  }
  for(const source of master){
    if(HEADING.has(source.clean.toUpperCase())||!isHighValue(source))continue;
    const support=bestSupport(source,tailored);if(support?.exact)continue;
    if(!support||support.score<0.28)unsupported.push(issue(source,'deleted high-value evidence',support,{code:'DELETED_HIGH_VALUE_EVIDENCE',score:Number((support?.score||0).toFixed(3))}));
  }
  const dedup=[];const seen=new Set();for(const x of unsupported){const key=`${x.code||x.reason}|${x.line}|${x.supportLine||''}`;if(!seen.has(key)){seen.add(key);dedup.push(x);}}
  return {integrity:dedup.length===0?'PASS':'FAIL',unsupportedClaims:dedup};
}

export function verifyDraftFacts({draftText='',evidenceText=''}){const unsupported=globalFactIssues(evidenceText,draftText);return {integrity:unsupported.length?'FAIL':'PASS',unsupportedClaims:unsupported};}

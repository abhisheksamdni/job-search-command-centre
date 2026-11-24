import { sha256Text } from '../utils/hash.mjs';

const NOISE=[/^home$/i,/^careers?$/i,/^jobs?$/i,/^privacy$/i,/^cookie/i,/^terms/i,/^sign in$/i,/^log in$/i,/^share this job/i,/^similar jobs?/i,/^related jobs?/i,/^apply now$/i,/^back to jobs?/i,/^©/i,/^all rights reserved/i,/^follow us/i,/^job alerts?/i,/^search jobs?/i];
const NAMED={nbsp:' ',amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",'#39':"'",bull:'•',middot:'·',ndash:'–',mdash:'—',hellip:'…',laquo:'«',raquo:'»'};
const BLOCKED=new Set(['script','style','nav','header','footer','aside','form','button','svg','noscript','template']);
const VOID=new Set(['br','hr','img','input','meta','link','source','wbr']);

export function decodeEntitiesRepeated(value=''){
  let out=String(value??'');
  for(let pass=0;pass<8;pass++){
    const next=out.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi,(m,k)=>{
      const key=k.toLowerCase();
      if(key.startsWith('#x')){const n=parseInt(key.slice(2),16);return Number.isFinite(n)&&n>=0&&n<=0x10ffff?String.fromCodePoint(n):m;}
      if(key.startsWith('#')){const n=parseInt(key.slice(1),10);return Number.isFinite(n)&&n>=0&&n<=0x10ffff?String.fromCodePoint(n):m;}
      return Object.prototype.hasOwnProperty.call(NAMED,key)?NAMED[key]:m;
    });
    if(next===out)break;
    out=next;
  }
  return out;
}
function tagInfo(token=''){
  const m=String(token).match(/^<\s*(\/)?\s*([a-z0-9:-]+)([\s\S]*?)>$/i);
  if(!m)return null;
  const name=m[2].toLowerCase(),closing=Boolean(m[1]),attrs=m[3]||'',selfClosing=/\/\s*>$/.test(token)||VOID.has(name);
  return {name,closing,attrs,selfClosing};
}
function attrNumber(attrs,name,fallback){const m=String(attrs).match(new RegExp('\\b'+name+'\\s*=\\s*["\\\']?(\\d+)','i'));return m?Number(m[1]):fallback;}
function stripDangerousBlocks(source=''){
  let s=String(source);
  for(const tag of BLOCKED)s=s.replace(new RegExp('<'+tag+'\\b[^>]*>[\\s\\S]*?<\\/'+tag+'\\s*>','gi'),'\n');
  return s.replace(/<!--[\s\S]*?-->/g,' ');
}
function collapseTextToken(token=''){return decodeEntitiesRepeated(token).replace(/[\t\r\n ]+/g,' ').trim();}
export function semanticHtmlToText(raw=''){
  const decoded=decodeEntitiesRepeated(raw),source=stripDangerousBlocks(decoded);
  const tokens=source.match(/<[^>]*>|[^<]+/g)||[source];
  const out=[];const lists=[];let blockedDepth=0,headingDepth=0;
  const newline=(count=1)=>{for(let n=0;n<count;n++){if(out.length&&!String(out[out.length-1]).endsWith('\n'))out.push('\n');else if(n&&out.length&&String(out[out.length-1])==='\n')out.push('\n');}};
  const append=text=>{if(!text)return;const prev=out[out.length-1]||'';if(prev&&prev!=='\n'&&!/[\s([{\-–—/]$/.test(prev)&&!/^\s*[,.;:!?)]/.test(text))out.push(' ');out.push(text);};
  for(const token of tokens){
    if(token.startsWith('<')){
      const t=tagInfo(token);if(!t)continue;
      if(blockedDepth){if(!t.closing&&!t.selfClosing)blockedDepth++;else if(t.closing)blockedDepth=Math.max(0,blockedDepth-1);continue;}
      if(!t.closing&&BLOCKED.has(t.name)){blockedDepth=1;continue;}
      if(/^h[1-6]$/.test(t.name)){if(!t.closing){newline(2);append('## ');headingDepth++;}else{headingDepth=Math.max(0,headingDepth-1);newline(2);}continue;}
      if(t.name==='br'||t.name==='hr'){newline(1);continue;}
      if(t.name==='ul'&&!t.closing){newline(1);lists.push({type:'ul',count:0});continue;}
      if(t.name==='ol'&&!t.closing){newline(1);lists.push({type:'ol',count:attrNumber(t.attrs,'start',1)-1});continue;}
      if((t.name==='ul'||t.name==='ol')&&t.closing){lists.pop();newline(1);continue;}
      if(t.name==='li'&&!t.closing){newline(1);const top=lists[lists.length-1];if(top?.type==='ol'){top.count++;append(`${top.count}. `);}else append('- ');continue;}
      if(t.name==='li'&&t.closing){newline(1);continue;}
      if(['p','div','section','article','main','tr'].includes(t.name)){newline(t.closing?2:1);continue;}
      if(['td','th'].includes(t.name)){if(t.closing)append(' | ');continue;}
      continue;
    }
    if(blockedDepth)continue;
    const text=collapseTextToken(token);if(text)append(text);
  }
  return decodeEntitiesRepeated(out.join(''));
}
function normalizeLine(raw=''){
  let x=String(raw).replace(/\u00a0/g,' ').replace(/[\t ]+/g,' ').trim();
  if(/^#{1,6}\s*/.test(x))x='## '+x.replace(/^#{1,6}\s*/,'').trim();
  if(/^[-•▪◦]\s*/.test(x))x='- '+x.replace(/^[-•▪◦]\s*/,'').trim();
  if(/^\d+[.)]\s*/.test(x)){const m=x.match(/^(\d+)[.)]\s*(.*)$/);x=`${m[1]}. ${m[2].trim()}`;}
  return x;
}
function isNoise(line){const plain=line.replace(/^##\s*|^-\s*|^\d+\.\s*/,'').trim();return NOISE.some(rx=>rx.test(plain));}
function squash(lines){
  const out=[];for(const line of lines){if(!line){if(out.length&&out[out.length-1]!=='')out.push('');continue;}if(out.length&&out[out.length-1]===line&&/^[-\d]/.test(line))continue;out.push(line);}
  while(out[0]==='')out.shift();while(out[out.length-1]==='')out.pop();return out;
}
export function cleanJd(raw=''){
  const decoded=decodeEntitiesRepeated(raw);
  const hasHtml=/<\s*\/?\s*[a-z][^>]*>/i.test(decoded);
  const text=hasHtml?semanticHtmlToText(decoded):decoded;
  const lines=squash(text.split(/\r?\n/).map(normalizeLine).filter(x=>!x||!isNoise(x)));
  const clean=lines.join('\n').replace(/\n{3,}/g,'\n\n').trim();
  const words=clean.replace(/^##\s*|^-\s*|^\d+\.\s*/gm,'').split(/\s+/).filter(Boolean).length;
  const requirementSignal=/requirements?|qualifications?|experience|skills?|responsibilit/i.test(clean);
  const quality=words>=120&&requirementSignal?'GOOD':words>=60?'REVIEW':'POOR';
  return {jdClean:clean,jdCleanHash:sha256Text(clean),jdQuality:quality,wordCount:words};
}
export function recleanStoredJob(db,jobId){
  const id=Number(jobId),latest=db.prepare('SELECT * FROM job_jd_versions WHERE job_id=? ORDER BY id DESC LIMIT 1').get(id);
  if(!latest)throw new Error('No stored JD available to re-clean');
  const cleaned=cleanJd(latest.jd_raw);
  if(cleaned.jdCleanHash===latest.jd_clean_hash&&cleaned.jdClean===latest.jd_clean)return {jobId:id,jdVersionId:latest.id,changed:false,sourceVersionId:latest.id,...cleaned};
  const existing=db.prepare('SELECT * FROM job_jd_versions WHERE job_id=? AND jd_clean_hash=? ORDER BY id DESC LIMIT 1').get(id,cleaned.jdCleanHash);
  if(existing)return {jobId:id,jdVersionId:existing.id,changed:false,sourceVersionId:latest.id,reusedExisting:true,...cleaned};
  const r=db.prepare('INSERT INTO job_jd_versions(job_id,jd_raw,jd_clean,jd_clean_hash,jd_quality) VALUES (?,?,?,?,?)').run(id,latest.jd_raw,cleaned.jdClean,cleaned.jdCleanHash,cleaned.jdQuality);
  return {jobId:id,jdVersionId:Number(r.lastInsertRowid),changed:true,sourceVersionId:latest.id,...cleaned};
}

import { verifyTailored } from './integrity.mjs';
import { auditHumanWriting,humanizeGeneratedText } from './textHumanizer.mjs';

const HEADINGS=new Set(['PROFILE','SUMMARY','PROFESSIONAL SUMMARY','WORK EXPERIENCE','EXPERIENCE','EDUCATION','SKILLS','CERTIFICATIONS','CERTIFICATES','PROJECTS','ACHIEVEMENTS','AWARDS']);
const BULLET=/^(\s*[•●▪◦*-]\s+)(.*)$/;
function isHeading(line=''){const t=line.trim();return HEADINGS.has(t.toUpperCase())||(t.length>2&&t.length<55&&t===t.toUpperCase()&&/[A-Z]/.test(t)&&!/[.!?]$/.test(t));}
function setting(db,key,fallback=''){try{return db?.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value??fallback;}catch{return fallback;}}
function nums(s=''){return [...String(s).matchAll(/(?:£|\$|€)?\b\d+(?:[.,]\d+)?(?:%|x|\+)?\b/gi)].map(m=>m[0]);}
function sameNumericFacts(before,after){const a=nums(before).sort(),b=nums(after).sort();return a.length===b.length&&a.every((x,i)=>x===b[i]);}
function uniqueRequirements(requirements=[]){return requirements.slice().sort((a,b)=>({MANDATORY:0,CORE:1,IMPORTANT:2,PREFERRED:3,BONUS:4,BEHAVIOURAL:5}[a.category]??9)-({MANDATORY:0,CORE:1,IMPORTANT:2,PREFERRED:3,BONUS:4,BEHAVIOURAL:5}[b.category]??9)).slice(0,12).map(r=>`[${r.category}] ${r.text}`);}

export function normalizeLoopbackWriterUrl(raw='http://127.0.0.1:11434'){
  let u;try{u=new URL(String(raw||''));}catch{throw new Error('Local writer URL is invalid');}
  if(u.protocol!=='http:')throw new Error('Local writer must use loopback HTTP');
  if(u.username||u.password)throw new Error('Local writer URL must not contain credentials');
  const host=u.hostname.toLowerCase();if(!['localhost','127.0.0.1','[::1]','::1'].includes(host))throw new Error('Local writer endpoint must be localhost/loopback');
  if(u.pathname!=='/'||u.search||u.hash)throw new Error('Local writer URL must be the Ollama loopback origin');
  return u.origin;
}
async function installedModels(baseUrl,fetchImpl){const r=await fetchImpl(`${baseUrl}/api/tags`,{signal:AbortSignal.timeout(1800)});if(!r.ok)throw new Error(`Ollama tags HTTP ${r.status}`);const j=await r.json();return (j.models||[]).map(x=>x.name).filter(Boolean);}
function chooseModel(models,preferred=''){if(preferred&&models.includes(preferred))return preferred;if(preferred)return null;return models.find(x=>/(?:qwen|llama|gemma|mistral|phi)/i.test(x))||models[0]||null;}
export async function localWriterStatus(db=null,{fetchImpl=globalThis.fetch}={}){
  const enabled=setting(db,'local_writer_enabled','0')==='1';const configured=setting(db,'local_writer_url','http://127.0.0.1:11434');const preferred=setting(db,'local_writing_model','');
  if(!enabled)return {enabled:false,available:false,provider:'OLLAMA_LOCAL',baseUrl:null,model:null,models:[],preferred:preferred||null,reason:'Local writer disabled'};
  let baseUrl;try{baseUrl=normalizeLoopbackWriterUrl(configured);}catch(e){return {enabled:true,available:false,provider:'OLLAMA_LOCAL',baseUrl:null,model:null,models:[],preferred:preferred||null,reason:e.message};}
  try{const models=await installedModels(baseUrl,fetchImpl);const model=chooseModel(models,preferred);return {enabled:true,available:Boolean(model),provider:'OLLAMA_LOCAL',baseUrl,model,models,preferred:preferred||null,reason:model?null:preferred?'Configured model is not installed':'No local model installed'};}catch(e){return {enabled:true,available:false,provider:'OLLAMA_LOCAL',baseUrl,model:null,models:[],preferred:preferred||null,reason:e.message};}
}

async function generateJson({baseUrl,model,prompt,fetchImpl}){const r=await fetchImpl(`${baseUrl}/api/generate`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model,prompt,stream:false,format:'json',options:{temperature:0.1}}),signal:AbortSignal.timeout(45000)});if(!r.ok)throw new Error(`Local writer HTTP ${r.status}`);const j=await r.json();const raw=String(j.response||'').trim();if(!raw)throw new Error('Local writer returned an empty response');let parsed;try{parsed=JSON.parse(raw);}catch{throw new Error('Local writer returned invalid JSON');}return parsed;}
function promptForLine({source,requirements,kind,regionalEnglish='British English'}){return `You are rewriting one line of a real candidate CV.\n\nSOURCE LINE (the only factual evidence for this line):\n${source}\n\nROLE REQUIREMENTS (context only; never turn a requirement into candidate experience):\n${uniqueRequirements(requirements).join('\n')}\n\nRules:\n- Preserve every fact, number, employer/product/tool and level of certainty in the source.\n- Never add an achievement, metric, responsibility, technology, qualification or experience not present in SOURCE LINE.\n- Use ${regionalEnglish}.\n- Keep the candidate's vocabulary where it already works.\n- Remove filler and corporate language. No generic enthusiasm, rule-of-three phrasing, canned transitions or AI-style framing.\n- ${kind==='BULLET'?'Use a natural Google XYZ structure when the source already contains a real measurable Y: Accomplished X, as measured by Y, by doing Z. If the source has no metric, do not invent one; use a concise action + scope/method + result/responsibility form.':'Keep the profile line concise and role-relevant without adding new claims.'}\n- Keep length close to the source so the original CV layout remains stable.\n- If rewriting would risk changing meaning, return the source wording unchanged.\n\nReturn JSON only: {"text":"..."}`;}

export async function rewriteCvWithLocalModel({db=null,cvText='',requirements=[],regionalEnglish='British English',fetchImpl=globalThis.fetch}={}){
 const status=await localWriterStatus(db,{fetchImpl});if(!status.available)return {available:false,used:false,status,text:cvText,rewriteMap:{},changes:[],attempted:0,fallbackReason:status.reason};
 const lines=String(cvText||'').replace(/\r\n?/g,'\n').split('\n');let inProfile=false;const rewriteMap={},changes=[];let attempted=0;
 for(let i=0;i<lines.length;i++){
  const raw=lines[i],trim=raw.trim();if(isHeading(raw)){inProfile=['PROFILE','SUMMARY','PROFESSIONAL SUMMARY'].includes(trim.toUpperCase());continue;}
  const m=raw.match(BULLET);const kind=m?'BULLET':inProfile&&trim.length>=20?'PROFILE':null;if(!kind)continue;const prefix=m?m[1]:'';const source=(m?m[2]:trim).trim();if(source.length<20)continue;attempted++;
  try{const parsed=await generateJson({baseUrl:status.baseUrl,model:status.model,prompt:promptForLine({source,requirements,kind,regionalEnglish}),fetchImpl});let candidate=String(parsed.text||'').replace(/^\s*[•●▪◦*-]\s+/,'').trim();candidate=humanizeGeneratedText(candidate,{domain:'CV'}).trim();if(!candidate||candidate===source)continue;if(candidate.length>Math.max(source.length*1.45,source.length+45))continue;if(!sameNumericFacts(source,candidate))continue;const check=verifyTailored({masterText:source,tailoredText:candidate});if(check.integrity!=='PASS')continue;const audit=auditHumanWriting(candidate);if(audit.findings.includes('tool_residue')||audit.findings.includes('placeholder'))continue;lines[i]=prefix+candidate;rewriteMap[source]=candidate;changes.push({line:i+1,kind,before:source,after:candidate});}catch{}
 }
 const text=lines.join('\n');const whole=verifyTailored({masterText:cvText,tailoredText:text});if(whole.integrity!=='PASS')return {available:true,used:false,status,text:cvText,rewriteMap:{},changes:[],attempted,fallbackReason:'Whole-CV integrity validation failed'};
 return {available:true,used:changes.length>0,status,text,rewriteMap,changes,attempted,fallbackReason:changes.length?'': 'Local model made no verified safe changes'};
}

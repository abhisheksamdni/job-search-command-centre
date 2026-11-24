import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { paths } from '../src/paths.mjs';
const execFileAsync=promisify(execFile);

function pythonCandidates(){return process.platform==='win32'?['python','py']:['python3','python'];}
function pythonEnv(){
  const local=path.join(paths.upstreamRoot,'Agent-Reach');
  if(!fs.existsSync(path.join(local,'agent_reach')))return process.env;
  const key=process.platform==='win32'?'PYTHONPATH':'PYTHONPATH';
  return {...process.env,[key]:[local,process.env[key]||''].filter(Boolean).join(path.delimiter)};
}
function boundedTimeout(v,fallback){const n=Number(v);return Math.max(1,Number.isFinite(n)?n:fallback);}
async function pythonExec(code,{timeout=15000,maxBuffer=1024*1024}={}){
  let last;for(const cmd of pythonCandidates()){
    try{return await execFileAsync(cmd,['-c',code],{timeout:boundedTimeout(timeout,15000),windowsHide:true,maxBuffer,env:pythonEnv()});}catch(e){last=e;}
  }
  throw last||new Error('Python unavailable');
}

export async function agentReachDoctor({timeoutMs=15000}={}){
  const timeout=boundedTimeout(timeoutMs,15000);
  try{const {stdout}=await execFileAsync('agent-reach',['doctor','--json'],{timeout,windowsHide:true,maxBuffer:1024*1024});return {available:true,mode:'cli',details:JSON.parse(stdout)};}catch(cliError){
    try{await pythonExec("from agent_reach.channels.web import WebChannel; print('ok')",{timeout});return {available:true,mode:'local-python',details:{web:true,upstream:path.join(paths.upstreamRoot,'Agent-Reach')}};}catch(pyError){return {available:false,error:pyError.code||pyError.message||cliError.code||cliError.message};}
  }
}
export async function readWithAgentReach(url,{timeoutMs=45000}={}){
  const py=`from agent_reach.channels.web import WebChannel\nprint(WebChannel().read(${JSON.stringify(url)}))`;
  try{const {stdout}=await pythonExec(py,{timeout:boundedTimeout(timeoutMs,45000),maxBuffer:6*1024*1024});return stdout;}catch(e){throw new Error(`Agent Reach unavailable: ${e?.message||'unknown error'}`);}
}
export async function searchWithAgentReach(query,{numResults=8,timeoutMs=45000}={}){
  const q=String(query||'').trim();if(!q)throw new Error('Agent Reach search query is required');
  try{
    const {stdout}=await execFileAsync('mcporter',['call','exa.web_search_exa',`query=${q}`,`numResults=${Math.max(1,Math.min(20,Number(numResults)||8))}`],{timeout:boundedTimeout(timeoutMs,45000),windowsHide:true,maxBuffer:6*1024*1024});
    return String(stdout||'');
  }catch(e){throw new Error(`Agent Reach search unavailable: ${e?.message||'mcporter/Exa not configured'}`);}
}
export function parseAgentReachJobLinks(markdown='',baseUrl='',company=''){let base;try{base=new URL(baseUrl);}catch{return [];}const seen=new Set();const out=[];const re=/\[([^\]\n]{3,180})\]\((https?:\/\/[^)\s]+)\)/g;let m;while((m=re.exec(markdown))){const title=m[1].replace(/\s+/g,' ').trim();let u;try{u=new URL(m[2],base);}catch{continue;}const p=`${u.pathname}${u.search}`.toLowerCase();if(!/(?:\/jobs?(?:\/|\?|$)|\/careers?(?:\/|\?|$)|\/vacanc(?:y|ies)|\/positions?|\/opportunities?|jobid=|gh_jid=|jobreq|requisition)/i.test(p))continue;if(/privacy|cookie|login|about|contact|terms/i.test(title))continue;const key=u.toString().replace(/#.*$/,'');if(seen.has(key))continue;seen.add(key);out.push({title,company,location:'',locationStatus:'LOCATION_UNVERIFIED',sourceUrl:key,applicationUrl:key,jdRaw:''});if(out.length>=250)break;}return out;}
export function markdownToJobDetail(markdown='',url='',company='',title=''){const text=String(markdown).replace(/^Title:.*$/gmi,'').replace(/^URL Source:.*$/gmi,'').replace(/^Markdown Content:\s*$/gmi,'').replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[`*_>#]/g,'').replace(/\n{3,}/g,'\n\n').trim();return {title,company,location:'',locationStatus:'LOCATION_UNVERIFIED',sourceUrl:url,applicationUrl:url,jdRaw:text.slice(0,120000)};}
export async function scanWithAgentReach({url,company='',timeoutMs=45000}){return parseAgentReachJobLinks(await readWithAgentReach(url,{timeoutMs}),url,company);}
export async function readJobWithAgentReach({url,company='',title='',timeoutMs=45000}){return markdownToJobDetail(await readWithAgentReach(url,{timeoutMs}),url,company,title);}

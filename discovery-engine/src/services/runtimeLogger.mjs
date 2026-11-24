import fs from 'node:fs';
import path from 'node:path';
import { paths } from '../paths.mjs';

const SENSITIVE_KEY=/(?:^|_)(?:cv|jd|body|text|answer|password|credential|cookie|token|secret|authorization)(?:_|$)|^(?:cv|jd)(?:body|raw|text|content)$|(?:password|credential|cookie|token|secret|authorization|privateanswer)/i;
const TOKENISH=/(github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._~+/=-]{12,})/gi;
function safeString(value){return String(value??'').replace(TOKENISH,'[REDACTED]').slice(0,500);}
function sanitize(value,key='',depth=0){
  if(SENSITIVE_KEY.test(key))return '[REDACTED]';
  if(value===null||value===undefined||typeof value==='boolean'||typeof value==='number')return value;
  if(typeof value==='string')return safeString(value);
  if(depth>=2)return '[TRUNCATED]';
  if(Array.isArray(value))return value.slice(0,20).map((v,i)=>sanitize(v,String(i),depth+1));
  if(typeof value==='object'){const out={};for(const [k,v] of Object.entries(value).slice(0,40))out[k]=sanitize(v,k,depth+1);return out;}
  return safeString(value);
}
function logPath(){return path.join(paths.logs,'jcc.log');}
export function logRuntimeEvent(event,metadata={}){try{fs.mkdirSync(paths.logs,{recursive:true});const clean=sanitize(metadata);const record={timestamp:new Date().toISOString(),event:safeString(event),...(clean&&typeof clean==='object'?clean:{})};fs.appendFileSync(logPath(),JSON.stringify(record)+'\n','utf8');return record;}catch{return null;}}
export const logRuntimeEventSync=logRuntimeEvent;
export function readRuntimeLog(limit=400){const file=logPath();if(!fs.existsSync(file))return [];const n=Math.max(1,Math.min(2000,Number(limit)||400));return fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean).slice(-n);}
export function runtimeLogPath(){return logPath();}

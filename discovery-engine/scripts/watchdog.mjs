import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { paths } from '../src/paths.mjs';
import { logRuntimeEvent } from '../src/services/runtimeLogger.mjs';

const pidFile=path.join(paths.logs,'watchdog.pid');
const logFile=path.join(paths.logs,'watchdog.log');
const intentionalStopFile=path.join(paths.logs,'intentional-stop.marker');
const maintenanceFile=path.join(paths.logs,'maintenance.lock');
const healthUrl='http://127.0.0.1:8787/api/health';
function existsPid(pid){try{process.kill(Number(pid),0);return true;}catch(e){return e.code==='EPERM';}}
function append(event,meta={}){fs.mkdirSync(paths.logs,{recursive:true});fs.appendFileSync(logFile,JSON.stringify({timestamp:new Date().toISOString(),event,...meta})+'\n','utf8');}
function claim(){try{if(fs.existsSync(pidFile)){const old=Number(fs.readFileSync(pidFile,'utf8').trim());if(old&&existsPid(old))return false;fs.rmSync(pidFile,{force:true});}fs.writeFileSync(pidFile,String(process.pid),'utf8');return true;}catch{return false;}}
function release(){try{if(Number(fs.readFileSync(pidFile,'utf8').trim())===process.pid)fs.rmSync(pidFile,{force:true});}catch{}}
export async function probeJcc({fetchFn=fetch,url=healthUrl}={}){try{const r=await fetchFn(url,{signal:AbortSignal.timeout(3000)});if(!r.ok)return {ok:false,status:r.status};const j=await r.json();return {ok:Boolean(j?.ok&&String(j?.version||'').startsWith('2.0.0-alpha.4')),version:j?.version||null};}catch(e){return {ok:false,error:e?.code||e?.name||e?.message||'unavailable'};}}
export function watchdogDecision({healthy,intentionalStop=false,maintenance=false,autoRestart=false}){if(intentionalStop)return {action:'INTENTIONAL_STOP'};if(maintenance)return {action:'MAINTENANCE'};if(healthy)return {action:'HEALTHY'};return {action:autoRestart?'RESTART':'OFFLINE'};}
export function readAutoRestartSetting(){try{if(!fs.existsSync(paths.dbPath))return false;const db=new DatabaseSync(paths.dbPath,{readOnly:true});const v=db.prepare("SELECT value FROM settings WHERE key='watchdog_auto_restart'").get()?.value;db.close();return String(v||'0')==='1';}catch{return false;}}
function restartJcc(){if(process.platform!=='win32')return false;try{const child=spawn('cmd.exe',['/d','/s','/c','start-jcc.bat'],{cwd:paths.repoRoot,detached:true,stdio:'ignore',windowsHide:true});child.unref();return true;}catch{return false;}}
export async function runWatchdogCycle({fetchFn=fetch,autoRestart=readAutoRestartSetting(),restartFn=restartJcc,intentionalStop=fs.existsSync(intentionalStopFile),maintenance=fs.existsSync(maintenanceFile)}={}){
 const health=await probeJcc({fetchFn});const decision=watchdogDecision({healthy:health.ok,intentionalStop,maintenance,autoRestart});
 if(decision.action==='INTENTIONAL_STOP'){append('INTENTIONAL_STOP');return {...decision,health};}
 if(decision.action==='MAINTENANCE'){append('MAINTENANCE');return {...decision,health};}
 if(decision.action==='HEALTHY')return {...decision,health};
 append('OFFLINE',{error:health.error||health.status||null});logRuntimeEvent('WATCHDOG_WARNING',{reason:'JCC_OFFLINE',error:health.error||health.status||null});
 if(decision.action==='RESTART'){const restarted=Boolean(restartFn());append(restarted?'RESTART_REQUESTED':'RESTART_FAILED');if(restarted)logRuntimeEvent('WATCHDOG_RECOVERY',{action:'SAFE_RESTART_REQUESTED'});return {...decision,health,restarted};}
 return {...decision,health};
}
async function daemon(){
 fs.mkdirSync(paths.logs,{recursive:true});if(!claim())return;append('WATCHDOG_START',{pid:process.pid});let tick=0,wasOffline=false;
 const cleanup=()=>{append('WATCHDOG_STOP');release();};process.on('SIGTERM',()=>{cleanup();process.exit(0)});process.on('SIGINT',()=>{cleanup();process.exit(0)});process.on('exit',release);
 while(true){const result=await runWatchdogCycle();if(result.action==='INTENTIONAL_STOP'){cleanup();return;}if(result.action==='HEALTHY'){if(wasOffline){append('RECOVERED');logRuntimeEvent('WATCHDOG_RECOVERY',{action:'HEALTH_RESTORED'});}wasOffline=false;if(tick%20===0)append('HEALTHY',{version:result.health.version});}else if(result.action==='OFFLINE'||result.action==='RESTART'){wasOffline=true;}tick++;await new Promise(r=>setTimeout(r,15000));}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)daemon().catch(e=>{append('WATCHDOG_FATAL',{error:e.message});release();process.exit(1)});

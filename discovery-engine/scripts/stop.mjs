import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { paths } from '../src/paths.mjs';
import { logRuntimeEvent } from '../src/services/runtimeLogger.mjs';

const pidFile=path.join(paths.logs,'jcc.pid');
const intentionalStopFile=path.join(paths.logs,'intentional-stop.marker');
const statusOnly=process.argv.includes('--status');

function readRecord(){
  if(!fs.existsSync(pidFile))return null;
  const text=fs.readFileSync(pidFile,'utf8').trim();
  try{
    const record=JSON.parse(text);
    if(!Number.isInteger(Number(record.pid))||Number(record.pid)<=0)throw new Error('invalid pid');
    return {...record,pid:Number(record.pid)};
  }catch{
    throw new Error('Legacy or invalid JCC PID file. Refusing to signal an unverified process. Remove it only after confirming JCC is stopped.');
  }
}
function commandLineFor(pid){
  if(process.platform==='win32'){
    const script=`$p=Get-CimInstance Win32_Process -Filter \"ProcessId=${pid}\" -ErrorAction SilentlyContinue; if($p){[Console]::Out.Write($p.CommandLine)}`;
    const r=spawnSync('powershell.exe',['-NoProfile','-Command',script],{encoding:'utf8',windowsHide:true,timeout:5000});
    return r.status===0?(r.stdout||''):'';
  }
  try{return fs.readFileSync(`/proc/${pid}/cmdline`,'utf8').replaceAll('\0',' ');}catch{return '';}
}
function processExists(pid){try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}}
function isOwned(record){if(path.resolve(String(record.repoRoot||''))!==path.resolve(paths.repoRoot))return false;if(!processExists(record.pid))return false;const cmd=commandLineFor(record.pid);if(!cmd)return false;const norm=cmd.replaceAll('\\','/').toLowerCase();return norm.includes('node')&&norm.includes('src/server.mjs');}
function cleanupStale(){try{fs.rmSync(pidFile,{force:true});}catch{}}
function markIntentionalStop(){try{fs.mkdirSync(paths.logs,{recursive:true});fs.writeFileSync(intentionalStopFile,new Date().toISOString(),'utf8');}catch{}}

const record=readRecord();
if(!record){if(!statusOnly)markIntentionalStop();console.log('JCC is not running (PID file absent).');process.exit(0);}
if(!processExists(record.pid)){if(!statusOnly)markIntentionalStop();cleanupStale();console.log(`JCC is not running (removed stale PID ${record.pid}).`);process.exit(0);}
if(!isOwned(record)){console.error(`REFUSED: PID ${record.pid} is not verifiably the JCC server for ${paths.repoRoot}. No process was signalled.`);process.exit(2);}
if(statusOnly){console.log(`JCC server verified at PID ${record.pid}.`);process.exit(0);}
markIntentionalStop();logRuntimeEvent('JCC_STOP',{pid:record.pid,reason:'intentional-stop-request'});
try{process.kill(record.pid,'SIGTERM');}catch(e){if(e.code==='ESRCH'){cleanupStale();console.log('JCC process already stopped.');process.exit(0);}throw e;}
const deadline=Date.now()+7000;while(Date.now()<deadline&&processExists(record.pid))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100);
if(processExists(record.pid)){console.error(`ERROR: JCC PID ${record.pid} did not stop after SIGTERM. No force-kill was attempted.`);process.exit(3);}
cleanupStale();console.log(`JCC stopped cleanly (PID ${record.pid}).`);

import fs from 'node:fs';
import { chromium } from 'playwright';
import { runDiscovery } from './discovery/service.mjs';
import { activeMasterCv } from './services/cvLibrary.mjs';
import { discoveryState } from './services/discoveryReadModel.mjs';
import { logRuntimeEvent,logRuntimeEventSync } from './services/runtimeLogger.mjs';

let lifecycleRegistered=false,lifecycleStarted=false;
export class LocalScheduler {
  constructor(db,{providers={}}={}){
    this.db=db;this.providers=providers;this.timer=null;this.running=false;this.lastRun=null;this.nextRun=null;this.cancelRequested=false;
    if(!lifecycleRegistered){lifecycleRegistered=true;process.once('exit',()=>logRuntimeEventSync('JCC_STOP',{pid:process.pid}));}
  }
  settings(){const rows=this.db.prepare("SELECT key,value FROM settings WHERE key IN ('mode','auto_enabled','auto_every_hours','auto_on_startup','auto_prepare_enabled','auto_contact_research','manual_search_soft_limit_minutes','manual_search_hard_limit_minutes','discovery_stall_seconds','source_circuit_breaker_failures')").all();return Object.fromEntries(rows.map(r=>[r.key,r.value]));}
  state(){return discoveryState(this.db,{running:this.running,cancelRequested:this.cancelRequested,lastRun:this.lastRun,nextRun:this.nextRun,lastAutoPrep:null,settings:this.settings()});}
  preflight(mode='MANUAL'){
    const sourceCount=Number(this.db.prepare('SELECT count(*) n FROM sources WHERE enabled=1').get().n);const roleCount=Number(this.db.prepare('SELECT count(*) n FROM target_roles WHERE enabled=1').get().n);const locationCount=Number(this.db.prepare('SELECT count(*) n FROM target_locations WHERE enabled=1').get().n);const integrity=this.db.prepare('PRAGMA integrity_check').get()?.integrity_check||'unknown';
    let chromiumOk=false;try{chromiumOk=fs.existsSync(chromium.executablePath());}catch{}
    const master=activeMasterCv(this.db);const warnings=[];if(!master)warnings.push('Jobs can be discovered, but Recruiter/ATS scoring requires an Active Master CV. Application production begins only after SEND.');
    const errors=[];if(this.running)errors.push('Discovery already running');if(sourceCount===0)errors.push('Cannot start search: no discovery sources are enabled.');if(roleCount===0)errors.push('Cannot start search: no target roles are enabled.');if(locationCount===0)errors.push('Cannot start search: no target locations are enabled.');if(integrity!=='ok')errors.push(`Cannot start search: SQLite integrity check returned ${integrity}.`);if(!chromiumOk)errors.push('Cannot start search: Playwright Chromium is not available. Run install.bat.');
    return {ok:errors.length===0,mode,errors,warnings,processHealthy:process.pid>0,sqlite:integrity,activeMasterPresent:Boolean(master),activeMasterVersionId:master?.id||null,enabledSources:sourceCount,enabledRoles:roleCount,enabledLocations:locationCount,playwrightAvailable:true,chromiumAvailable:chromiumOk,agentReachStatus:'CHECK_ONCE_AT_RUN_START'};
  }
  async trigger(mode='MANUAL',{preflight=null}={}){
    if(this.running){const e=new Error('Discovery already running');e.code='DISCOVERY_ALREADY_RUNNING';throw e;}
    const pf=preflight||this.preflight(mode);if(!pf.ok){const e=new Error(pf.errors[0]||'Discovery pre-flight failed');e.code='DISCOVERY_PREFLIGHT_FAILED';e.preflight=pf;throw e;}
    this.running=true;this.cancelRequested=false;
    try{
      const discovery=await runDiscovery(this.db,{mode,shouldCancel:()=>this.cancelRequested,providers:this.providers,preflight:pf});
      this.lastRun=new Date().toISOString();
      return {...discovery,preflight:pf};
    }finally{this.running=false;this.computeNext();}
  }
  cancel(){if(!this.running)return false;this.cancelRequested=true;return true;}
  computeNext(){const s=this.settings();if(s.mode!=='AUTO'||s.auto_enabled!=='1'){this.nextRun=null;return;}const h=Math.max(1,Number(s.auto_every_hours||3));this.nextRun=new Date(Date.now()+h*3600000).toISOString();}
  start(){
    if(!lifecycleStarted){lifecycleStarted=true;logRuntimeEvent('JCC_START',{pid:process.pid});}
    this.stop();const s=this.settings();if(s.mode!=='AUTO'||s.auto_enabled!=='1'){this.nextRun=null;return;}const hours=Math.max(1,Number(s.auto_every_hours||3));this.computeNext();this.timer=setInterval(()=>this.trigger('AUTO').catch(e=>logRuntimeEvent('DISCOVERY_FAILED',{mode:'AUTO',error:e.message})),hours*3600000);if(s.auto_on_startup==='1')setTimeout(()=>this.trigger('AUTO').catch(e=>logRuntimeEvent('DISCOVERY_FAILED',{mode:'AUTO',error:e.message})),1500);
  }
  stop(){if(this.timer)clearInterval(this.timer);this.timer=null;}
}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'jcc-discovery-supervisor-'));
process.env.JCC_ROOT=root;
const { DatabaseSync }=await import('node:sqlite');
const { initFolders }=await import('../src/initFolders.mjs');
const { migrate }=await import('../src/migrate.mjs');
const { seed }=await import('../src/seed.mjs');
const { importCv }=await import('../src/services/cvLibrary.mjs');
const { dashboardReadModel }=await import('../src/services/dashboardReadModel.mjs');
const { discoveryState,discoveryHistory,discoveryRunDetail }=await import('../src/services/discoveryReadModel.mjs');
const { planSourceQueries }=await import('../src/discovery/queryPlanner.mjs');
const { runDiscovery }=await import('../src/discovery/service.mjs');
const { onboardSource }=await import('../src/services/sourceOnboarding.mjs');
const { seedSystemSources,SYSTEM_SOURCES,verifySystemSources }=await import('../src/services/systemSources.mjs');
const { LocalScheduler }=await import('../src/scheduler.mjs');
const { logRuntimeEvent,readRuntimeLog,runtimeLogPath }=await import('../src/services/runtimeLogger.mjs');
const { handleAlpha4Api }=await import('../src/alpha4Api.mjs');
const { probeJcc,watchdogDecision,runWatchdogCycle }=await import('../scripts/watchdog.mjs');
const { paths }=await import('../src/paths.mjs');
initFolders();

function db(){const d=new DatabaseSync(':memory:');d.exec('PRAGMA foreign_keys=ON');migrate(d);seed(d);return d;}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function keepOnly(d,names=[]){const qs=names.map(()=>'?').join(',');if(names.length)d.prepare(`UPDATE sources SET enabled=CASE WHEN name IN (${qs}) THEN 1 ELSE 0 END`).run(...names);else d.exec('UPDATE sources SET enabled=0');}
function addSource(d,name,url){return onboardSource(d,{name,baseUrl:url,company:name,kind:'AUTO',ownership:'USER_ADDED'}).sourceId;}
function job(company='Supervisor Test Co'){return {company,title:'Trading Analyst',location:'London, United Kingdom',sourceUrl:`https://${company.toLowerCase().replace(/[^a-z]+/g,'')}.example/jobs/1`,applicationUrl:`https://${company.toLowerCase().replace(/[^a-z]+/g,'')}.example/jobs/1`,jdRaw:'Trading Analyst role covering derivatives execution, market analysis, risk controls and Python research. '.repeat(3)};}
const noAgent=()=>({available:false,error:'synthetic unavailable'});

 test('dashboard read model exposes the active Master CV and authoritative source summary',async()=>{
  const d=db();const imported=await importCv(d,{buffer:Buffer.from('MASTER SUPERVISOR CV\nTrading analyst with derivatives and Python experience.'),filename:'master.txt',isMaster:true,isActive:true});const m=dashboardReadModel(d);
  assert.equal(m.activeCv.present,true);assert.equal(m.activeCv.versionId,imported.versionId);assert.equal(m.activeCv.filename,'master.txt');assert.equal(m.activeCv.isMaster,true);assert.ok(m.sources.total>=3);assert.ok(m.sources.enabled>=3);assert.equal(m.sources.enabled,m.sources.healthy+m.sources.degraded+m.sources.rateLimited+m.sources.manual+m.sources.untested);d.close();
});

test('SYSTEM source registration is complete and source-specific planners avoid role-location cartesian explosion',()=>{
  const d=db();const check=verifySystemSources(d);assert.equal(check.ok,true);assert.equal(check.sources.length,3);const roles=d.prepare('SELECT * FROM target_roles WHERE enabled=1').all();const locs=d.prepare('SELECT * FROM target_locations WHERE enabled=1').all();
  const linked=planSourceQueries(check.sources.find(x=>x.name==='LinkedIn Jobs'),roles,locs);const indeed=planSourceQueries(check.sources.find(x=>x.name==='Indeed'),roles,locs);const efc=planSourceQueries(check.sources.find(x=>x.name==='eFinancialCareers'),roles,locs);
  assert.ok(linked.length<=8&&linked.length>0);assert.ok(indeed.length<=8&&indeed.length>0);assert.ok(efc.length<=8&&efc.length>0);for(const p of linked){const u=new URL(p.url);assert.equal(u.pathname,'/jobs/search/');assert.ok(u.searchParams.get('keywords'));assert.ok(u.searchParams.get('location'));assert.equal(u.searchParams.get('f_TPR'),'r604800');}for(const p of indeed){const u=new URL(p.url);assert.equal(u.pathname,'/jobs');assert.ok(u.searchParams.get('q'));assert.ok(u.searchParams.get('l'));}for(const p of efc){const u=new URL(p.url);assert.equal(u.pathname,'/jobs/search');assert.ok(u.searchParams.get('q'));assert.ok(u.searchParams.get('countryCode'));}d.close();
});

test('source seed failures are audited instead of silently swallowed',()=>{
  const d=new DatabaseSync(':memory:');migrate(d);seedSystemSources(d,{onboard(){throw new Error('synthetic seed failure')}});const events=d.prepare("SELECT * FROM audit_events WHERE event_type='SOURCE_SEED_ERROR'").all();assert.ok(events.length>=SYSTEM_SOURCES.length);d.close();
});

test('live discovery state exposes current source, query, layer and advancing counters',async()=>{
  const d=db();keepOnly(d);const id=addSource(d,'Long Running Source','https://long.example/careers');d.prepare('UPDATE sources SET enabled=1 WHERE id=?').run(id);let doctorCalls=0;
  const providers={agentReachDoctor:async()=>{doctorCalls++;return noAgent();},scanGenericHttp:async()=>{await sleep(120);return [job('Long Running Co')];},scanWithPlaywright:async()=>[]};
  const promise=runDiscovery(d,{providers,limits:{hardMs:3000,softMs:2000,stallMs:1000}});await sleep(35);const live=discoveryState(d,{running:true,settings:{mode:'MANUAL'}});assert.equal(live.running,true);assert.equal(live.currentSourceName,'Long Running Source');assert.ok(live.currentQuery);assert.equal(live.currentLayer,'http');assert.equal(live.plannedSources,1);assert.equal(live.plannedQueries,1);assert.ok(live.lastProgressAt);const done=await promise;assert.equal(done.status,'COMPLETE');assert.equal(done.stats.queriesCompleted,1);assert.equal(done.stats.sourcesCompleted,1);assert.ok(done.stats.rawJobs>=1);assert.equal(doctorCalls,1);d.close();
});

test('duplicate discovery start and meaningless no-source preflight are refused',async()=>{
  const d=db();const s=new LocalScheduler(d);s.running=true;await assert.rejects(()=>s.trigger('MANUAL'),/already running/i);s.running=false;keepOnly(d);const p=s.preflight('MANUAL');assert.equal(p.ok,false);assert.match(p.errors[0],/no discovery sources/i);d.close();
});

test('Agent Reach is checked once per run and a rate-limited source opens its circuit breaker',async()=>{
  const d=db();keepOnly(d,['LinkedIn Jobs']);let doctorCalls=0,agentCalls=0,httpCalls=0;
  const providers={agentReachDoctor:async()=>{doctorCalls++;return noAgent();},scanGenericHttp:async()=>{httpCalls++;throw new Error('HTTP 429 Too Many Requests');},scanWithPlaywright:async()=>{throw new Error('blocked');},scanWithAgentReach:async()=>{agentCalls++;return [];}};
  const r=await runDiscovery(d,{providers,limits:{hardMs:3000,softMs:2000,stallMs:1000,circuitFailures:2}});assert.equal(doctorCalls,1);assert.equal(agentCalls,0);assert.equal(r.stats.queriesCompleted,1);assert.ok(r.stats.plannedQueries>1);assert.equal(d.prepare("SELECT health FROM sources WHERE name='LinkedIn Jobs'").get().health,'RATE_LIMITED');const src=d.prepare('SELECT stats_json FROM discovery_run_sources WHERE run_id=?').get(r.runId);assert.equal(JSON.parse(src.stats_json).circuitOpen,true);assert.ok(httpCalls>=1);d.close();
});

test('one source failure does not kill the run and a later source can preserve useful jobs',async()=>{
  const d=db();keepOnly(d);addSource(d,'Broken Source','https://broken.example/careers');addSource(d,'Good Source','https://good.example/careers');
  const providers={agentReachDoctor:async()=>noAgent(),scanGenericHttp:async({url})=>url.includes('good.example')?[job('Good Co')]:Promise.reject(new Error('synthetic blocked source')),scanWithPlaywright:async({url})=>url.includes('good.example')?[]:Promise.reject(new Error('browser blocked'))};
  const r=await runDiscovery(d,{providers,limits:{hardMs:3000,softMs:2000,stallMs:1000}});assert.equal(r.status,'PARTIAL');assert.ok(r.stats.newCandidates>=1);assert.ok(Number(d.prepare('SELECT count(*) n FROM jobs').get().n)>=1);assert.equal(r.stats.sourcesCompleted,2);d.close();
});

test('manual hard deadline returns PARTIAL_TIMEOUT and preserves jobs completed before the timeout',async()=>{
  const d=db();keepOnly(d);addSource(d,'Fast Source','https://fast.example/careers');addSource(d,'Slow Source','https://slow.example/careers');
  const providers={agentReachDoctor:async()=>noAgent(),scanGenericHttp:async({url})=>{if(url.includes('fast.example'))return [job('Fast Co')];await sleep(160);return [];},scanWithPlaywright:async()=>[]};
  const r=await runDiscovery(d,{providers,limits:{hardMs:100,softMs:40,stallMs:1000}});assert.equal(r.status,'PARTIAL_TIMEOUT');assert.ok(Number(d.prepare("SELECT count(*) n FROM jobs WHERE company='Fast Co'").get().n)>=1);assert.match(r.stats.statusReason,/time limit/i);d.close();
});

test('cancellation preserves work from already completed sources',async()=>{
  const d=db();keepOnly(d);addSource(d,'First Source','https://first.example/careers');addSource(d,'Second Source','https://second.example/careers');let cancel=false;
  const providers={agentReachDoctor:async()=>noAgent(),scanGenericHttp:async({url})=>{if(url.includes('first.example'))return [job('First Co')];cancel=true;return [];},scanWithPlaywright:async()=>[]};
  const r=await runDiscovery(d,{providers,shouldCancel:()=>cancel,limits:{hardMs:3000,softMs:2000,stallMs:1000}});assert.equal(r.status,'CANCELLED');assert.ok(Number(d.prepare("SELECT count(*) n FROM jobs WHERE company='First Co'").get().n)>=1);d.close();
});

test('Search History and run detail expose parsed run, source and attempt telemetry',()=>{
  const d=db();const source=d.prepare("SELECT id FROM sources WHERE enabled=1 LIMIT 1").get();const stats={plannedSources:1,sourcesCompleted:1,plannedQueries:1,queriesCompleted:1,rawJobs:4,uniqueJobs:3,roleRelevant:2,locationMatched:1,jdsRetrieved:1,newCandidates:1,strong:1,good:0,errors:[]};const run=Number(d.prepare("INSERT INTO discovery_runs(mode,status,finished_at,stats_json) VALUES ('MANUAL','COMPLETE',CURRENT_TIMESTAMP,?)").run(JSON.stringify(stats)).lastInsertRowid);d.prepare("INSERT INTO discovery_run_sources(run_id,source_id,status,stats_json) VALUES (?,?, 'COMPLETE','{}')").run(run,source.id);d.prepare("INSERT INTO discovery_attempts(source_id,run_id,layer,status,jobs_found) VALUES (?,?, 'http','SUCCESS',4)").run(source.id,run);const h=discoveryHistory(d,5)[0];assert.equal(h.queries,1);assert.equal(h.listings,4);assert.equal(h.deduped,3);const detail=discoveryRunDetail(d,run);assert.equal(detail.sources.length,1);assert.equal(detail.attempts.length,1);assert.equal(detail.attempts[0].layer,'http');d.close();
});

test('SQLite UTC timestamps produce accurate completed-run duration and a stopped timer',()=>{
  const d=db();
  const run=Number(d.prepare("INSERT INTO discovery_runs(mode,status,started_at,finished_at,stats_json) VALUES ('MANUAL','COMPLETE','2026-10-03 06:13:11','2026-10-03 06:20:07','{}')").run().lastInsertRowid);
  const history=discoveryHistory(d,1)[0];
  assert.equal(history.id,run);
  assert.equal(history.durationSeconds,416);
  const state=discoveryState(d,{running:false,settings:{mode:'MANUAL'}});
  assert.equal(state.elapsedSeconds,416);
  assert.equal(state.secondsSinceProgress,0);
  d.close();
});

test('structured System Logs contain runtime events and redact private CV/JD/credential metadata',async()=>{
  const syntheticToken=['ghp','abcdefghijklmnopqrstuvwxyz123456'].join('_');fs.rmSync(runtimeLogPath(),{force:true});logRuntimeEvent('DISCOVERY_START',{runId:99,cvBody:'SECRET CV BODY',jdRaw:'SECRET FULL JD',token:syntheticToken,sourceName:'Safe Source'});const lines=readRuntimeLog(10);assert.equal(lines.length,1);assert.match(lines[0],/DISCOVERY_START/);assert.match(lines[0],/Safe Source/);assert.doesNotMatch(lines[0],/SECRET CV BODY|SECRET FULL JD|ghp_/);
  const d=db();let payload;const handled=await handleAlpha4Api({req:{method:'GET'},res:{},url:new URL('http://127.0.0.1/api/system/logs?limit=10'),db:d,scheduler:new LocalScheduler(d),json(_r,_s,x){payload=x},bodyJson:async()=>({})});assert.equal(handled,true);assert.equal(payload.file,'jcc.log');assert.ok(payload.lines.some(x=>x.includes('DISCOVERY_START')));d.close();
});

test('local watchdog distinguishes healthy, offline and intentional-stop states without mandatory restart',async()=>{
  const healthy=await probeJcc({fetchFn:async()=>({ok:true,json:async()=>({ok:true,version:'2.0.0-alpha.4'})})});assert.equal(healthy.ok,true);const offline=await probeJcc({fetchFn:async()=>{throw new Error('offline')}});assert.equal(offline.ok,false);assert.equal(watchdogDecision({healthy:false,intentionalStop:true,maintenance:false,autoRestart:true}).action,'INTENTIONAL_STOP');assert.equal(watchdogDecision({healthy:false,intentionalStop:false,maintenance:true,autoRestart:true}).action,'MAINTENANCE');assert.equal(watchdogDecision({healthy:false,intentionalStop:false,maintenance:false,autoRestart:false}).action,'OFFLINE');let restarted=false;const cycle=await runWatchdogCycle({fetchFn:async()=>{throw new Error('offline')},autoRestart:false,restartFn:()=>{restarted=true;return true},intentionalStop:false,maintenance:false});assert.equal(cycle.action,'OFFLINE');assert.equal(restarted,false);
});

test('dashboard supervisor UI renders live progress, hides duplicate run actions and auto-refreshes runtime logs',()=>{
  const ui=fs.readFileSync(path.join(paths.repoRoot,'public','discovery-supervisor.js'),'utf8');const html=fs.readFileSync(path.join(paths.repoRoot,'public','index.html'),'utf8');assert.match(html,/discovery-supervisor\.js/);assert.match(ui,/SEARCH IN PROGRESS/);assert.match(ui,/Current source:/);assert.match(ui,/Current layer:/);assert.match(ui,/Last progress/);assert.match(ui,/b\.disabled=running/);assert.match(ui,/classList\.toggle\('hidden',running\)/);assert.match(ui,/setInterval\(refreshRuntimeLog,2000\)/);assert.match(ui,/SEARCH PARTIALLY COMPLETED — TIME LIMIT REACHED/);
});

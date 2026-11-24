import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'jcc-discovery-quality-'));
process.env.JCC_ROOT=root;
const { DatabaseSync }=await import('node:sqlite');
const { initFolders }=await import('../src/initFolders.mjs');
const { migrate }=await import('../src/migrate.mjs');
const { seed }=await import('../src/seed.mjs');
const { onboardSource }=await import('../src/services/sourceOnboarding.mjs');
const { upsertTargetLocation }=await import('../src/services/targetLocations.mjs');
const { planSourceQueries }=await import('../src/discovery/queryPlanner.mjs');
const { dedupJobs }=await import('../src/discovery/dedup.mjs');
const { runDiscovery,boundedLayer }=await import('../src/discovery/service.mjs');
const { discoveryState,discoveryHistory }=await import('../src/services/discoveryReadModel.mjs');
const { parseSystemRadarHtml }=await import('../adapters/systemRadars.mjs');
const { prepareJobAutomatically }=await import('../src/services/autoApplicationPrep.mjs');
const { paths }=await import('../src/paths.mjs');
initFolders();

function db(){const d=new DatabaseSync(':memory:');d.exec('PRAGMA foreign_keys=ON');migrate(d);seed(d);return d;}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function keepOnly(d,names=[]){const qs=names.map(()=>'?').join(',');if(names.length)d.prepare(`UPDATE sources SET enabled=CASE WHEN name IN (${qs}) THEN 1 ELSE 0 END`).run(...names);else d.exec('UPDATE sources SET enabled=0');}
function addSource(d,name,url){return onboardSource(d,{name,baseUrl:url,company:name,kind:'AUTO',ownership:'USER_ADDED'}).sourceId;}
function targetOnly(d,labels=['London, United Kingdom']){d.exec('DELETE FROM target_locations');for(const label of labels)upsertTargetLocation(d,{label,origin:'TEST'});}
function radarJob(i,{location='',jdRaw=''}={}){return {externalId:`r-${i}`,company:'Alpha Capital',title:'Trading Analyst',location,sourceUrl:`https://example.com/jobs/${i}`,applicationUrl:`https://example.com/jobs/${i}`,jdRaw};}
function fullJd(){return 'Trading Analyst role covering derivatives execution, market analysis, risk controls and Python research. '.repeat(4);}
const noAgent=async()=>({available:false,error:'synthetic unavailable'});
function browserProviders(extra={}){const fake={id:'browser'};return {agentReachDoctor:noAgent,launchDiscoveryBrowser:async()=>fake,closeDiscoveryBrowser:async()=>{},scanWithPlaywright:async()=>[],extractJobDetailWithPlaywright:async({url,company,title})=>({url,sourceUrl:url,applicationUrl:url,company,title,location:'',locationStatus:'LOCATION_UNVERIFIED',jdRaw:''}),...extra};}

 test('location-scoped radar plans preserve explicit non-authoritative query scope and reduce duplicate country work',()=>{
  const d=db();const linked=d.prepare("SELECT * FROM sources WHERE name='LinkedIn Jobs'").get();const roles=d.prepare('SELECT * FROM target_roles WHERE enabled=1').all();const locs=d.prepare('SELECT * FROM target_locations WHERE enabled=1').all();const plans=planSourceQueries(linked,roles,locs);
  assert.ok(plans.length>0&&plans.length<8);assert.ok(plans.every(x=>x.searchScopeLocation));assert.ok(plans.every(x=>x.searchScopeSource==='LinkedIn Jobs'));assert.ok(plans.every(x=>x.searchScopeConfidence==='QUERY_SCOPE_ONLY'));assert.ok(plans.some(x=>x.searchScopeCountry==='United Arab Emirates'));assert.equal(plans.filter(x=>x.searchScopeCountry==='United Arab Emirates').length,1);d.close();
});

test('blank listing location is hydrated before final location gate and matching detail is accepted',async()=>{
  const d=db();keepOnly(d,['LinkedIn Jobs']);targetOnly(d);let detailCalls=0;
  const providers=browserProviders({scanGenericHttp:async()=>[radarJob(1)],fetchGenericHttpDetail:async({url,company,title})=>{detailCalls++;return {sourceUrl:url,applicationUrl:url,company,title,location:'London, United Kingdom',locationStatus:'LOCATION_INFERRED_FROM_DETAIL',jdRaw:fullJd()};}});
  const r=await runDiscovery(d,{providers,limits:{hardMs:2000,softMs:1000,stallMs:1000}});assert.equal(detailCalls,1);assert.equal(r.stats.locationNeedsDetail,1);assert.equal(r.stats.locationMatched,1);assert.equal(r.stats.newCandidates,1);const row=d.prepare('SELECT * FROM jobs').get();assert.match(row.location_raw,/London/i);assert.equal(row.status,'DISCOVERED');const audit=JSON.parse(d.prepare("SELECT payload_json FROM audit_events WHERE entity_type='job' AND event_type='DISCOVERY_PROVENANCE' ORDER BY id DESC LIMIT 1").get().payload_json);assert.equal(audit.searchScopeLocation,'London, United Kingdom');assert.equal(audit.locationStatus,'LOCATION_INFERRED_FROM_DETAIL');d.close();
});

test('hydrated verified location mismatch is rejected by the final location gate',async()=>{
  const d=db();keepOnly(d,['LinkedIn Jobs']);targetOnly(d);const providers=browserProviders({scanGenericHttp:async()=>[radarJob(2)],fetchGenericHttpDetail:async({url,company,title})=>({sourceUrl:url,applicationUrl:url,company,title,location:'Paris, France',locationStatus:'LOCATION_INFERRED_FROM_DETAIL',jdRaw:fullJd()})});
  const r=await runDiscovery(d,{providers,limits:{hardMs:2000,softMs:1000,stallMs:1000}});assert.equal(r.stats.roleRelevant,1);assert.equal(r.stats.locationMatched,0);assert.equal(r.stats.locationMismatch,1);assert.equal(Number(d.prepare('SELECT count(*) n FROM jobs').get().n),0);d.close();
});

test('unresolved location-scoped listing remains NEEDS_VERIFICATION without promoting query scope to verified location',async()=>{
  const d=db();keepOnly(d,['LinkedIn Jobs']);targetOnly(d);const providers=browserProviders({scanGenericHttp:async()=>[radarJob(3,{jdRaw:fullJd()})],fetchGenericHttpDetail:async({url,company,title})=>({sourceUrl:url,applicationUrl:url,company,title,location:'',locationStatus:'LOCATION_UNVERIFIED',jdRaw:fullJd()})});
  const r=await runDiscovery(d,{providers,limits:{hardMs:2000,softMs:1000,stallMs:1000}});assert.equal(r.stats.locationMatched,0);assert.equal(r.stats.locationUnverified,1);assert.equal(r.stats.unverifiedCandidates,1);assert.equal(r.stats.newCandidates,0);const row=d.prepare('SELECT * FROM jobs').get();assert.equal(row.status,'NEEDS_VERIFICATION');assert.equal(row.location_raw,'');const audit=JSON.parse(d.prepare("SELECT payload_json FROM audit_events WHERE entity_id=? AND event_type='DISCOVERY_PROVENANCE' ORDER BY id DESC LIMIT 1").get(row.id).payload_json);assert.equal(audit.locationStatus,'LOCATION_UNVERIFIED');assert.equal(audit.searchScopeLocation,'London, United Kingdom');assert.notEqual(audit.locationStatus,'LOCATION_VERIFIED');const prep=await prepareJobAutomatically(d,row.id,{force:true,researchContacts:false});assert.equal(prep.status,'SKIPPED');assert.equal(prep.reason,'LOCATION_UNVERIFIED');d.close();
});

test('source-specific public radar card parsers capture exposed company and location without fabrication',()=>{
  const linked=`<div class="base-search-card" data-entity-urn="urn:li:jobPosting:123"><h3 class="base-search-card__title">Trading Analyst</h3><h4 class="base-search-card__subtitle">Alpha Capital</h4><span class="job-search-card__location">London, United Kingdom</span><a href="https://www.linkedin.com/jobs/view/123">Open</a><time datetime="2026-09-16"></time></div>`;
  const indeed=`<div class="job_seen_beacon" data-jk="abc"><a class="jcs-JobTitle" href="/viewjob?jk=abc"><span>Trading Analyst</span></a><span data-testid="company-name">Beta Markets</span><span data-testid="text-location">Amsterdam, Netherlands</span><time datetime="2026-09-15"></time></div>`;
  const efc=`<article data-testid="job-card"><a href="/jobs/trading-analyst-777"><span class="title">Trading Analyst</span></a><span class="company">Gamma Bank</span><span class="location">Zurich, Switzerland</span><time datetime="2026-09-14"></time></article>`;
  const a=parseSystemRadarHtml(linked,'https://www.linkedin.com/jobs/search/?keywords=Trading')[0],b=parseSystemRadarHtml(indeed,'https://www.indeed.com/jobs?q=Trading')[0],c=parseSystemRadarHtml(efc,'https://www.efinancialcareers.com/jobs/search?q=Trading')[0];
  assert.equal(a.location,'London, United Kingdom');assert.equal(a.company,'Alpha Capital');assert.equal(a.locationStatus,'LOCATION_VERIFIED');assert.equal(b.location,'Amsterdam, Netherlands');assert.equal(b.company,'Beta Markets');assert.equal(c.location,'Zurich, Switzerland');assert.equal(c.company,'Gamma Bank');
});

test('dedup merges stronger company/location evidence and preserves all query provenance',()=>{
  const url='https://example.com/jobs/42';const a={title:'Trading Analyst',company:'Unknown',location:'',locationStatus:'LOCATION_QUERY_SCOPE_ONLY',sourceUrl:url,applicationUrl:url,searchScopeLocation:'London',discoveryQueryUrl:'https://radar/search?l=London'};const b={title:'Trading Analyst',company:'Alpha Capital',location:'London, United Kingdom',locationStatus:'LOCATION_VERIFIED',sourceUrl:url,applicationUrl:url,discoveryQueryUrl:'https://radar/search?l=UK'};const x=dedupJobs([a,b])[0];assert.equal(x.company,'Alpha Capital');assert.equal(x.location,'London, United Kingdom');assert.equal(x.locationStatus,'LOCATION_VERIFIED');assert.equal(x.discoveryProvenance.length,2);
});

test('dedup never downgrades verified location evidence with later query-scope inference',()=>{
  const url='https://example.com/jobs/43';const verified={title:'Trading Analyst',company:'Alpha',location:'Amsterdam, Netherlands',locationStatus:'LOCATION_VERIFIED',sourceUrl:url,applicationUrl:url};const weak={title:'Trading Analyst',company:'Alpha',location:'',locationStatus:'LOCATION_QUERY_SCOPE_ONLY',sourceUrl:url,applicationUrl:url,searchScopeLocation:'London'};const x=dedupJobs([verified,weak])[0];assert.equal(x.location,'Amsterdam, Netherlands');assert.equal(x.locationStatus,'LOCATION_VERIFIED');
});

test('all-missing location scenario emits LOCATION_EXTRACTION_ANOMALY and Search History exposes it',async()=>{
  const d=db();keepOnly(d,['LinkedIn Jobs']);targetOnly(d);const jobs=Array.from({length:20},(_,i)=>radarJob(100+i,{jdRaw:fullJd()}));const providers=browserProviders({scanGenericHttp:async()=>jobs,fetchGenericHttpDetail:async({url,company,title})=>({sourceUrl:url,applicationUrl:url,company,title,location:'',locationStatus:'LOCATION_UNVERIFIED',jdRaw:fullJd()})});
  const r=await runDiscovery(d,{providers,limits:{hardMs:4000,softMs:2000,stallMs:1000}});assert.equal(r.stats.roleRelevant,20);assert.equal(r.stats.locationMatched,0);assert.equal(r.stats.locationUnverified,20);assert.equal(r.stats.anomalies[0].code,'LOCATION_EXTRACTION_ANOMALY');assert.equal(r.status,'PARTIAL');const h=discoveryHistory(d,2)[0];assert.equal(h.anomalyCount,1);assert.equal(h.locationUnverified,20);assert.match(h.anomalies[0].message,/20 relevant listings require location verification/i);d.close();
});

test('live state exposes simultaneous per-source progress instead of only the current source',async()=>{
  const d=db();keepOnly(d);addSource(d,'First Radar','https://first.example/careers');addSource(d,'Second Radar','https://second.example/careers');const providers={agentReachDoctor:noAgent,scanGenericHttp:async({url})=>{if(url.includes('first.example'))await sleep(120);return [radarJob(url.includes('first')?201:202,{location:'London, United Kingdom',jdRaw:fullJd()})];},scanWithPlaywright:async()=>[]};const promise=runDiscovery(d,{providers,limits:{hardMs:2000,softMs:1000,stallMs:1000}});await sleep(30);const live=discoveryState(d,{running:true,settings:{mode:'MANUAL'}});assert.equal(live.sourceProgress.length,2);assert.ok(live.sourceProgress.some(x=>x.status==='RUNNING'));assert.ok(live.sourceProgress.some(x=>x.status==='PENDING'));const done=await promise;assert.equal(done.stats.sourceProgress.length,2);assert.ok(done.stats.sourceProgress.every(x=>x.status==='COMPLETE'));d.close();
});

test('a retrieval-layer timeout falls through instead of ending the whole discovery run',async()=>{
  let abortReason=null;const start=Date.now();
  await assert.rejects(
    boundedLayer('synthetic-layer',()=>new Promise(()=>{}),{deadlineAt:Date.now()+500,configuredMs:20,onAbort:async reason=>{abortReason=reason;}}),
    error=>error?.code==='DISCOVERY_LAYER_TIMEOUT'&&/next retrieval method/i.test(error.message)
  );
  assert.equal(abortReason,'timeout');assert.ok(Date.now()-start<300);
});

test('global hard deadline contains an in-flight retrieval that never resolves',async()=>{
  const d=db();keepOnly(d);addSource(d,'Hung Radar','https://hung.example/careers');const start=Date.now();const r=await runDiscovery(d,{providers:{agentReachDoctor:noAgent,scanGenericHttp:async()=>new Promise(()=>{}),scanWithPlaywright:async()=>[]},limits:{hardMs:80,softMs:30,stallMs:20}});const elapsed=Date.now()-start;assert.equal(r.status,'PARTIAL_TIMEOUT');assert.ok(elapsed<600,`deadline containment took ${elapsed}ms`);assert.match(r.stats.statusReason,/time limit/i);d.close();
});

test('in-flight timeout preserves jobs completed by an earlier source',async()=>{
  const d=db();keepOnly(d);addSource(d,'Fast Radar','https://fast.example/careers');addSource(d,'Hung Radar','https://hung.example/careers');const providers={agentReachDoctor:noAgent,scanGenericHttp:async({url})=>url.includes('fast.example')?[radarJob(301,{location:'London, United Kingdom',jdRaw:fullJd()})]:new Promise(()=>{}),scanWithPlaywright:async()=>[]};const r=await runDiscovery(d,{providers,limits:{hardMs:140,softMs:50,stallMs:30}});assert.equal(r.status,'PARTIAL_TIMEOUT');assert.ok(Number(d.prepare("SELECT count(*) n FROM jobs WHERE title='Trading Analyst'").get().n)>=1);d.close();
});

async function browserRun({cancel=false,timeout=false,twoLocations=false}={}){
  const d=db();keepOnly(d,['LinkedIn Jobs']);targetOnly(d,twoLocations?['London, United Kingdom','Amsterdam, Netherlands']:['London, United Kingdom']);let launch=0,close=0,scan=0,cancelled=false;const fake={id:'shared'};
  if(cancel)setTimeout(()=>{cancelled=true;},45);
  const providers={agentReachDoctor:noAgent,scanGenericHttp:async()=>[],launchDiscoveryBrowser:async()=>{launch++;return fake;},closeDiscoveryBrowser:async b=>{assert.equal(b,fake);close++;},scanWithPlaywright:async({url,browser})=>{assert.equal(browser,fake);scan++;if(cancel||timeout)return new Promise(()=>{});const loc=new URL(url).searchParams.get('location')||'London, United Kingdom';return [radarJob(400+scan,{location:loc,jdRaw:fullJd()})];}};
  const r=await runDiscovery(d,{providers,shouldCancel:()=>cancelled,limits:{hardMs:timeout?80:2000,softMs:50,stallMs:30}});return {d,r,launch,close,scan};
}

test('Playwright browser is reused across queries and closed once after successful source completion',async()=>{const x=await browserRun({twoLocations:true});assert.equal(x.scan,2);assert.equal(x.launch,1);assert.equal(x.close,1);assert.equal(x.r.status,'COMPLETE');x.d.close();});
test('Playwright browser closes when discovery is cancelled during an in-flight query',async()=>{const x=await browserRun({cancel:true});assert.equal(x.launch,1);assert.equal(x.close,1);assert.equal(x.r.status,'CANCELLED');x.d.close();});
test('Playwright browser closes when global deadline interrupts an in-flight query',async()=>{const x=await browserRun({timeout:true});assert.equal(x.launch,1);assert.equal(x.close,1);assert.equal(x.r.status,'PARTIAL_TIMEOUT');x.d.close();});

test('discovery supervisor UI renders all-source progress, verification counts and anomaly-aware history',()=>{
  const ui=fs.readFileSync(path.join(paths.repoRoot,'public','discovery-supervisor.js'),'utf8');assert.match(ui,/sourceProgress/);assert.match(ui,/>SOURCES</);assert.match(ui,/Needs Verification/);assert.match(ui,/locationUnverified/);assert.match(ui,/anomalyCount/);assert.match(ui,/No verified jobs in this view/);assert.match(ui,/A discovery run is already active/);
});

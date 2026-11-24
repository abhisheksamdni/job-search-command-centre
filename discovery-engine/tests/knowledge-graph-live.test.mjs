import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';

const sleep = ms => new Promise(r=>setTimeout(r,ms));
const testRoot=fs.mkdtempSync(path.join(os.tmpdir(),'jcc-graph-live-'));
process.env.JCC_ROOT=testRoot;
const { buildGraphIndex }=await import('../src/graph/indexer.mjs');
const { KnowledgeGraphService }=await import('../src/graph/service.mjs');
const { classifyRole }=await import('../src/services/roleGate.mjs');

function note(root,rel,text){const file=path.join(root,rel);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text,'utf8');return file;}
function fm(type,body='',extra=''){return `---\ntype: ${type}\n${extra}tags:\n  - ${type}\n---\n# ${body||type}\n`;}

function createSseReader(stream) {
  const reader=stream.getReader();const decoder=new TextDecoder();let buf='';const queue=[];const waiters=[];let closed=false;let error=null;
  const dispatch=payload=>{const waiter=waiters.shift();if(waiter)waiter.resolve(payload);else queue.push(payload)};
  (async()=>{try{while(true){const {value,done}=await reader.read();if(done)break;buf+=decoder.decode(value,{stream:true});const chunks=buf.split(/\n\n/);buf=chunks.pop()||'';for(const chunk of chunks){const ev=chunk.match(/^event:\s*(.+)$/m)?.[1]?.trim()||'message';const data=chunk.match(/^data:\s*(.+)$/m)?.[1];if(data)dispatch({event:ev,data:JSON.parse(data)});}}}catch(e){error=e;}finally{closed=true;for(const w of waiters.splice(0))w.reject(error||new Error('SSE stream closed'));}})();
  return {next({event='graph',timeoutMs=5000}={}){return new Promise((resolve,reject)=>{const tryQueue=()=>{const i=queue.findIndex(x=>x.event===event);if(i>=0){resolve(queue.splice(i,1)[0].data);return true}return false};if(tryQueue())return;if(closed)return reject(error||new Error('SSE stream closed'));const waiter={resolve:x=>{if(x.event===event)resolve(x.data);else{queue.push(x);this.next({event,timeoutMs}).then(resolve,reject)}},reject};waiters.push(waiter);const timer=setTimeout(()=>{const i=waiters.indexOf(waiter);if(i>=0)waiters.splice(i,1);reject(new Error(`Timed out waiting for SSE ${event}`));},timeoutMs);const r=waiter.resolve;waiter.resolve=x=>{clearTimeout(timer);r(x)};const j=waiter.reject;waiter.reject=e=>{clearTimeout(timer);j(e)};});},close(){return reader.cancel().catch(()=>{})}};
}

test('graph-index generation parses frontmatter and Obsidian wikilinks without copying note bodies',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jcc-graph-index-'));const out=path.join(root,'data','graph-index.json');
  note(root,'Jobs/Job JOB-000123.md',`---\ntype: job\njob_id: JOB-000123\ncompany: Example Capital\nstatus: APPLIED\ntags:\n  - job\n---\n# Job JOB-000123\nSECRET JD BODY SHOULD NEVER BE COPIED\nLinks: [[Application JOB-000123]] and [[Senior Recruiter]].\n`);
  note(root,'Applications/Application JOB-000123.md',`---\ntype: application\njob_id: JOB-000123\nstatus: APPLIED\n---\n# Application JOB-000123\n[[Job JOB-000123]]\n`);
  note(root,'Skills/Senior Recruiter.md',fm('skill','Senior Recruiter'));
  const graph=buildGraphIndex({knowledgeRoot:root,outputPath:out});assert.equal(graph.nodes.length,3);assert.ok(graph.links.some(x=>String(x.source).includes('job job-000123')&&String(x.target).includes('application job-000123')));
  const raw=fs.readFileSync(out,'utf8');assert.doesNotMatch(raw,/SECRET JD BODY SHOULD NEVER BE COPIED/);assert.doesNotMatch(raw,/Links:/);assert.match(raw,/Example Capital/,'allow-listed metadata may be indexed');
});

test('stable node IDs survive content/status changes and reconciliation',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jcc-graph-stable-'));const file=note(root,'Applications/Application JOB-000777.md',`---\ntype: application\njob_id: JOB-000777\nstatus: REVIEW\n---\n# Application JOB-000777\n`);
  const a=buildGraphIndex({knowledgeRoot:root,outputPath:null});const id=a.nodes[0].id;fs.writeFileSync(file,`---\ntype: application\njob_id: JOB-000777\nstatus: APPLIED\n---\n# Application JOB-000777\nChanged details\n`);
  const b=buildGraphIndex({knowledgeRoot:root,outputPath:null});assert.equal(b.nodes[0].id,id);assert.equal(b.nodes[0].meta.status,'APPLIED');
});

test('filesystem watcher reconciles changed Markdown into graph index',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jcc-graph-watch-'));const out=path.join(root,'data','graph.json');fs.mkdirSync(root,{recursive:true});note(root,'Architecture/JCC LOCAL.md',fm('architecture','JCC LOCAL'));
  const service=new KnowledgeGraphService({knowledgeRoot:root,outputPath:out,reconcileMs:60_000,debounceMs:40});service.start();try{const before=service.current().hash;note(root,'Jobs/Job JOB-000888.md',`---\ntype: job\njob_id: JOB-000888\nstatus: DISCOVERED\n---\n# Job JOB-000888\n[[JCC LOCAL]]\n`);for(let i=0;i<50&&service.current().hash===before;i++)await sleep(40);assert.notEqual(service.current().hash,before);assert.ok(service.current().nodes.some(n=>n.meta.job_id==='JOB-000888'));}finally{service.stop();}
});

test('SSE connects and receives a live graph update without browser refresh',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jcc-graph-sse-'));const out=path.join(root,'data','graph.json');note(root,'Architecture/JCC LOCAL.md',fm('architecture','JCC LOCAL'));
  const service=new KnowledgeGraphService({knowledgeRoot:root,outputPath:out,reconcileMs:60_000,debounceMs:30});service.start();const server=http.createServer((req,res)=>{if(req.url==='/events')return service.subscribe(req,res);res.writeHead(404).end();});server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port;
  try{const response=await fetch(`http://127.0.0.1:${port}/events`);assert.equal(response.status,200);assert.match(response.headers.get('content-type')||'',/text\/event-stream/);const events=createSseReader(response.body);const initial=await events.next();assert.equal(initial.reason,'initial');const livePromise=events.next({timeoutMs:5000});note(root,'Jobs/Job JOB-000999.md',`---\ntype: job\njob_id: JOB-000999\nstatus: DISCOVERED\n---\n# Job JOB-000999\n[[JCC LOCAL]]\n`);const live=await livePromise;assert.notEqual(live.reason,'initial');assert.ok(live.graph.nodes.some(n=>n.meta.job_id==='JOB-000999'));}finally{service.stop();server.close();}
});

test('/knowledge-graph dashboard renders required live controls and local vendor dependency',()=>{
  const html=fs.readFileSync(path.resolve('public/knowledge-graph.html'),'utf8');const js=fs.readFileSync(path.resolve('public/knowledge-graph.js'),'utf8');assert.match(html,/KNOWLEDGE GRAPH/);for(const id of ['search','reset','fit','fullscreen','filters','graph'])assert.match(html,new RegExp(`id="${id}"`));assert.match(html,/\/vendor\/3d-force-graph\.min\.js/);assert.match(js,/EventSource\('\/api\/knowledge-graph\/events'\)/);assert.match(js,/onNodeClick/);assert.match(js,/zoomToFit/);
});

test('graph index privacy excludes CV and JD bodies even when notes contain sensitive full text',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jcc-graph-privacy-'));const secretCv='PRIVATE_CV_BODY_9a62f31d';const secretJd='PRIVATE_JD_BODY_1bf003a8';note(root,'CV/CV Version CV-0042.md',`---\ntype: cv_version\ncv_version: CV-0042\nmaster: false\n---\n# CV Version CV-0042\n${secretCv}\n[[Job JOB-000042]]\n`);note(root,'Jobs/Job JOB-000042.md',`---\ntype: job\njob_id: JOB-000042\ncompany: Safe Co\n---\n# Job JOB-000042\n${secretJd}\n[[CV Version CV-0042]]\n`);const out=path.join(root,'graph-index.json');buildGraphIndex({knowledgeRoot:root,outputPath:out});const raw=fs.readFileSync(out,'utf8');assert.doesNotMatch(raw,new RegExp(secretCv));assert.doesNotMatch(raw,new RegExp(secretJd));
});

test('graph subsystem startup/index-write failure is contained and core role gate still works',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jcc-graph-fail-'));note(root,'Architecture/JCC LOCAL.md',fm('architecture','JCC LOCAL'));const badOutput=path.join(root,'occupied');fs.mkdirSync(badOutput,{recursive:true});const service=new KnowledgeGraphService({knowledgeRoot:root,outputPath:badOutput,reconcileMs:60_000});assert.doesNotThrow(()=>service.start());try{assert.ok(service.lastError);const core=classifyRole('Derivatives Trading Analyst',[{family:'TRADING',phrase:'Derivatives Trading Analyst',enabled:1}]);assert.equal(core.classification,'ROLE_MATCH');}finally{service.stop();}
});

test('real JCC server serves /knowledge-graph and SSE endpoint while core health remains independent',async(t)=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jcc-graph-server-'));const port=20000+Math.floor(Math.random()*1000);const child=spawn(process.execPath,['src/server.mjs'],{cwd:path.resolve('.'),env:{...process.env,JCC_ROOT:root,JCC_PORT:String(port)},stdio:['ignore','pipe','pipe']});t.after(()=>{try{child.kill('SIGTERM')}catch{}});
  let healthy=false;for(let i=0;i<80;i++){try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok){healthy=true;break}}catch{}await sleep(75);}assert.ok(healthy,'core health endpoint starts');const page=await fetch(`http://127.0.0.1:${port}/knowledge-graph`);assert.equal(page.status,200);assert.match(await page.text(),/KNOWLEDGE GRAPH/);const sse=await fetch(`http://127.0.0.1:${port}/api/knowledge-graph/events`);assert.equal(sse.status,200);assert.match(sse.headers.get('content-type')||'',/text\/event-stream/);const events=createSseReader(sse.body);const ev=await events.next();assert.equal(ev.reason,'initial');await events.close();
});

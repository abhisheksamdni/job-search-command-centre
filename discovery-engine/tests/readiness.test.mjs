import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'jcc-readiness-'));
const port=24000+Math.floor(Math.random()*1000);

async function waitReady(){
  for(let i=0;i<80;i++){
    try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok)return await r.json();}catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  throw new Error('server did not become ready');
}

test('runtime health is lightweight and launcher logging is Windows-safe',async(t)=>{
  const child=spawn(process.execPath,['src/server.mjs'],{cwd:path.resolve('.'),env:{...process.env,JCC_ROOT:root,JCC_PORT:String(port)},stdio:['ignore','pipe','pipe']});
  t.after(()=>{try{child.kill('SIGTERM')}catch{}});
  const first=await waitReady();
  assert.equal(first.ok,true);
  assert.equal(first.ready,true);
  assert.equal(first.version,'2.0.0-alpha.4');
  assert.equal(first.port,port);
  assert.ok(first.pid>0);
  assert.equal(Object.hasOwn(first,'checks'),false,'runtime health must not execute full Doctor');

  const started=Date.now();
  const r=await fetch(`http://127.0.0.1:${port}/api/health`);
  const elapsed=Date.now()-started;
  assert.equal(r.status,200);
  assert.ok(elapsed<1500,`runtime health took ${elapsed}ms`);

  const page=await fetch(`http://127.0.0.1:${port}/knowledge-graph`);
  assert.equal(page.status,200);

  const launcher=fs.readFileSync('start-jcc.bat','utf8');
  assert.match(launcher,/-TimeoutSec 2/);
  assert.match(launcher,/node src\\server\.mjs >> \.\.\\JCC-Data\\Logs\\server\.log 2>&1/);
  assert.doesNotMatch(launcher,/\^>\^>/);
});

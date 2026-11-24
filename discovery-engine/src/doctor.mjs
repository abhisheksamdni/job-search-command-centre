import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { openDb } from './db.mjs';import { migrate } from './migrate.mjs';import { initFolders } from './initFolders.mjs';import { paths } from './paths.mjs';import { agentReachDoctor } from '../adapters/agentReachProvider.mjs';

export async function doctor(){
  const checks={node:{ok:Number(process.versions.node.split('.')[0])>=22,version:process.versions.node},folders:{ok:false},sqlite:{ok:false},migrations:{ok:false},playwright:{ok:false},chromium:{ok:false},agentReach:{ok:false},activeCv:{ok:false},roles:{ok:false},locations:{ok:false},databaseIntegrity:{ok:false},knowledgeGraph:{ok:false,optional:true}};
  try{initFolders();checks.folders.ok=fs.existsSync(paths.dataRoot)&&fs.existsSync(paths.knowledgeRoot);}catch(e){checks.folders.error=e.message;}
  try{const db=openDb();migrate(db);checks.sqlite.ok=true;checks.migrations.ok=true;const integrity=db.prepare('PRAGMA integrity_check').get();checks.databaseIntegrity.ok=Object.values(integrity||{})[0]==='ok';if(!checks.databaseIntegrity.ok)checks.databaseIntegrity.error='SQLite integrity_check did not return ok';checks.activeCv.ok=Boolean(db.prepare('SELECT 1 FROM cv_versions WHERE is_active=1 LIMIT 1').get());checks.roles.ok=Boolean(db.prepare('SELECT 1 FROM target_roles WHERE enabled=1 LIMIT 1').get());checks.locations.ok=Boolean(db.prepare('SELECT 1 FROM target_locations WHERE enabled=1 LIMIT 1').get());}catch(e){checks.sqlite.error=e.message;}
  try{await import('playwright');checks.playwright.ok=true;const p=spawnSync(process.execPath,['-e',"import('playwright').then(async({chromium})=>{const b=await chromium.launch({headless:true});await b.close()})"],{timeout:30000,encoding:'utf8'});checks.chromium.ok=p.status===0;if(!checks.chromium.ok)checks.chromium.error=(p.stderr||'Chromium launch failed').trim();}catch(e){checks.playwright.error=e.message;}
  try{checks.knowledgeGraph.ok=fs.existsSync(paths.graphIndex);if(!checks.knowledgeGraph.ok)checks.knowledgeGraph.error='Graph index not generated yet; run npm run init:local or start JCC';}catch(e){checks.knowledgeGraph.error=e.message;}
  const ar=await agentReachDoctor();checks.agentReach.ok=ar.available;if(!ar.available)checks.agentReach.error=ar.error;
  const required=['node','folders','sqlite','migrations','databaseIntegrity','roles','locations'];const ok=required.every(k=>checks[k].ok);return {ok,version:'2.0.0-alpha.4',host:'127.0.0.1',paidRuntimeApiRequired:false,checks};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const r=await doctor();console.log(JSON.stringify(r,null,2));process.exitCode=r.ok?0:1;}

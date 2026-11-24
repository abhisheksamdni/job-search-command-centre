import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');const server=fs.readFileSync(new URL('../src/server.mjs',import.meta.url),'utf8');
test('alpha4 UI uses dashboard-v2',()=>assert.match(app,/\/api\/dashboard-v2/));
test('alpha4 UI exposes source manager',()=>assert.match(app,/\/api\/source-manager/));
test('alpha4 UI has manual discovery control',()=>assert.match(app,/\/api\/discovery\/run/));
test('alpha4 UI supports normalized target location editing',()=>assert.match(app,/data-location-toggle/));
test('alpha4 UI loads complete active and archived sets independently',()=>{assert.match(app,/scope=active&limit=5000/);assert.match(app,/scope=archived&limit=5000/);assert.match(app,/activeJobs:\[\],archivedJobs:\[\]/);});
test('dashboard and routed job views use isolated active/archive collections',()=>{assert.match(app,/jobsTable\(jobFilter\(state\.activeJobs\)\)/);assert.match(app,/contextJobs\(kind\)/);});
test('local UI assets are never stale-cached across repairs',()=>assert.match(server,/'cache-control':'no-store'/));

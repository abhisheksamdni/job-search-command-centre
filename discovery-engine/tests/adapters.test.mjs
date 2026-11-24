import test from 'node:test';import assert from 'node:assert/strict';
import { detectGreenhouse,parseGreenhouse } from '../adapters/greenhouse.mjs';import { detectAshby,parseAshby } from '../adapters/ashby.mjs';import { detectLever,parseLever } from '../adapters/lever.mjs';
test('detect ATS URLs',()=>{assert.equal(detectGreenhouse('https://job-boards.greenhouse.io/acme').board,'acme');assert.equal(detectAshby('https://jobs.ashbyhq.com/acme').board,'acme');assert.equal(detectLever('https://jobs.lever.co/acme').site,'acme');});
test('parse Greenhouse',()=>{const x=parseGreenhouse({jobs:[{id:1,title:'Trader',absolute_url:'https://x',location:{name:'London'},content:'JD'}]},'Acme')[0];assert.equal(x.title,'Trader');assert.equal(x.location,'London');});
test('parse Ashby',()=>assert.equal(parseAshby({jobs:[{id:'a',title:'Analyst',jobUrl:'u',location:'Amsterdam'}]},'A')[0].title,'Analyst'));
test('parse Lever',()=>assert.equal(parseLever([{id:'a',text:'Trader',hostedUrl:'u',categories:{location:'Boston'}}],'A')[0].location,'Boston'));

const { parseJobPostingJsonLdStrings, filterJobLinks }=await import('../adapters/genericPlaywright.mjs');
const { parseAgentReachJobLinks }=await import('../adapters/agentReachProvider.mjs');

test('generic Playwright parser prefers structured JobPosting JSON-LD',()=>{
  const raw=JSON.stringify({'@context':'https://schema.org','@type':'JobPosting',title:'Execution Trader',url:'https://example.com/jobs/123',description:'Trade futures and options.',datePosted:'2026-09-15',hiringOrganization:{name:'Example Capital'},jobLocation:{address:{addressLocality:'London',addressCountry:'GB'}}});
  const jobs=parseJobPostingJsonLdStrings([raw],'https://example.com/careers','Fallback');assert.equal(jobs.length,1);assert.equal(jobs[0].title,'Execution Trader');assert.equal(jobs[0].company,'Example Capital');assert.match(jobs[0].jdRaw,/futures/);
});

test('generic link filter rejects navigation noise and keeps job-looking links',()=>{
  const links=[{title:'About us',sourceUrl:'https://example.com/about'},{title:'Derivatives Trader',sourceUrl:'https://example.com/jobs/derivatives-trader'},{title:'Privacy',sourceUrl:'https://example.com/jobs/privacy'}];
  const out=filterJobLinks(links,'https://example.com/careers');assert.equal(out.length,1);assert.equal(out[0].title,'Derivatives Trader');
});

test('Agent Reach markdown fallback extracts job links only',()=>{
  const md='[About](https://example.com/about)\n[Trading Analyst](https://example.com/careers/trading-analyst)\n[Cookie Policy](https://example.com/jobs/cookies)';
  const out=parseAgentReachJobLinks(md,'https://example.com','Example');assert.equal(out.length,1);assert.equal(out[0].title,'Trading Analyst');
});

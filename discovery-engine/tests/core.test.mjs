import test from 'node:test';import assert from 'node:assert/strict';
import { classifyRole } from '../src/services/roleGate.mjs';import { normalizeLocation } from '../src/services/locationNormalizer.mjs';import { canonicalizeUrl } from '../src/utils/url.mjs';import { cleanJd } from '../src/services/jdCleaner.mjs';import { extractRequirements } from '../src/services/requirements.mjs';import { assessRecruiter } from '../src/services/recruiter.mjs';import { assessAts } from '../src/services/atsExact.mjs';import { verifyTailored } from '../src/services/integrity.mjs';import { dedupJobs } from '../src/discovery/dedup.mjs';
const roles=[{family:'TRADING',phrase:'Derivatives Trading Analyst',enabled:1},{family:'INVESTMENT_RESEARCH',phrase:'Investment Analyst',enabled:1},{family:'INVESTMENT_RESEARCH',phrase:'Equity Research Analyst',enabled:1}];
test('role gate exact and variants',()=>{assert.equal(classifyRole('Derivatives Trading Analyst',roles).classification,'ROLE_MATCH');assert.equal(classifyRole('Senior Equity Research Analyst',roles).classification,'ROLE_MATCH');});
test('role gate generic false positive rejected',()=>assert.equal(classifyRole('Senior Operations Analyst',roles).classification,'ROLE_REJECTED'));
test('role gate requires the configured role noun as well as its domain',()=>{
 assert.equal(classifyRole('Investment Manager',roles).classification,'ROLE_REJECTED');
 assert.equal(classifyRole('Private Equity Associate',roles).classification,'ROLE_REJECTED');
 assert.equal(classifyRole('Portfolio Manager',[{family:'INVESTMENT_RESEARCH',phrase:'Portfolio Analyst',enabled:1}]).classification,'ROLE_REJECTED');
 assert.equal(classifyRole('Market Intelligence Specialist',[{family:'INVESTMENT_RESEARCH',phrase:'Market Analyst',enabled:1}]).classification,'ROLE_REJECTED');
 assert.equal(classifyRole('Senior Investment Analyst',roles).classification,'ROLE_MATCH');
 assert.equal(classifyRole('Investment Banking Placement Analyst',roles).classification,'ROLE_REJECTED');
 assert.equal(classifyRole('Investment Market Risk Analyst',roles).classification,'ROLE_RELATED');
});
test('role gate supports slash-separated title alternatives without broadening the match',()=>{
 const alternatives=[{family:'TRADING',phrase:'Execution Analyst/Trader',enabled:1}];
 assert.equal(classifyRole('Execution Analyst',alternatives).classification,'ROLE_MATCH');
 assert.equal(classifyRole('Execution Trader',alternatives).classification,'ROLE_MATCH');
 assert.equal(classifyRole('Execution Engineer',alternatives).classification,'ROLE_REJECTED');
});
test('generic Trader target matches trader titles but not unrelated trading functions',()=>{
 const trader=[{family:'TRADING',phrase:'Trader',enabled:1}];
 assert.equal(classifyRole('Energy Trader',trader).classification,'ROLE_MATCH');
 assert.equal(classifyRole('Trading Engineer',trader).classification,'ROLE_REJECTED');
});
test('role gate related role',()=>assert.equal(classifyRole('Trading Operations Analyst',roles).classification,'ROLE_RELATED'));
test('location normalizes London',()=>{const x=normalizeLocation('London, England, UK');assert.equal(x.countryCode,'GB');assert.equal(x.city,'London');});
test('url canonicalization drops tracking',()=>assert.equal(canonicalizeUrl('https://www.example.com/jobs/1/?utm_source=x&b=2&a=1#top'),'https://example.com/jobs/1?a=1&b=2'));
test('LinkedIn job canonicalization collapses country hosts, HTML entities and tracking variants',()=>{
 const a=canonicalizeUrl('https://ie.linkedin.com/jobs/view/energy-trader-at-acme-4468669425?position=5&amp;pageNum=0&amp;refId=abc&amp;trackingId=one');
 const b=canonicalizeUrl('https://uk.linkedin.com/jobs/view/energy-trader-at-acme-4468669425?position=2&pageNum=1&refId=xyz&trackingId=two');
 assert.equal(a,'https://linkedin.com/jobs/view/energy-trader-at-acme-4468669425');assert.equal(a,b);
});
test('dedup canonical URLs',()=>assert.equal(dedupJobs([{company:'A',title:'T',sourceUrl:'https://x.com/j/1?utm_source=a'},{company:'A',title:'T',sourceUrl:'https://x.com/j/1'}]).length,1));
test('JD cleaner removes noise and rates substantial JD',()=>{const raw=['Home','Careers','Requirements','Must have 3 years experience in derivatives trading and execution.','Strong knowledge of options and futures.','Responsibilities','Execute trades and monitor risk across market conditions.','Preferred experience with Python and Excel.'].concat(Array.from({length:40},(_,i)=>`The successful candidate will analyse market data, trading risk and portfolio exposure with stakeholders ${i}.`)).join('\n');const x=cleanJd(raw);assert.ok(!x.jdClean.startsWith('Home'));assert.notEqual(x.jdQuality,'POOR');});
test('recruiter mandatory evidence weighs heavily',()=>{const req=[{category:'MANDATORY',text:'Must have derivatives trading experience with options and futures.'},{category:'PREFERRED',text:'Python preferred.'}];const x=assessRecruiter({requirements:req,cvText:'Derivatives trader executing options and futures across markets.'});assert.ok(x.score>50);assert.equal(x.knockoutGaps.length,0);});
test('ATS only scores selected hard terms',()=>{const x=assessAts({requirements:[{category:'MANDATORY',text:'Python and SQL are required.'},{category:'PREFERRED',text:'Bloomberg preferred.'}],cvText:'Python and SQL'});assert.ok(x.score>50);assert.ok(x.missingWording.includes('bloomberg'));});
test('integrity flags new numeric claim',()=>{const x=verifyTailored({masterText:'Managed trading risk and exposure.',tailoredText:'Managed trading risk and exposure, improving PnL by 35%.'});assert.equal(x.integrity,'FAIL');});
test('requirement extraction identifies mandatory',()=>{const r=extractRequirements('Requirements\nMust have 3 years experience in trading derivatives.\nPreferred knowledge of Python.');assert.equal(r[0].category,'MANDATORY');assert.equal(r[1].category,'PREFERRED');});
test('advantageous but not required remains one non-mandatory requirement',()=>{const r=extractRequirements('## Qualifications\n- Exposure to programming or data analysis tools (e.g. Python, R, C++, or similar) is advantageous but not required.');assert.equal(r.length,1);assert.equal(r[0].category,'BONUS');assert.equal(r[0].informationClass,'PREFERRED_OR_BONUS');assert.equal(r[0].mandatory,false);assert.deepEqual(r[0].tool,['python','c++','r']);});
test('up to one year is a maximum, not a mandatory minimum-experience knockout',()=>{const [r]=extractRequirements('## Qualifications\n- Recent graduate with up to 1 year of relevant professional experience');assert.equal(r.minYears,null);assert.equal(r.maxYears,1);assert.equal(r.mandatory,false);assert.equal(r.category,'IMPORTANT');});

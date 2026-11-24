import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYears,extractRequirements,enrichRequirement } from '../src/services/requirements.mjs';
import { classifySeniority,relevantExperience,parseExperienceRanges } from '../src/services/professionalFit.mjs';
import { classifyRole } from '../src/services/roleGate.mjs';
import { assessRecruiter } from '../src/services/recruiter.mjs';
import { assessAts } from '../src/services/atsExact.mjs';

const MASTER=`WORK EXPERIENCE
Northbridge Capital
Derivative Trading Analyst
Dec 2024 – Oct 2025
Monitored live P&L, margin, portfolio exposure and daily risk checks across derivative trading activity.
Executed derivatives trades in options and futures and analysed market microstructure.
Kestrel Capital
Market Analyst Intern
Apr 2023 – Jun 2023
Researched market data and prepared portfolio analysis for trading strategy decisions.
Harbour Lane Partners
Equity Trader
Feb 2021 – May 2022
Executed equity trades, monitored risk and researched market opportunities.
Fenwick Foods
Manager
Feb 2018 – Jan 2021
Managed food manufacturing operations and supply-chain activity.
EDUCATION
MSc International Financial Markets
CERTIFICATIONS
CISI Level 4
EPAT
SKILLS
Python, Excel, market microstructure, systematic trading research`;

const META={cvVersionId:41,documentSha:'fixture-master-sha-256',documentName:'Master-CV.pdf'};

function reqs(text){return extractRequirements(text);}
function item(result,needle){return result.evidence.find(x=>(x.cleanText||x.text||'').toLowerCase().includes(needle.toLowerCase()));}

test('numeric experience requirements retain 10+, 5+ and minimum 3 years',()=>{
  assert.deepEqual(parseYears('10+ years investment experience'),{minYears:10,maxYears:null});
  assert.deepEqual(parseYears('5+ years senior leadership'),{minYears:5,maxYears:null});
  assert.deepEqual(parseYears('minimum 3 years in derivatives'),{minYears:3,maxYears:null});
  const r=reqs('Requirements\n- 10+ years investment experience required.\n- At least 5 years senior leadership required.\n- Minimum 3 years derivatives trading experience.');
  assert.deepEqual(r.map(x=>x.minYears),[10,5,3]);
  assert.ok(r.every(x=>/\d/.test(x.originalText)));
  assert.ok(r.every(x=>x.id&&x.sourcePosition>0));
});

test('relevant experience is function/domain based and excludes non-financial food management',()=>{
  const all=relevantExperience(MASTER);
  const investment=relevantExperience(MASTER,{domain:['INVESTMENT'],function:['portfolio analysis','market analysis']});
  assert.ok(all.years>0&&all.years<4,'financial evidence should be materially below ten years');
  assert.ok(investment.years<4);
  assert.ok(all.ranges.every(x=>!String(x.employer||'').includes('Fenwick Foods')));
});

test('overlapping financial employment is unioned rather than double-counted',()=>{
  const cv=`WORK EXPERIENCE\nAlpha Capital\nTrader\nJan 2022 – Dec 2022\nExecuted equity and derivatives trades.\nBeta Markets\nMarket Analyst\nJun 2022 – Jun 2023\nAnalysed market data and trading risk.`;
  const ranges=parseExperienceRanges(cv).filter(x=>x.financial);
  assert.equal(ranges.length,2);
  const exp=relevantExperience(cv);
  assert.equal(exp.months,18);
  assert.equal(exp.years,1.5);
});

test('explicit seniority model classifies CIO, Head, Analyst, Junior and Graduate titles',()=>{
  assert.equal(classifySeniority('Chief Investment Officer').level,'C_SUITE');
  assert.equal(classifySeniority('Head of Trading').level,'HEAD');
  assert.equal(classifySeniority('Trading Analyst').level,'ANALYST');
  assert.equal(classifySeniority('Junior Trader').level,'JUNIOR');
  assert.equal(classifySeniority('Graduate Trader').level,'GRADUATE');
});

test('role gate rejects CIO and Head against analyst targets but permits sensible adjacency',()=>{
  const targets=[{family:'INVESTMENT_RESEARCH',phrase:'Investment Analyst',enabled:1},{family:'TRADING',phrase:'Trading Analyst',enabled:1},{family:'TRADING',phrase:'Trader',enabled:1}];
  const cio=classifyRole('Chief Investment Officer',targets),head=classifyRole('Head of Trading',targets),junior=classifyRole('Junior Trader',targets),dealer=classifyRole('Execution Dealer',[{family:'TRADING',phrase:'Derivative Trading Analyst',enabled:1}]);
  assert.equal(cio.classification,'ROLE_REJECTED');assert.equal(cio.seniorityMismatch,true);
  assert.equal(head.classification,'ROLE_REJECTED');assert.equal(head.seniorityMismatch,true);
  assert.ok(['ROLE_MATCH','ROLE_RELATED'].includes(junior.classification));
  assert.equal(dealer.classification,'ROLE_RELATED');
});

test('CIO fixture produces years, leadership and seniority knockouts with a hard score cap',()=>{
  const jd=`Requirements\n- 10+ years investment experience required.\n- At least 5 years senior leadership required.\n- Proven responsibility for major investment portfolios is essential.`;
  const result=assessRecruiter({requirements:reqs(jd),cvText:MASTER,jobTitle:'Chief Investment Officer',cvMeta:META});
  assert.equal(result.clearKnockout,true);
  assert.ok(result.knockoutGaps.length>=2);
  assert.ok(result.score<=49);
  assert.equal(result.verdict,'DO NOT APPLY');
  assert.notEqual(result.recommendedDecision,'APPLY');
  assert.ok(!['STRONG MATCH','GOOD MATCH'].includes(result.verdict));
  assert.equal(result.seniorityCompatibility.clearExecutiveMismatch,true);
  const years=item(result,'10+ years');assert.ok(years);assert.equal(years.evidenceGrade,'NO_EVIDENCE');
});

test('preferred years gap does not become a knockout',()=>{
  const requirement=enrichRequirement('5+ years digital-assets trading experience preferred.','PREFERRED','REQ-PREF',1,'Preferred');
  const result=assessRecruiter({requirements:[requirement],cvText:MASTER,jobTitle:'Trading Analyst',cvMeta:META});
  assert.equal(result.clearKnockout,false);
  assert.equal(result.majorMandatoryGap,false);
  assert.equal(result.knockoutGaps.length,0);
  assert.equal(result.evidence[0].severity,'PREFERRED_GAP');
});

test('generic vocabulary overlap cannot rescue a mandatory years knockout',()=>{
  const requirement=enrichRequirement('Minimum 10 years trading and market analysis experience required.','MANDATORY','REQ-10',1,'Requirements');
  const verbose=`${MASTER}\nTrading market analysis trading market analysis trading market analysis.`;
  const result=assessRecruiter({requirements:[requirement],cvText:verbose,jobTitle:'Trading Analyst',cvMeta:META});
  assert.equal(result.evidence[0].evidenceGrade,'NO_EVIDENCE');
  assert.equal(result.evidence[0].severity,'KNOCKOUT');
  assert.ok(result.score<=49);
});

test('mandatory licence absence is a knockout while work authorisation stays unresolved',()=>{
  const requirements=reqs('Requirements\n- Series 7 licence is required.\n- Must have UK work authorization.');
  const result=assessRecruiter({requirements,cvText:MASTER,jobTitle:'Trading Analyst',cvMeta:META});
  const licence=item(result,'Series 7'),auth=item(result,'work authorization');
  assert.equal(licence.requirementType,'CERTIFICATION');assert.equal(licence.severity,'KNOCKOUT');
  assert.equal(auth.requirementType,'WORK_AUTHORIZATION');assert.equal(auth.severity,'CONFIRMATION_REQUIRED');
  assert.match(auth.reason,/confirmation|unresolved/i);
});

test('a finance-related MSc is strong equivalent evidence for a finance, economics or quantitative degree requirement',()=>{
  const requirement=enrichRequirement('A degree in finance, economics or a quantitative subject is required.','MANDATORY','REQ-DEGREE',1,'Requirements');
  const result=assessRecruiter({requirements:[requirement],cvText:MASTER,jobTitle:'Trading Analyst',cvMeta:META}),degree=result.evidence[0];
  assert.equal(degree.evidenceGrade,'STRONG_EQUIVALENT');assert.match(degree.evidenceText,/MSc International Financial Markets/);assert.equal(degree.severity,'NORMAL');assert.equal(result.clearKnockout,false);
});

test('stale Graduate Visa wording never resolves present work authorisation',()=>{
  const stale=`${MASTER}\nGraduate Visa valid till March 2026`;
  const requirements=reqs('Requirements\n- Must have UK work authorization.');
  const recruiter=assessRecruiter({requirements,cvText:stale,jobTitle:'Trading Analyst',cvMeta:META});
  const auth=item(recruiter,'work authorization');
  assert.equal(auth.evidenceGrade,'NO_EVIDENCE');
  assert.equal(auth.severity,'CONFIRMATION_REQUIRED');
  assert.equal(auth.evidenceText,null);
  const ats=assessAts({requirements,cvText:stale,jdText:'Must have UK work authorization.'});
  const authTerms=ats.keywordMatrix.filter(x=>x.requirementId===requirements[0].id);
  assert.ok(authTerms.length>0);
  assert.ok(authTerms.every(x=>x.action==='USER CONFIRMATION REQUIRED'));
});

test('recruiter strength returns actual Master CV excerpt and source provenance, not JD repetition',()=>{
  const requirement=enrichRequirement('Monitor market exposure and trading risk.','CORE','REQ-RISK',1,'Responsibilities');
  const result=assessRecruiter({requirements:[requirement],cvText:MASTER,jobTitle:'Trading Analyst',cvMeta:META});
  const ev=result.evidence[0];
  assert.ok(['EXACT_EVIDENCE','STRONG_EQUIVALENT'].includes(ev.evidenceGrade));
  assert.match(ev.evidenceText,/P&L|portfolio exposure|risk checks/i);
  assert.notEqual(ev.evidenceText,requirement.cleanText);
  assert.equal(ev.evidenceSource.sourceCvVersionId,41);
  assert.equal(ev.evidenceSource.sourceDocumentSha,META.documentSha);
  assert.ok(ev.evidenceSource.fingerprint);
});

test('unsupported requirement is NO_EVIDENCE with an explicit source-free gap',()=>{
  const requirement=enrichRequirement('MT5 platform experience is required.','MANDATORY','REQ-MT5',1,'Requirements');
  const result=assessRecruiter({requirements:[requirement],cvText:MASTER,jobTitle:'Forex Dealer',cvMeta:META});
  assert.equal(result.evidence[0].evidenceGrade,'NO_EVIDENCE');
  assert.equal(result.evidence[0].evidenceText,null);
  assert.ok(result.gaps.some(x=>x.id==='REQ-MT5'));
});

test('Junior Market Specialist credits genuine trading evidence while unsupported crypto remains a gap',()=>{
  const jd=`Responsibilities\n- Monitor trading activity and market exposure.\n- Perform market research and data-driven trading analysis.\nRequirements\n- Previous experience in market operations or trading is required.\nPreferred\n- Digital assets and crypto market experience preferred.`;
  const result=assessRecruiter({requirements:reqs(jd),cvText:MASTER,jobTitle:'Junior Market Specialist',cvMeta:META});
  assert.ok(result.topStrengths.length>=1);
  assert.ok(result.topStrengths.some(x=>/P&L|trades|market data|risk/i.test(x.evidenceText||'')));
  const crypto=result.evidence.find(x=>/digital assets|crypto/i.test(x.cleanText||''));assert.ok(crypto);assert.notEqual(crypto.evidenceGrade,'EXACT_EVIDENCE');assert.ok(result.gaps.includes(crypto));
  assert.ok(result.score>0&&result.score<100);
});

test('Forex Dealer ATS analyses the full JD, preserves multiword phrases/acronyms and leaves unsupported terms unsafe',()=>{
  const jd=`## Role\nForex Dealer\n## Requirements\n- MT5 trade execution is required.\n- Experience with A-Book and B-Book routing and liquidity provider management is required.\n- Monitor market exposure, margin and stop-out controls.\n- Understand scalping and latency arbitrage.\n- Perform trade hedging, pricing, swaps and commissions review.\n- Investigate execution complaints and manage risk and compliance.\n- FX market knowledge and Excel are required.\n- Bloomberg experience preferred.\n## Responsibilities\nExecute trades, monitor positions, manage liquidity and maintain regulatory controls with stakeholders.`;
  const requirements=reqs(jd),ats=assessAts({requirements,cvText:MASTER,jdText:jd});
  assert.equal(ats.label,'ATS ALIGNMENT');assert.match(ats.disclaimer,/not the employer ATS algorithm/i);
  assert.ok(ats.meaningfulTermsAnalysed>20);
  assert.ok(ats.categories.MULTIWORD_PHRASES.some(x=>['trade execution','liquidity provider','market exposure'].includes(x.term.toLowerCase())));
  assert.ok(ats.categories.ACRONYMS.some(x=>/^MT5$/i.test(x.term)));
  for(const term of ['mt5','a-book','b-book']){const x=ats.keywordMatrix.find(v=>v.term.toLowerCase()===term);assert.ok(x,`${term} should be inventoried`);assert.ok(['GENUINE_GAP','DO NOT ADD WITHOUT EVIDENCE'].includes(x.action));assert.notEqual(x.action,'SAFE_TO_INCORPORATE');}
  const mt5=ats.keywordMatrix.find(x=>x.term.toLowerCase()==='mt5'),bloomberg=ats.keywordMatrix.find(x=>x.term.toLowerCase()==='bloomberg');assert.ok(mt5.weight>bloomberg.weight);assert.ok(ats.mandatoryCoverage<100);assert.ok(ats.score<100);
  for(const term of ['liquidity provider','margin','stop-out','latency arbitrage','hedging','pricing','swaps','commissions','risk','compliance'])assert.ok(ats.keywordMatrix.some(x=>x.term.toLowerCase()===term),`${term} should be inventoried`);
});

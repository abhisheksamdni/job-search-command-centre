import test from 'node:test';
import assert from 'node:assert/strict';
import { extractRequirements } from '../src/services/requirements.mjs';
import { assessRecruiter } from '../src/services/recruiter.mjs';
import { assessAts } from '../src/services/atsExact.mjs';
import { tailorCvConservatively } from '../src/services/cvTailor.mjs';

const JD=`# Intraday Algorithmic Trader
## Responsibilities
- Develop, test and deploy algorithmic trading strategies.
## Requirements
- A minimum of 3 years intraday power algorithmic trading experience is required.
- Strong quantitative and analytical capability.
- Python is preferred.
- Bloomberg experience is a bonus.
- Excellent communication and stakeholder collaboration.
- A background in financial services and capital markets.
## About us
- Build a better future with an established global business operating in 30 markets.
- We welcome different experiences, races, religions, ages and parental status.`;

const CV=`PROFILE
Trading professional with experience in derivatives, execution, market analysis and risk management.
WORK EXPERIENCE
Northbridge Capital
Derivative Trading Analyst
Dec 2024 – Oct 2025
- Monitored live P&L, margin, portfolio exposure and daily risk checks across derivative trading activity.
- Executed options and futures trades and analysed market microstructure.
PROJECTS
SignalLab
- Built a Python strategy backtesting and validation framework for market-data research.
- Designing future risk and execution controls for simulated deployment.
EDUCATION
MSc International Financial Markets
SKILLS
Python
Collaborative
Collaboration`;

function byText(rows,needle){return rows.find(x=>String(x.cleanText||x.text).toLowerCase().includes(needle.toLowerCase()));}

test('56-point JD taxonomy retains candidate requirements and explicitly labels noise',()=>{
  const rows=extractRequirements(JD);
  assert.equal(byText(rows,'minimum of 3 years').category,'MANDATORY');
  assert.equal(byText(rows,'Develop, test and deploy').category,'CORE');
  assert.equal(byText(rows,'quantitative and analytical').category,'IMPORTANT');
  assert.equal(byText(rows,'Python is preferred').category,'PREFERRED');
  assert.equal(byText(rows,'Bloomberg experience').category,'BONUS');
  assert.equal(byText(rows,'communication and stakeholder').category,'BEHAVIOURAL');
  assert.equal(byText(rows,'background in financial services').category,'BACKGROUND');
  assert.equal(byText(rows,'Build a better future').category,'NOT_A_REQUIREMENT');
  assert.equal(byText(rows,'different experiences').importance,0);
});

test('requirement extraction removes encoded HTML residue before ATS and recruiter analysis',()=>{
  const rows=extractRequirements('REQUIREMENTS&lt;ul&gt;&lt;li&gt;SQL and VBA are advantageous&lt;/li&gt;&lt;li&gt;A numerate degree is required&lt;/li&gt;&lt;/ul&gt;'),text=rows.map(x=>x.cleanText).join(' ');
  assert.match(text,/SQL and VBA are advantageous/i);
  assert.match(text,/numerate degree is required/i);
  assert.doesNotMatch(text,/\b(?:lt|gt|li|ul|br)\b|&lt|&gt/i);
});

test('Senior Recruiter emits the complete intelligence record and six decision outputs',()=>{
  const requirements=extractRequirements(JD),result=assessRecruiter({requirements,cvText:CV,jobTitle:'Intraday Algorithmic Trader',cvMeta:{cvVersionId:1,documentSha:'master-sha',documentName:'Master.pdf'}}),record=result.recruiterIntelligenceRecord;
  assert.equal(record.version,'2.0.0-56-point');
  assert.ok(record.noise.length>=2);
  assert.ok(record.hiringArchetype.length);
  assert.ok(record.candidateArchetype.length);
  assert.ok(record.evidenceMatrix.length);
  assert.ok(record.terminologyMap.length);
  assert.ok(record.firstPassRecruiterScan);
  assert.ok(record.cvPresentationDeficiencies.some(x=>x.action==='REMOVE'));
  assert.ok(record.claimDefensibility.length);
  assert.ok(record.improvementInstructions.length);
  assert.ok(Number.isFinite(result.atsDiscoverabilityScore));
  assert.ok(Number.isFinite(result.evidenceMatchScore));
  assert.ok(Number.isFinite(result.recruiterQualificationScore));
  assert.ok(Number.isFinite(result.interviewRiskScore));
  assert.ok(result.jdMasterKeywordInventory.length);
  assert.ok(result.missingKeywordMatrix.length);
  assert.match(record.scoreDisclaimer,/not scores from a commercial employer ATS/i);
});

test('missing hard evidence becomes GAP_DO_NOT_ADD while project evidence is not professional tenure',()=>{
  const requirements=extractRequirements(JD),result=assessRecruiter({requirements,cvText:CV,jobTitle:'Intraday Algorithmic Trader'}),power=byText(result.evidence,'minimum of 3 years'),python=byText(result.evidence,'Python is preferred');
  assert.equal(power.evidenceGrade,'NO_EVIDENCE');
  assert.equal(result.improvementInstructions.find(x=>x.requirementId===power.id).action,'GAP_DO_NOT_ADD');
  assert.ok(['SKILLS_SECTION_ONLY','SUBSTANTIAL_INDEPENDENT_PROJECT'].includes(python.evidenceSourceType));
  assert.notEqual(python.evidenceSourceType,'RECENT_DIRECT_PROFESSIONAL_EXPERIENCE');
  assert.ok(result.score<=49,'a central missing mandatory tenure requirement must cap the score');
});

test('future/designing wording never receives completed-production credit',()=>{
  const requirements=extractRequirements('## Requirements\n- Production deployment of risk and execution controls is required.'),result=assessRecruiter({requirements,cvText:CV,jobTitle:'Algorithmic Trader'}),item=result.evidence[0];
  assert.equal(item.productionMaturity,'CONCEPT_OR_IN_PROGRESS');
  assert.ok(item.evidenceScore<=.4);
  assert.match(item.reason,/not credited as completed production evidence/i);
});

test('ATS inventory excludes employer marketing and inclusion boilerplate',()=>{
  const requirements=extractRequirements(JD),ats=assessAts({requirements,cvText:CV,jdText:JD}),terms=ats.keywordMatrix.map(x=>x.term.toLowerCase());
  assert.ok(ats.noiseExcluded>=2);
  assert.ok(!terms.includes('better future'));
  assert.ok(!terms.includes('parental status'));
});

test('CV Tailor consumes only controlled safe actions and preserves gaps',()=>{
  const requirements=extractRequirements(JD),recruiter=assessRecruiter({requirements,cvText:CV,jobTitle:'Intraday Algorithmic Trader'}),ats=assessAts({requirements,cvText:CV,jdText:JD}),tailored=tailorCvConservatively({cvText:CV,requirements,recruiter,ats,jobTitle:'Intraday Algorithmic Trader'});
  assert.ok(tailored.structuredChanges.improvementInstructionsConsumed.every(x=>['SURFACE','REPHRASE','STRENGTHEN'].includes(x.action)));
  assert.ok(tailored.structuredChanges.controlledActions.every(x=>['SURFACE','REPHRASE','STRENGTHEN','GAP_DO_NOT_ADD','REMOVE'].includes(x.action)));
  assert.doesNotMatch(tailored.text,/3 years intraday power/i);
  assert.ok(tailored.structuredChanges.keywordsNotIncorporated.some(x=>/intraday power/i.test(x)));
  assert.ok(tailored.structuredChanges.improvementInstructionsConsumed.length<recruiter.improvementInstructions.length,'receiving an instruction must not be recorded as applying it');
  assert.ok(tailored.structuredChanges.instructionExecution.every(x=>['APPLIED','ALREADY_SATISFIED','NOT_APPLIED','PROTECTED_GAP'].includes(x.status)));
});

test('wrapped CV evidence is reconstructed and specific responsibilities map to defensible source lines',()=>{
  const jd=['RESPONSIBILITIES','- Support daily trading activity, including trade capture and reconciliation.','- Work alongside traders on research, analysis, and development of trading ideas.','- Contribute to internal market commentary and analytical reporting.','REQUIREMENTS','- Exposure to programming or data analysis tools such as Python is advantageous but not required.'].join('\n');
  const cv=['PROFILE','Trading professional with financial markets experience.','WORK EXPERIENCE','Northbridge Capital','Derivative Trading Analyst','Dec 2024 – Oct 2025','• Prepared execution summaries, reconciled positions and supported','portfolio exposures within defined risk parameters.','• Converted market observations into structured trade ideas using order-book','behaviour and liquidity shifts.','Kestrel Capital','Market Analyst','Apr 2023 – Jun 2023','• Authored client updates that communicated complex market trends.','RESEARCH EXPERIENCE AND PROJECTS','SignalLab','• Built Python research tests for systematic trading strategies.'].join('\n');
  const result=assessRecruiter({requirements:extractRequirements(jd),cvText:cv,jobTitle:'Junior Trader'}),byReq=needle=>result.evidence.find(x=>x.cleanText.toLowerCase().includes(needle));
  assert.match(byReq('trade capture').evidenceText,/reconciled positions/i);
  assert.match(byReq('trading ideas').evidenceText,/structured trade ideas/i);
  assert.match(byReq('market commentary').evidenceText,/client updates.*market trends/i);
  assert.match(byReq('programming').evidenceText,/Python research tests/i);
});

test('employer selling points are noise and experience caps cannot become CV strengthening instructions',()=>{
  const requirements=extractRequirements(['ABOUT THE ROLE','- The role offers structured onboarding, clear performance-based progression, and the opportunity to build a long-term career.','REQUIREMENTS','- Recent graduate with up to 1 year of relevant professional experience.'].join('\n'));
  assert.equal(requirements[0].category,'NOT_A_REQUIREMENT');
  const extended=CV+'\nHarbour Lane Partners\nEquity Trader\nFeb 2021 – May 2022\n- Executed equity and derivatives trades.',result=assessRecruiter({requirements,cvText:extended,jobTitle:'Junior Trader'}),cap=result.improvementInstructions.find(x=>/up to 1 year/i.test(x.requirement));
  assert.equal(cap.action,'GAP_DO_NOT_ADD');
});

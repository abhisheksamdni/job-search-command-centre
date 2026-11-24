import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'jcc-part2-'));
process.env.JCC_ROOT=root;

const { migrate }=await import('../src/migrate.mjs');
const { paths }=await import('../src/paths.mjs');
const { tailorCvConservatively }=await import('../src/services/cvTailor.mjs');
const { verifyTailored }=await import('../src/services/integrity.mjs');
const { humanizeGeneratedText,mechanicalSanitizeText }=await import('../src/services/textHumanizer.mjs');
const { createAtsDocx }=await import('../src/services/cvRenderer.mjs');
const { createTemplatePreservedDocx,readZipEntries }=await import('../src/services/docxTemplate.mjs');
const { createTailoredCvOutputsPreservingTemplate }=await import('../src/services/cvOutput.mjs');
const { tailorJob }=await import('../src/services/jobWorkflow.mjs');
const { activeMasterCv,activeMasterTemplate,setMasterTemplate }=await import('../src/services/cvLibrary.mjs');

function sha(buf){return crypto.createHash('sha256').update(buf).digest('hex');}
function dbFixture(){const db=new DatabaseSync(':memory:');migrate(db);return db;}
function entryMap(file){return new Map(readZipEntries(fs.readFileSync(file)));}
const MASTER=[
 'PROFILE',
 'Trading professional with experience across derivatives, equities and financial markets, combining execution, market analysis and risk monitoring.',
 'WORK EXPERIENCE',
 'Northbridge Capital',
 'Derivative Trading Analyst',
 'Dec 2024 – Oct 2025',
 '• Responsible for monitoring market exposure and trading risk across forex and derivatives activity.',
 '• Improved execution workflow by using structured risk limits, reducing slippage by 12%.',
 '• Prepared routine operational documentation for the desk.',
 'CERTIFICATIONS',
 'CISI Level 4',
 'EPAT',
 'PROJECTS',
 'SignalLab',
 '• Built systematic trading research tests using market microstructure observations.',
 '• Documented project administration and file structure.'
].join('\n');

function intelligence(){
 return {
  recruiter:{topStrengths:[{function:['trading','execution'],assetClass:['derivatives'],tool:[],technicalSkill:['market microstructure']}]},
  ats:{keywordMatrix:[
   {term:'derivatives',category:'ASSET_CLASSES',action:'EXACT_PRESENT'},
   {term:'FX',category:'ACRONYMS',action:'SUPPORTED_EQUIVALENT'},
   {term:'market microstructure',category:'METHODOLOGIES',action:'EXACT_PRESENT'},
   {term:'EPAT',category:'CERTIFICATIONS',action:'EXACT_PRESENT'},
   {term:'MT5',category:'PLATFORMS',action:'GENUINE_GAP'}
  ]}
 };
}

test('deterministic fallback produces a role-specific profile, safe bullet rewrite and supported ATS terminology',()=>{
 const i=intelligence(),result=tailorCvConservatively({cvText:MASTER,requirements:[{category:'CORE',text:'Derivatives trade execution and FX market risk'}],recruiter:i.recruiter,ats:i.ats,jobTitle:'Derivatives Trader'});
 assert.equal(result.materialChange.meaningful,true);
 assert.equal(result.structuredChanges.tailoringQuality.passed,true);
 assert.ok(result.structuredChanges.tailoringQuality.appliedInstructions>=result.structuredChanges.tailoringQuality.minimumApplied);
 assert.ok(result.structuredChanges.profile);
 assert.notEqual(result.structuredChanges.profile.before,result.structuredChanges.profile.after);
 assert.match(result.text,/Monitored market exposure and trading risk/i);
 assert.match(result.text,/FX \(forex\)/);
 assert.match(result.text,/12%/);
 assert.equal((result.text.match(/12%/g)||[]).length,1);
 assert.ok(result.structuredChanges.experienceBullets.length>=2);
 assert.ok(result.structuredChanges.keywordsSafelyIncorporated.includes('FX'));
 assert.ok(result.structuredChanges.keywordsNotIncorporated.includes('MT5'));
 assert.match(result.changeLog,/PROFILE/);
 assert.match(result.changeLog,/EXPERIENCE BULLET/);
 assert.match(result.changeLog,/KEYWORDS NOT INCORPORATED/);
 assert.doesNotMatch(result.text,/Relevant experience includes .* exposure/i);
 const check=verifyTailored({masterText:MASTER,tailoredText:result.text});
 assert.equal(check.integrity,'PASS',JSON.stringify(check.unsupportedClaims));
});

test('relevance ordering surfaces supported project/certification evidence without changing chronology facts',()=>{
 const i=intelligence(),result=tailorCvConservatively({cvText:MASTER,requirements:[{category:'CORE',text:'Market microstructure research and EPAT'}],recruiter:i.recruiter,ats:i.ats,jobTitle:'Trading Research Analyst'});
 assert.ok(result.text.indexOf('EPAT')<result.text.indexOf('CISI Level 4'));
 assert.ok(result.text.indexOf('Built systematic trading research tests')<result.text.indexOf('Documented project administration'));
 assert.match(result.text,/Dec 2024 – Oct 2025/);
 assert.match(result.text,/Northbridge Capital\nDerivative Trading Analyst/);
});

test('Energy Trader tailoring surfaces existing commodity and crude-oil evidence instead of relabelling the candidate',()=>{
 const master=[
  'PROFILE',
  'Trading professional with experience across equities, derivatives, futures and options, combining discretionary trading, market analysis, strategy development and risk management.',
  'WORK EXPERIENCE',
  'Northbridge Capital',
  'Derivative Trading Analyst',
  'Dec 2024 – Oct 2025',
  '• Executed simulated and live discretionary trades across equities, futures, options and commodities while assessing liquidity and execution risk.',
  'PROJECTS',
  'Quantitative Trading Strategy',
  '• Developed a discretionary trading system across equity, derivatives and commodities markets, including crude oil, silver and gold.',
  'SKILLS',
  'Soft Skills: Collaborative, Collaboration, Analytical thinking, Self-Motivated'
 ].join('\n');
 const requirements=[{category:'CORE',text:'Trade and optimise short-term power and energy positions.'},{category:'MANDATORY',text:'Commodity trading and risk management experience required.'},{category:'PREFERRED',text:'SQL, VBA and PLEXOS are preferred.'}],result=tailorCvConservatively({cvText:master,requirements,jobTitle:'Energy Trader'});
 assert.equal(result.structuredChanges.tailoringQuality.version,'2.1.0-semantic');
 assert.equal(result.structuredChanges.tailoringQuality.semanticChangePassed,true);
 assert.equal(result.structuredChanges.tailoringQuality.passed,true);
 assert.match(result.text,/PROFILE\nTrading professional with experience across commodities, crude oil, futures, options,? and derivatives/i);
 assert.doesNotMatch(result.text,/\bEnergy Trader\b/i);
 assert.ok(result.structuredChanges.profile.semanticFocusTerms.includes('commodities'));
 assert.ok(result.structuredChanges.profile.semanticFocusTerms.includes('crude oil'));
 assert.equal(verifyTailored({masterText:master,tailoredText:result.text}).integrity,'PASS');
});

test('reordering and generic soft-skill cleanup alone cannot pass as substantive tailoring',()=>{
 const source=['PROFILE','Trading professional with experience across equities, derivatives, futures, options and commodities, combining trade execution, discretionary trading, market analysis and risk management.','WORK EXPERIENCE','Example Capital','Trader','Jan 2024 – Present','• Executed trades across derivatives and commodities.','SKILLS','Soft Skills: Collaborative, Collaboration, Self-Motivated, Analytical thinking'].join('\n');
 const result=tailorCvConservatively({cvText:source,requirements:[{category:'CORE',text:'Trading execution and market risk'}],jobTitle:'Trader'});
 assert.equal(result.structuredChanges.tailoringQuality.semanticChangePassed,false);
 assert.equal(result.structuredChanges.tailoringQuality.passed,false);
 assert.equal(result.structuredChanges.tailoringQuality.substantiveChanges,0);
 assert.ok(result.structuredChanges.tailoringQuality.presentationChanges>=1);
 assert.equal(result.materialChange.meaningful,false);
});

test('certification ordering never pulls project headings or wrapped project lines into certifications',()=>{
 const i=intelligence(),source=MASTER.replace('PROJECTS','RESEARCH EXPERIENCE AND PROJECTS').replace('SignalLab','SignalLab\nSystematic trading research platform');
 const result=tailorCvConservatively({cvText:source,requirements:[{category:'CORE',text:'Market microstructure research and EPAT'}],recruiter:i.recruiter,ats:i.ats,jobTitle:'Trading Research Analyst'});
 const cert=result.text.indexOf('CERTIFICATIONS'),research=result.text.indexOf('RESEARCH EXPERIENCE AND PROJECTS'),project=result.text.indexOf('SignalLab'),description=result.text.indexOf('Systematic trading research platform');
 assert.ok(cert<research&&research<project&&project<description);
 assert.doesNotMatch(result.changeLog,/CERTIFICATION_PRIORITY.*SignalLab/);
});

test('Google XYZ retains genuine Y and never manufactures a metric',()=>{
 const i=intelligence(),result=tailorCvConservatively({cvText:MASTER,requirements:[{category:'CORE',text:'execution risk'}],recruiter:i.recruiter,ats:i.ats,jobTitle:'Trader'});
 const metric=result.evidenceMap.bulletAudit.find(x=>/12%/.test(x.line)),plain=result.evidenceMap.bulletAudit.find(x=>/market exposure/.test(x.line));
 assert.ok(metric);assert.ok(['XYZ_COMPLETE_OR_EQUIVALENT','METRIC_PRESENT_METHOD_NOT_EXPLICIT'].includes(metric.xyzStatus));
 assert.equal(plain.xyzStatus,'NO_METRIC_DO_NOT_INVENT');
 assert.equal((result.text.match(/\b\d+(?:\.\d+)?%/g)||[]).join(','),'12%');
});

test('Humanizer keeps semantic text/facts while deterministic sanitation removes safe invisible residue',()=>{
 const source='Market microstructure\u200b analysis — return 12% using risk limits.';
 const out=humanizeGeneratedText(source,{domain:'CV'});
 assert.doesNotMatch(out,/\u200b/);assert.match(out,/Market microstructure analysis/);assert.match(out,/12%/);assert.match(out,/—/);
 assert.equal(mechanicalSanitizeText('A\u200bB\u200cC'),'AB\u200cC');
});

test('post-tailor verifier rejects unsupported numbers, tools, assets, leadership and achievement inflation',()=>{
 for(const bad of [
  MASTER+'\n• Improved trading performance by 99%.',
  MASTER+'\n• Built MT5 automation for execution.',
  MASTER+'\n• Traded crypto portfolios.',
  MASTER+'\n• Led a team of traders.',
  MASTER+'\n• Achieved award-winning portfolio performance.'
 ]){const r=verifyTailored({masterText:MASTER,tailoredText:bad});assert.equal(r.integrity,'FAIL');assert.ok(r.unsupportedClaims.length>0);}
});

test('template renderer applies verified line changes inside the original DOCX package',async()=>{
 const dir=fs.mkdtempSync(path.join(root,'template-change-')),master=path.join(dir,'master.docx'),child=path.join(dir,'child.docx');
 await createAtsDocx({text:'PROFILE\nTrading professional with derivatives experience\nWORK EXPERIENCE\n• Responsible for monitoring market exposure and trading risk\nEDUCATION\nMSc International Financial Markets',outPath:master});
 const before=entryMap(master),out=createTemplatePreservedDocx({sourcePath:master,outPath:child,keyTerms:['risk'],lineChanges:[{before:'Responsible for monitoring market exposure and trading risk',after:'Monitored market exposure and trading risk'}]}),after=entryMap(child);
 assert.equal(out.unappliedChanges.length,0);assert.equal(out.appliedChanges,1);assert.deepEqual(after.get('word/styles.xml'),before.get('word/styles.xml'));assert.ok(after.has('word/document.xml'));
 assert.match(after.get('word/document.xml').toString('utf8'),/Monitored/);
 assert.doesNotMatch(after.get('word/document.xml').toString('utf8'),/Responsible for monitoring/);
});

test('PDF/DOCX output reports template fallback truthfully when verified text cannot be applied',async()=>{
 const dir=fs.mkdtempSync(path.join(root,'template-fallback-')),master=path.join(dir,'master.docx'),base=path.join(dir,'tailored');
 await createAtsDocx({text:'PROFILE\nDifferent template content\nEXPERIENCE\n• Different bullet',outPath:master});
 const out=await createTailoredCvOutputsPreservingTemplate({text:'PROFILE\nTrading professional\nEXPERIENCE\n• Monitored market exposure',basePath:base,sourcePath:master,keyTerms:['market exposure'],lineChanges:[{before:'Responsible for monitoring market exposure',after:'Monitored market exposure'}]});
 assert.equal(out.templatePreserved,false);assert.equal(out.pdfTemplatePreserved,false);assert.ok(out.warnings.some(x=>/could not apply/i.test(x)));assert.ok(out.renderer);assert.ok(fs.existsSync(out.docx.path));assert.ok(fs.existsSync(out.pdf.path));
});

function workflowFixture(){
 const db=dbFixture();fs.mkdirSync(paths.cvMaster,{recursive:true});
 const masterPath=path.join(paths.cvMaster,'part2-master-'+crypto.randomUUID()+'.txt'),bytes=Buffer.from(MASTER);fs.writeFileSync(masterPath,bytes);const hash=sha(bytes);
 const docId=Number(db.prepare('INSERT INTO cv_documents(original_filename,stored_path,sha256,mime_type,extracted_text) VALUES (?,?,?,?,?)').run('master.txt',masterPath,hash,'text/plain',MASTER).lastInsertRowid);
 const masterId=Number(db.prepare("INSERT INTO cv_versions(document_id,version_label,is_master,is_active) VALUES (?,'MASTER-PART2',1,1)").run(docId).lastInsertRowid);
 db.prepare("INSERT INTO cv_version_files(cv_version_id,format,path,sha256,mime_type,is_primary) VALUES (?,'TXT',?,?,'text/plain',1)").run(masterId,masterPath,hash);
 db.prepare("INSERT INTO settings(key,value) VALUES ('local_writer_enabled','0') ON CONFLICT(key) DO UPDATE SET value='0'").run();
 const jobId=Number(db.prepare("INSERT INTO jobs(company,title,location_raw,canonical_job_url,application_url,status,role_classification,location_confidence) VALUES ('Part2 Capital','Derivatives Trading Analyst','London','https://example.test/part2','https://example.test/part2','DISCOVERED','ROLE_MATCH',100)").run().lastInsertRowid);
 const jd=['RESPONSIBILITIES','- Monitor market exposure and trading risk across derivatives execution.','- Analyse market microstructure for trading decisions.','REQUIREMENTS','- Derivatives trading experience is required.','- FX market knowledge is preferred.'].join('\n');
 db.prepare("INSERT INTO job_jd_versions(job_id,jd_raw,jd_clean,jd_clean_hash,jd_quality) VALUES (?,?,?,?,?)").run(jobId,jd,jd,sha(Buffer.from(jd)),'GOOD');
 return{db,masterId,masterPath,masterHash:hash,jobId};
}

test('workflow creates one meaningful Master child, reruns intelligence, then suppresses an identical second request',async()=>{
 const f=workflowFixture(),before=fs.readFileSync(f.masterPath);
 const first=await tailorJob(f.db,f.jobId);assert.equal(first.status,'TAILORED');assert.ok(first.tailoredCvVersionId);assert.equal(first.parentCvVersionId,f.masterId);assert.equal(first.parentIsMaster,true);assert.equal(first.integrity,'PASS');assert.deepEqual(first.unsupportedClaims,[]);assert.ok(first.structuredChanges);assert.ok(first.localWriter);assert.equal(first.localWriter.available,false);assert.ok(first.humanizerAudit);assert.ok(first.renderer);assert.deepEqual(fs.readFileSync(f.masterPath),before);assert.equal(sha(fs.readFileSync(f.masterPath)),f.masterHash);
 const child=f.db.prepare('SELECT * FROM cv_versions WHERE id=?').get(first.tailoredCvVersionId);assert.equal(child.parent_version_id,f.masterId);assert.equal(child.job_id,f.jobId);assert.equal(child.is_master,0);
 for(const type of ['RECRUITER','ATS_EXACT','POST_TAILOR']){const a=f.db.prepare('SELECT * FROM job_analysis WHERE job_id=? AND analysis_type=? ORDER BY id DESC LIMIT 1').get(f.jobId,type);assert.ok(a);assert.equal(a.cv_version_id,first.tailoredCvVersionId);}
 const countBefore=f.db.prepare('SELECT count(*) n FROM cv_versions WHERE job_id=?').get(f.jobId).n,second=await tailorJob(f.db,f.jobId),countAfter=f.db.prepare('SELECT count(*) n FROM cv_versions WHERE job_id=?').get(f.jobId).n;assert.equal(second.status,'NO_MEANINGFUL_CHANGE');assert.equal(countAfter,countBefore);assert.equal(second.existingCvVersionId,first.tailoredCvVersionId);f.db.close();
});

test('Active Master Content and Master DOCX Formatting Template remain independently selectable',async()=>{
 const f=workflowFixture(),dir=fs.mkdtempSync(path.join(root,'independent-template-')),docxPath=path.join(dir,'format.docx');await createAtsDocx({text:MASTER,outPath:docxPath});const buf=fs.readFileSync(docxPath),hash=sha(buf);
 const docId=Number(f.db.prepare('INSERT INTO cv_documents(original_filename,stored_path,sha256,mime_type,extracted_text) VALUES (?,?,?,?,?)').run('format.docx',docxPath,hash,'application/vnd.openxmlformats-officedocument.wordprocessingml.document',MASTER).lastInsertRowid),templateId=Number(f.db.prepare("INSERT INTO cv_versions(document_id,version_label,is_master,is_active) VALUES (?,'FORMAT-TEMPLATE',1,0)").run(docId).lastInsertRowid);
 setMasterTemplate(f.db,templateId);assert.equal(activeMasterCv(f.db).id,f.masterId);assert.equal(activeMasterTemplate(f.db).id,templateId);f.db.close();
});

test('dashboard source exposes structured JD re-clean and independent template controls',()=>{
 const js=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');assert.match(js,/RE-CLEAN STORED JD/);assert.match(js,/Formatting Template/);assert.match(js,/renderStructuredText/);assert.match(js,/NO_MEANINGFUL_CHANGE/);
});

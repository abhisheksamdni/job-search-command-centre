import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { humanizeGeneratedText,auditHumanWriting,cleanTextArtifacts } from '../src/services/textHumanizer.mjs';
import { tailorCvConservatively } from '../src/services/cvTailor.mjs';
import { activeMasterCv } from '../src/services/cvLibrary.mjs';

const readMigration=name=>fs.readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8');

function dbFixture(){const db=new DatabaseSync(':memory:');db.exec(readMigration('001_initial.sql'));db.exec(readMigration('002_cv_version_files.sql'));return db;}

test('humanizer removes invisible artifacts and generated correspondence boilerplate without adding facts',()=>{
 const input='I hope this message finds you well.\nI am writing to express my strong interest in the Trader role.\u200b\nReturn: 31%';
 const out=humanizeGeneratedText(input,{domain:'OUTREACH'});
 assert.doesNotMatch(out,/hope this message finds you well/i);
 assert.doesNotMatch(out,/writing to express my strong interest/i);
 assert.match(out,/Trader role/);
 assert.match(out,/31%/);
 assert.equal(cleanTextArtifacts('A\u200bB'),'AB');
});

test('humanizer audit flags residue but does not claim detector status',()=>{
 const r=auditHumanWriting('Here is the revised version. [Company Name]');
 assert.equal(r.ok,false);
 assert.ok(r.findings.includes('placeholder'));
 assert.equal('score' in r,false);
});

test('CV tailoring preserves non-bullet structure and never invents a metric for XYZ',()=>{
 const cv=['PROFILE','Trading analyst','WORK EXPERIENCE','Northbridge Capital','• Executed derivatives trades across equities and futures','• Improved execution workflow by using structured limits, reducing slippage by 12%','EDUCATION','MSc International Financial Markets'].join('\n');
 const result=tailorCvConservatively({cvText:cv,requirements:[{text:'Derivatives trading and futures execution'}]});
 assert.match(result.text,/PROFILE\nTrading analyst\nWORK EXPERIENCE\nNorthbridge Capital/);
 assert.match(result.text,/EDUCATION\nMSc International Financial Markets/);
 assert.doesNotMatch(result.text,/\b(?!12)\d+%\b/);
 assert.equal(result.evidenceMap.xyzCoverage.totalBullets,2);
 assert.equal(result.evidenceMap.xyzCoverage.noMetricDoNotInvent,1);
});

test('active Master CV remains the baseline even when a tailored child is marked active',()=>{
 const db=dbFixture();
 const d1=Number(db.prepare("INSERT INTO cv_documents(original_filename,stored_path,sha256,mime_type,extracted_text) VALUES ('master.docx','master.docx','hash-master','application/vnd.openxmlformats-officedocument.wordprocessingml.document','MASTER')").run().lastInsertRowid);
 const master=Number(db.prepare("INSERT INTO cv_versions(document_id,version_label,is_master,is_active) VALUES (?,'MASTER',1,1)").run(d1).lastInsertRowid);
 const d2=Number(db.prepare("INSERT INTO cv_documents(original_filename,stored_path,sha256,mime_type,extracted_text) VALUES ('child.docx','child.docx','hash-child','application/vnd.openxmlformats-officedocument.wordprocessingml.document','CHILD')").run().lastInsertRowid);
 db.prepare("INSERT INTO cv_versions(document_id,parent_version_id,version_label,is_master,is_active,job_id) VALUES (?,?,'CHILD',0,1,99)").run(d2,master);
 const selected=activeMasterCv(db);
 assert.equal(selected.id,master);
 assert.equal(selected.extracted_text,'MASTER');
 db.close();
});

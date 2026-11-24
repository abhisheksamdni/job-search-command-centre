import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAtsDocx } from '../src/services/cvRenderer.mjs';
import { createTemplatePreservedDocx,readZipEntries } from '../src/services/docxTemplate.mjs';
import { inferPublicContact,parseAgentReachSearchResults } from '../src/services/contactResearch.mjs';

function entryMap(file){return new Map(readZipEntries(fs.readFileSync(file)));}

test('template-preserved DOCX keeps styles and document package while producing a new child file',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'jcc-template-'));const master=path.join(root,'master.docx'),child=path.join(root,'child.docx');
 await createAtsDocx({text:'PROFILE\nTrading analyst\nEXPERIENCE\n• Excel exposure monitoring\n• Derivatives futures execution\nEDUCATION\nMSc International Financial Markets',outPath:master});
 const before=entryMap(master);const out=createTemplatePreservedDocx({sourcePath:master,outPath:child,keyTerms:['derivatives','futures']});const after=entryMap(child);
 assert.equal(out.renderer,'master-template-openxml');assert.ok(fs.existsSync(child));assert.notEqual(child,master);assert.deepEqual(after.get('word/styles.xml'),before.get('word/styles.xml'));assert.ok(after.has('[Content_Types].xml'));assert.ok(after.has('word/document.xml'));
});

test('public contact research never invents a name from a LinkedIn slug',()=>{
 const noTitle=inferPublicContact({title:'',text:'Senior recruiter at Example Capital',url:'https://www.linkedin.com/in/jane-doe-12345'},'Example Capital');assert.equal(noTitle.name,'');assert.equal(noTitle.personLike,false);
 const explicit=inferPublicContact({title:'Jane Doe - Senior Recruiter | LinkedIn',text:'Example Capital',url:'https://www.linkedin.com/in/jane-doe'},'Example Capital');assert.equal(explicit.name,'Jane Doe');assert.equal(explicit.personLike,true);assert.ok(explicit.confidence>=0.7);
});

test('Agent Reach contact-result parser requires sourced URLs',()=>{
 const rows=parseAgentReachSearchResults('[Jane Doe - Recruiter](https://www.linkedin.com/in/jane-doe)\nNo URL Name');assert.equal(rows.length,1);assert.equal(rows[0].title,'Jane Doe - Recruiter');
});

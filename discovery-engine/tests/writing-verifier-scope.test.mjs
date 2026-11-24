import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyTailored } from '../src/services/integrity.mjs';

test('post-tailor verifier rejects unsupported managerial and performance scope inflation',()=>{
  const master='• Supported derivatives execution using structured risk limits';
  const managerial='• Managed derivatives execution using structured risk limits';
  const performance='• Supported derivatives execution and generated alpha using structured risk limits';
  const a=verifyTailored({masterText:master,tailoredText:managerial});
  const b=verifyTailored({masterText:master,tailoredText:performance});
  assert.equal(a.integrity,'FAIL');
  assert.ok(a.unsupportedClaims.some(x=>x.code==='SCOPE_INFLATION'));
  assert.equal(b.integrity,'FAIL');
  assert.ok(b.unsupportedClaims.some(x=>x.code==='SCOPE_INFLATION'));
});

test('post-tailor verifier rejects deletion of high-value source evidence',()=>{
  const master=['WORK EXPERIENCE','• Executed futures trades using structured risk limits','• Reconciled positions and prepared execution summaries for senior traders'].join('\n');
  const tailored=['WORK EXPERIENCE','• Executed futures trades using structured risk limits'].join('\n');
  const r=verifyTailored({masterText:master,tailoredText:tailored});
  assert.equal(r.integrity,'FAIL');
  assert.ok(r.unsupportedClaims.some(x=>x.code==='DELETED_HIGH_VALUE_EVIDENCE'));
});

test('CV workflow always runs Humanizer before final factual verification',()=>{
  const src=fs.readFileSync(new URL('../src/services/jobWorkflow.mjs',import.meta.url),'utf8');
  const humanizer=src.indexOf("humanizeGeneratedText(local.text,{domain:'CV'})");
  const verification=src.indexOf('verifyTailored({masterText:parent.extracted_text');
  assert.ok(humanizer>=0);
  assert.ok(verification>humanizer);
});

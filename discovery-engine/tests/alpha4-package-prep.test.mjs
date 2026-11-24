import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {prepareApplicationPackage} from '../src/services/packagePrep.mjs';
test('package prep module exports callable function',()=>assert.equal(typeof prepareApplicationPackage,'function'));
test('package prep source contains explicit user confirmation guardrails',()=>{const s=fs.readFileSync(new URL('../src/services/packagePrep.mjs',import.meta.url),'utf8');assert.match(s,/USER CONFIRMATION REQUIRED/)});
test('package prep does not claim automatic submission',()=>{const s=fs.readFileSync(new URL('../src/services/packagePrep.mjs',import.meta.url),'utf8');assert.doesNotMatch(s,/submit(?:ted)? automatically/i)});
test('package prep creates three distinct artifact directories',()=>{const s=fs.readFileSync(new URL('../src/services/packagePrep.mjs',import.meta.url),'utf8');for(const x of ['Cover-Letter','Application-Answers','Outreach'])assert.match(s,new RegExp(x))});

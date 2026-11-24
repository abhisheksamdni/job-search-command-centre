import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPortableRelease } from '../scripts/build-portable-release.mjs';

test('portable release is allow-listed, private-data-free and installable by wrapper',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'jcc-portable-test-'));
  const destination=path.join(temp,'JCC-LOCAL-test-portable');
  const result=buildPortableRelease(destination);
  assert.equal(result.target,destination);
  for(const required of ['README-FIRST.txt','INSTALL-JCC.bat','START-JCC.bat','STOP-JCC.bat','SHA256SUMS.txt','jcc-local/package.json','jcc-local/package-lock.json'])assert.equal(fs.existsSync(path.join(destination,...required.split('/'))),true,required);
  for(const forbidden of ['JCC-Data','JCC-Knowledge','Job Applications','node_modules','.git'])assert.equal(fs.existsSync(path.join(destination,forbidden)),false,forbidden);
  const install=fs.readFileSync(path.join(destination,'INSTALL-JCC.bat'),'utf8');
  assert.match(install,/jcc-local/);assert.match(install,/install\.bat/);
  const manifest=fs.readFileSync(path.join(destination,'SHA256SUMS.txt'),'utf8');
  assert.match(manifest,/jcc-local\/package\.json/);assert.doesNotMatch(manifest,/JCC-Data|JCC-Knowledge|node_modules/);
});

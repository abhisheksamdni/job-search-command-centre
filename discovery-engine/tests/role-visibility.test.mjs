import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { listJobs } from '../src/services/jobQueries.mjs';
import { dashboardReadModel } from '../src/services/dashboardReadModel.mjs';
import { reconcileStoredJobRoles } from '../src/services/roleReconciliation.mjs';

function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jcc-role-visibility-'));
  const db=openDb(path.join(dir,'test.sqlite'));
  migrate(db);
  db.prepare("INSERT INTO target_roles(family,phrase,enabled) VALUES ('INVESTMENT_RESEARCH','Investment Analyst',1)").run();
  const add=(title,classification='ROLE_MATCH',status='DISCOVERED')=>Number(db.prepare("INSERT INTO jobs(company,title,canonical_job_url,application_url,role_classification,status) VALUES ('Test Co',?,?,?, ?,?)").run(title,`https://example.test/${encodeURIComponent(title)}`,`https://example.test/${encodeURIComponent(title)}`,classification,status).lastInsertRowid);
  return {db,dir,add,close(){db.close();fs.rmSync(dir,{recursive:true,force:true});}};
}

test('stored false positives are reclassified and hidden without deleting application records',()=>{
  const f=fixture();
  try{
    const falsePositive=f.add('Investment Manager');
    const valid=f.add('Senior Investment Analyst');
    const overridden=f.add('Portfolio Manager');
    f.db.prepare("UPDATE jobs SET application_override_at=CURRENT_TIMESTAMP,application_override_reason='User chose it',application_override_actor='USER' WHERE id=?").run(overridden);
    const actedOn=f.add('Private Equity Associate');
    f.db.prepare("INSERT INTO applications(job_id,status,application_folder) VALUES (?,'SAVED',?)").run(actedOn,path.join(f.dir,'application'));
    const archived=f.add('Old Irrelevant Role','ROLE_MATCH','ARCHIVED');

    const result=reconcileStoredJobRoles(f.db);
    assert.equal(result.changed,5);
    assert.equal(f.db.prepare('SELECT role_classification c FROM jobs WHERE id=?').get(falsePositive).c,'ROLE_REJECTED');
    assert.equal(f.db.prepare('SELECT role_classification c FROM jobs WHERE id=?').get(valid).c,'ROLE_MATCH');

    const activeIds=new Set(listJobs(f.db).map(x=>x.id));
    assert.deepEqual(activeIds,new Set([valid,overridden]));
    const visibleAllIds=new Set(listJobs(f.db,{scope:'visible-all'}).map(x=>x.id));
    assert.deepEqual(visibleAllIds,new Set([valid,overridden,archived]));
    assert.equal(listJobs(f.db,{scope:'all'}).length,5);
    assert.equal(f.db.prepare('SELECT count(*) n FROM applications WHERE job_id=?').get(actedOn).n,1);

    const dashboard=dashboardReadModel(f.db);
    assert.equal(dashboard.activeJobs,2);
    assert.equal(dashboard.hiddenByRole,2);
    assert.equal(dashboard.archived,1);
    assert.equal(dashboard.totalStored,5);
  }finally{f.close();}
});

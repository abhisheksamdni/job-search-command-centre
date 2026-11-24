import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/migrate.mjs';
import { ingestJob } from '../src/services/jobs.mjs';

test('ingestion deduplicates LinkedIn URN/plain identifiers and HTML-encoded tracking variants',()=>{
  const db=new DatabaseSync(':memory:');migrate(db);
  const base={company:'Mason Alexander',title:'Energy Trader',location:'Dublin, Ireland'};
  const first=ingestJob(db,{...base,externalId:'urn:li:jobPosting:4468669425',applicationUrl:'https://ie.linkedin.com/jobs/view/energy-trader-at-mason-alexander-4468669425?position=5&pageNum=0&refId=one&trackingId=a'});
  const second=ingestJob(db,{...base,externalId:'4468669425',applicationUrl:'https://uk.linkedin.com/jobs/view/energy-trader-at-mason-alexander-4468669425?position=2&amp;pageNum=1&amp;refId=two&amp;trackingId=b'});
  assert.equal(second.jobId,first.jobId);assert.equal(db.prepare('SELECT count(*) n FROM jobs').get().n,1);
  const job=db.prepare('SELECT external_id,canonical_job_url FROM jobs').get();assert.equal(job.external_id,'4468669425');assert.equal(job.canonical_job_url,'https://linkedin.com/jobs/view/energy-trader-at-mason-alexander-4468669425');db.close();
});

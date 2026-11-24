import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { cleanJd,recleanStoredJob } from '../src/services/jdCleaner.mjs';

const readMigration=name=>fs.readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8');
function dbFixture(){const db=new DatabaseSync(':memory:');db.exec(readMigration('001_initial.sql'));return db;}

test('JD cleaner decodes encoded paragraph/list/strong entities before HTML parsing',()=>{
 const raw='&amp;lt;h2&amp;gt;ABOUT THE ROLE&amp;lt;/h2&amp;gt;&amp;lt;p&amp;gt;Lead &amp;amp; analyse markets.&amp;lt;/p&amp;gt;&amp;lt;ul&amp;gt;&amp;lt;li&amp;gt;&amp;lt;strong&amp;gt;Execute&amp;lt;/strong&amp;gt; trades&amp;lt;/li&amp;gt;&amp;lt;li&amp;gt;Monitor risk&amp;lt;/li&amp;gt;&amp;lt;/ul&amp;gt;';
 const r=cleanJd(raw);
 assert.doesNotMatch(r.jdClean,/&lt;|&gt;|<\/?(?:p|li|strong|h2)/i);
 assert.match(r.jdClean,/## ABOUT THE ROLE/);
 assert.match(r.jdClean,/Lead & analyse markets\./);
 assert.match(r.jdClean,/- Execute trades/);
 assert.match(r.jdClean,/- Monitor risk/);
});

test('JD cleaner preserves headings, paragraphs, bullets and numbered lists safely',()=>{
 const raw='<nav>Home Jobs Apply now</nav><h2>RESPONSIBILITIES</h2><p>First paragraph.</p><ul><li>Bullet one</li><li>Bullet two</li></ul><h3>REQUIREMENTS</h3><ol start="2"><li>Second item</li><li>Third item</li></ol><script>alert(1)</script>';
 const r=cleanJd(raw);
 assert.match(r.jdClean,/## RESPONSIBILITIES/);assert.match(r.jdClean,/First paragraph\./);assert.match(r.jdClean,/- Bullet one/);assert.match(r.jdClean,/- Bullet two/);assert.match(r.jdClean,/## REQUIREMENTS/);assert.match(r.jdClean,/2\. Second item/);assert.match(r.jdClean,/3\. Third item/);assert.doesNotMatch(r.jdClean,/Home Jobs|alert\(1\)|<script/i);
});

test('JD cleaner is idempotent',()=>{
 const raw='<h2>REQUIREMENTS</h2><p>Experience in trading.</p><ul><li>Excel</li><li>Risk management</li></ul>';
 const a=cleanJd(raw),b=cleanJd(a.jdClean);
 assert.equal(b.jdClean,a.jdClean);assert.equal(b.jdCleanHash,a.jdCleanHash);
});

test('stored JD can be re-cleaned idempotently while preserving raw source evidence',()=>{
 const db=dbFixture();const raw='&lt;h2&gt;REQUIREMENTS&lt;/h2&gt;&lt;ul&gt;&lt;li&gt;Trading&lt;/li&gt;&lt;/ul&gt;';
 const oldClean='&lt;h2&gt;REQUIREMENTS&lt;/h2&gt;';const jobId=Number(db.prepare("INSERT INTO jobs(company,title) VALUES ('X','Trader')").run().lastInsertRowid);
 const v=Number(db.prepare("INSERT INTO job_jd_versions(job_id,jd_raw,jd_clean,jd_clean_hash,jd_quality) VALUES (?,?,?,?,?)").run(jobId,raw,oldClean,'old-hash','POOR').lastInsertRowid);
 const first=recleanStoredJob(db,jobId);assert.equal(first.changed,true);const row=db.prepare('SELECT * FROM job_jd_versions WHERE id=?').get(first.jdVersionId);assert.equal(row.jd_raw,raw);assert.match(row.jd_clean,/## REQUIREMENTS/);assert.notEqual(first.jdVersionId,v);
 const second=recleanStoredJob(db,jobId);assert.equal(second.changed,false);assert.equal(second.jdVersionId,first.jdVersionId);assert.equal(db.prepare('SELECT count(*) n FROM job_jd_versions WHERE job_id=?').get(jobId).n,2);db.close();
});

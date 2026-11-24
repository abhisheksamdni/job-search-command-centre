import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/migrate.mjs';
import { seed } from '../src/seed.mjs';

const readMigration = name => fs.readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');

function alpha3Fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(readMigration('001_initial.sql'));
  db.prepare('INSERT INTO migrations(version) VALUES (?)').run('001_initial.sql');
  db.exec(readMigration('002_cv_version_files.sql'));
  db.prepare('INSERT INTO migrations(version) VALUES (?)').run('002_cv_version_files.sql');

  const insert = db.prepare('INSERT INTO target_locations(country,country_code,city,region,enabled) VALUES (?,?,?,?,?)');
  insert.run('United Arab Emirates','AE','Dubai',null,0);
  insert.run('United Arab Emirates','AE','Dubai',null,1);
  insert.run('United Arab Emirates','AE','Abu Dhabi',null,1);
  insert.run('United Arab Emirates','AE','Abu Dhabi',null,0);
  insert.run('Netherlands','NL','Amsterdam',null,0);
  insert.run('Netherlands','NL','Amsterdam',null,1);
  insert.run('Switzerland','CH',null,null,0);
  insert.run('Switzerland','CH',null,null,1);
  return db;
}

const oldFaultyUaeUpdate = `
UPDATE target_locations
SET region=city
WHERE upper(trim(COALESCE(country_code,'')))='AE'
  AND lower(trim(COALESCE(city,''))) IN ('dubai','abu dhabi')
  AND (region IS NULL OR trim(region)='');`;

const logicalDuplicates = db => db.prepare(`
  SELECT count(*) n FROM (
    SELECT
      lower(trim(COALESCE(NULLIF(country_code,''),country,''))) country_key,
      lower(trim(COALESCE(city,''))) city_key,
      lower(trim(COALESCE(region,''))) region_key,
      count(*) c
    FROM target_locations
    GROUP BY country_key,city_key,region_key
    HAVING c>1
  )`).get().n;

const normalizedDuplicates = db => db.prepare(`
  SELECT count(*) n FROM (
    SELECT normalized_key,count(*) c
    FROM target_locations
    WHERE normalized_key IS NOT NULL
    GROUP BY normalized_key
    HAVING c>1
  )`).get().n;

test('real alpha3 nullable target-location duplicates migrate safely to alpha4', () => {
  const db = alpha3Fixture();
  assert.equal(db.prepare('SELECT count(*) n FROM target_locations').get().n, 8);

  // Prove this fixture reproduces the exact old-candidate Windows blocker.
  assert.throws(
    () => db.exec(oldFaultyUaeUpdate),
    /UNIQUE constraint failed: target_locations\.country_code, target_locations\.city, target_locations\.region/
  );

  assert.doesNotThrow(() => migrate(db));
  assert.equal(db.prepare('SELECT count(*) n FROM migrations').get().n, 8);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(logicalDuplicates(db), 0);
  assert.equal(normalizedDuplicates(db), 0);

  const dubai = db.prepare("SELECT * FROM target_locations WHERE country_code='AE' AND city='Dubai'").all();
  assert.equal(dubai.length, 1);
  assert.equal(dubai[0].region, 'Dubai');
  assert.equal(dubai[0].normalized_key, 'ae|dubai|dubai');
  assert.equal(dubai[0].enabled, 1);

  const abuDhabi = db.prepare("SELECT * FROM target_locations WHERE country_code='AE' AND city='Abu Dhabi'").all();
  assert.equal(abuDhabi.length, 1);
  assert.equal(abuDhabi[0].region, 'Abu Dhabi');
  assert.equal(abuDhabi[0].normalized_key, 'ae|abu dhabi|abu dhabi');
  assert.equal(abuDhabi[0].enabled, 1);

  const amsterdam = db.prepare("SELECT * FROM target_locations WHERE country_code='NL' AND city='Amsterdam'").all();
  assert.equal(amsterdam.length, 1);
  assert.equal(amsterdam[0].normalized_key, 'nl|amsterdam|');
  assert.equal(amsterdam[0].enabled, 1);

  const switzerland = db.prepare("SELECT * FROM target_locations WHERE country_code='CH' AND city IS NULL AND region IS NULL").all();
  assert.equal(switzerland.length, 1);
  assert.equal(switzerland[0].normalized_key, 'ch||');
  assert.equal(switzerland[0].enabled, 1);

  // Repeated migrate/init-equivalent seeding must remain safe and idempotent.
  migrate(db);
  seed(db);
  migrate(db);
  seed(db);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(logicalDuplicates(db), 0);
  assert.equal(normalizedDuplicates(db), 0);
  assert.equal(db.prepare("SELECT count(*) n FROM target_locations WHERE normalized_key='ae|dubai|dubai'").get().n, 1);
  assert.equal(db.prepare("SELECT count(*) n FROM target_locations WHERE normalized_key='ae|abu dhabi|abu dhabi'").get().n, 1);
  assert.equal(db.prepare("SELECT count(*) n FROM target_locations WHERE normalized_key='nl|amsterdam|'").get().n, 1);
  assert.equal(db.prepare("SELECT count(*) n FROM target_locations WHERE normalized_key='ch||'").get().n, 1);
  db.close();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/migrate.mjs';
import { seed } from '../src/seed.mjs';
import { LocalScheduler } from '../src/scheduler.mjs';

function runNode(script, root, args=[]) {
  return spawnSync(process.execPath,[script,...args],{
    cwd:path.resolve('.'),env:{...process.env,JCC_ROOT:root},encoding:'utf8'
  });
}

function dbAt(root){return path.join(root,'JCC-Data','database','jcc.sqlite');}

function initialize(root){
  fs.mkdirSync(path.dirname(dbAt(root)),{recursive:true});
  const db=new DatabaseSync(dbAt(root));db.exec('PRAGMA foreign_keys=ON');migrate(db);seed(db);return db;
}

test('backup and restore preserve SQLite state and create a pre-restore safety backup',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jcc-ops-'));
  let db=initialize(root);
  db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('operation_test','before-backup')").run();
  db.close();

  const vault=path.join(root,'JCC-Knowledge');fs.mkdirSync(vault,{recursive:true});fs.writeFileSync(path.join(vault,'snapshot-only.md'),'snapshot');
  const backup=runNode('scripts/backup.mjs',root);
  assert.equal(backup.status,0,backup.stderr);
  const backupPath=backup.stdout.trim().split(/\r?\n/).at(-1);
  assert.ok(fs.existsSync(path.join(backupPath,'jcc.sqlite')));
  assert.ok(fs.existsSync(path.join(backupPath,'backup-manifest.json')));
  const backupName=path.basename(backupPath);

  fs.writeFileSync(path.join(vault,'stale-after-backup.md'),'must disappear on restore');
  db=new DatabaseSync(dbAt(root));
  db.prepare("UPDATE settings SET value='after-backup' WHERE key='operation_test'").run();
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='operation_test'").get().value,'after-backup');
  db.close();

  const beforeRestoreDirs=fs.readdirSync(path.join(root,'JCC-Data','Backups')).length;
  const restore=runNode('scripts/restore.mjs',root,[`--from=${backupName}`]);
  assert.equal(restore.status,0,restore.stderr);
  const afterRestoreDirs=fs.readdirSync(path.join(root,'JCC-Data','Backups')).length;
  assert.ok(afterRestoreDirs>beforeRestoreDirs,'restore must create a safety backup first');
  assert.equal(fs.existsSync(path.join(vault,'stale-after-backup.md')),false,'restore must replace the vault snapshot rather than merge stale notes');
  assert.equal(fs.readFileSync(path.join(vault,'snapshot-only.md'),'utf8'),'snapshot');

  db=new DatabaseSync(dbAt(root));
  assert.equal(db.prepare("SELECT value FROM settings WHERE key='operation_test'").get().value,'before-backup');
  const integrity=db.prepare('PRAGMA integrity_check').get();
  assert.equal(Object.values(integrity)[0],'ok');
  db.close();
});

test('scheduler defaults to MANUAL and AUTO can be explicitly enabled and stopped',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jcc-scheduler-'));
  const db=initialize(root);
  const scheduler=new LocalScheduler(db);

  const initial=scheduler.state();
  assert.equal(initial.mode,'MANUAL');
  assert.equal(initial.nextRun,null);
  assert.equal(initial.running,false);
  assert.equal(scheduler.timer,null);

  db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('mode','AUTO')").run();
  db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('auto_enabled','1')").run();
  db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('auto_every_hours','3')").run();
  db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('auto_on_startup','0')").run();
  scheduler.start();

  const auto=scheduler.state();
  assert.equal(auto.mode,'AUTO');
  assert.equal(auto.running,false);
  assert.ok(auto.nextRun);
  assert.ok(scheduler.timer);

  scheduler.stop();
  assert.equal(scheduler.timer,null);
  db.close();
});

test('stop refuses to signal an unverified PID and removes stale PID metadata',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jcc-stop-'));
  const logs=path.join(root,'JCC-Data','Logs');fs.mkdirSync(logs,{recursive:true});
  const pidFile=path.join(logs,'jcc.pid');
  fs.writeFileSync(pidFile,JSON.stringify({pid:process.pid,repoRoot:path.resolve('.'),host:'127.0.0.1',port:8787}));
  const refused=runNode('scripts/stop.mjs',root);
  assert.equal(refused.status,2);
  assert.match(refused.stderr,/REFUSED/);
  assert.ok(fs.existsSync(pidFile),'unverified PID record must remain for manual inspection');
  fs.writeFileSync(pidFile,JSON.stringify({pid:99999999,repoRoot:path.resolve('.'),host:'127.0.0.1',port:8787}));
  const stale=runNode('scripts/stop.mjs',root);
  assert.equal(stale.status,0,stale.stderr);
  assert.match(stale.stdout,/stale PID|not running/i);
  assert.equal(fs.existsSync(pidFile),false);
});

test('Windows launch scripts keep install/start/stop/doctor/backup/restore fail-fast contracts',()=>{
  const install=fs.readFileSync('install.bat','utf8');
  const start=fs.readFileSync('start-jcc.bat','utf8');
  const stop=fs.readFileSync('stop-jcc.bat','utf8');
  const doctor=fs.readFileSync('doctor.bat','utf8');
  const backup=fs.readFileSync('backup-jcc.bat','utf8');
  const restore=fs.readFileSync('restore-jcc.bat','utf8');
  assert.match(install,/Node\.js 22\+/);assert.match(install,/playwright install chromium/);assert.match(install,/npm test/);assert.match(install,/graph-index\.json/);
  assert.match(start,/127\.0\.0\.1:8787\/api\/health/);assert.match(start,/unexpected process\/JCC version/i);assert.match(start,/Start-Process/);assert.match(start,/server\.log/);
  assert.match(stop,/scripts\\stop\.mjs/);assert.match(doctor,/npm run doctor/);assert.match(backup,/npm run backup/);assert.match(restore,/scripts\\restore\.mjs/);assert.match(restore,/npm run doctor/);
});

test('restore refuses to run while JCC PID metadata is present',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jcc-restore-running-'));
  let db=initialize(root);db.close();
  const backup=runNode('scripts/backup.mjs',root);assert.equal(backup.status,0,backup.stderr);
  const backupName=path.basename(backup.stdout.trim().split(/\r?\n/).at(-1));
  const logs=path.join(root,'JCC-Data','Logs');fs.mkdirSync(logs,{recursive:true});
  fs.writeFileSync(path.join(logs,'jcc.pid'),JSON.stringify({pid:process.pid,repoRoot:path.resolve('.')}));
  const restore=runNode('scripts/restore.mjs',root,[`--from=${backupName}`]);
  assert.notEqual(restore.status,0);
  assert.match(restore.stderr,/Stop JCC.*before restore/i);
});

test('Doctor includes SQLite integrity as a required core check',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jcc-doctor-'));
  const d=initialize(root);d.close();
  const r=runNode('src/doctor.mjs',root);
  assert.equal(r.status,0,r.stderr);
  const parsed=JSON.parse(r.stdout);
  assert.equal(parsed.ok,true);
  assert.equal(parsed.checks.databaseIntegrity.ok,true);
});

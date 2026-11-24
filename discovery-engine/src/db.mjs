import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dbPath } from './paths.mjs';

let singleton;
export function openDb(file = dbPath) {
  if (file === dbPath && singleton) return singleton;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  if (file === dbPath) singleton = db;
  return db;
}

import fs from 'node:fs';
import { paths } from './paths.mjs';

export function initFolders() {
  for (const p of Object.values(paths)) {
    if (typeof p !== 'string') continue;
  }
  for (const p of [paths.cvMaster, paths.cvTailored, paths.cvArchive, paths.jobs, paths.applications,
    paths.contacts, paths.interviews, paths.reports, paths.exports, paths.backups, paths.logs, paths.browser, paths.temp, paths.graph, paths.workQueue]) {
    fs.mkdirSync(p, { recursive: true });
  }
  if (!fs.existsSync(paths.applicationView)) {
    try { fs.symlinkSync(paths.applications, paths.applicationView, 'junction'); } catch {}
  }
  fs.mkdirSync(paths.knowledgeRoot, { recursive: true });
  return paths;
}

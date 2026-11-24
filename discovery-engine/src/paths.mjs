import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '..');
export const localRoot = path.resolve(process.env.JCC_ROOT || path.join(repoRoot, '..'));
export const dataRoot = path.join(localRoot, 'JCC-Data');
export const knowledgeRoot = path.join(localRoot, 'JCC-Knowledge');
export const upstreamRoot = path.join(localRoot, '_upstream');
export const dbPath = path.join(dataRoot, 'database', 'jcc.sqlite');
export const paths = {
  repoRoot, localRoot, dataRoot, knowledgeRoot, upstreamRoot, dbPath,
  cvMaster: path.join(dataRoot, 'CV', 'Master'),
  cvTailored: path.join(dataRoot, 'CV', 'Tailored'),
  cvArchive: path.join(dataRoot, 'CV', 'Archive'),
  jobs: path.join(dataRoot, 'Jobs'),
  applications: path.join(dataRoot, 'Applications'),
  applicationView: path.join(localRoot, 'Job Applications'),
  contacts: path.join(dataRoot, 'Contacts'),
  interviews: path.join(dataRoot, 'Interviews'),
  reports: path.join(dataRoot, 'Reports'),
  exports: path.join(dataRoot, 'Exports'),
  backups: path.join(dataRoot, 'Backups'),
  logs: path.join(dataRoot, 'Logs'),
  browser: path.join(dataRoot, 'Browser'),
  temp: path.join(dataRoot, 'Temp'),
  graph: path.join(dataRoot, 'graph'),
  workQueue: path.join(dataRoot, 'Application-Production', 'Queue'),
  graphIndex: path.join(dataRoot, 'graph', 'graph-index.json')
};

import fs from 'node:fs';
import path from 'node:path';
import { initFolders } from '../src/initFolders.mjs';
import { openDb } from '../src/db.mjs';
import { migrate } from '../src/migrate.mjs';
import { seed } from '../src/seed.mjs';
import { refreshKnowledgeVault } from '../src/knowledgeVault.mjs';
import { paths } from '../src/paths.mjs';
import { buildGraphIndex } from '../src/graph/indexer.mjs';

initFolders();
const db=openDb();
migrate(db);
seed(db);
refreshKnowledgeVault(db);
buildGraphIndex();
db.close();

const launcher=path.join(paths.repoRoot,'open-knowledge.bat');
const rootLauncher=path.join(paths.localRoot,'open-knowledge.bat');
if(fs.existsSync(launcher) && path.resolve(launcher)!==path.resolve(rootLauncher)) fs.copyFileSync(launcher,rootLauncher);
console.log('JCC local folders, database, knowledge vault, live graph index and knowledge launcher initialized.');

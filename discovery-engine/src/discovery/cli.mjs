import { openDb } from '../db.mjs';import { migrate } from '../migrate.mjs';import { seed } from '../seed.mjs';import { runDiscovery } from './service.mjs';
const db=openDb();migrate(db);seed(db);const result=await runDiscovery(db,{mode:'MANUAL'});console.log(JSON.stringify(result,null,2));

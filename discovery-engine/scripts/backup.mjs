import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { paths } from '../src/paths.mjs';
import { initFolders } from '../src/initFolders.mjs';

function stamp(){return new Date().toISOString().replace(/[-:]/g,'').replace('T','_').replace('Z','').replace('.','_');}
function uniqueBackupDir(){
  const base=stamp();
  for(let i=0;i<1000;i++){
    const name=i===0?base:`${base}_${String(i).padStart(3,'0')}`;
    const out=path.join(paths.backups,name);
    try{fs.mkdirSync(out,{recursive:false});return out;}catch(e){if(e.code!=='EEXIST')throw e;}
  }
  throw new Error('Could not allocate unique backup directory');
}

initFolders();
const out=uniqueBackupDir();
const db=new DatabaseSync(paths.dbPath);
const dbCopy=path.join(out,'jcc.sqlite');
db.exec('PRAGMA wal_checkpoint(FULL)');
db.exec(`VACUUM INTO '${dbCopy.replaceAll("'","''")}'`);
db.close();
for(const name of ['config']){const src=path.join(paths.repoRoot,name);if(fs.existsSync(src))fs.cpSync(src,path.join(out,name),{recursive:true});}
if(fs.existsSync(paths.knowledgeRoot))fs.cpSync(paths.knowledgeRoot,path.join(out,'JCC-Knowledge'),{recursive:true});
const manifest={createdAt:new Date().toISOString(),version:fs.existsSync(path.join(paths.repoRoot,'VERSION.txt'))?fs.readFileSync(path.join(paths.repoRoot,'VERSION.txt'),'utf8').trim():'unknown',database:'jcc.sqlite',excludes:['browser cookies','secrets','.env']};
fs.writeFileSync(path.join(out,'backup-manifest.json'),JSON.stringify(manifest,null,2));
console.log(out);

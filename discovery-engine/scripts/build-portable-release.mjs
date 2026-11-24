import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { paths } from '../src/paths.mjs';

const SOURCE_DIRS=['adapters','agents','docs','migrations','public','scripts','skills','src','templates','tests'];
const SOURCE_FILES=['.env.example','.gitattributes','.gitignore','backup-jcc.bat','BUILD_REPORT.md','doctor.bat','install.bat','open-knowledge.bat','package-lock.json','package.json','README.md','restore-jcc.bat','start-jcc.bat','stop-jcc.bat','VERSION.txt'];
const FORBIDDEN_NAMES=new Set(['.git','node_modules','JCC-Data','JCC-Knowledge','Job Applications','Browser','Backups','Temp']);
const TEXT_EXTENSIONS=new Set(['','.bat','.css','.env','.example','.html','.js','.json','.md','.mjs','.sql','.txt','.yml','.yaml']);

function copyChecked(source,destination){
  const stat=fs.lstatSync(source);
  if(stat.isSymbolicLink())throw new Error(`Refusing symbolic link: ${source}`);
  if(stat.isDirectory()){
    fs.mkdirSync(destination,{recursive:true});
    for(const name of fs.readdirSync(source).sort()){
      if(FORBIDDEN_NAMES.has(name))throw new Error(`Forbidden directory in release source: ${source}${path.sep}${name}`);
      copyChecked(path.join(source,name),path.join(destination,name));
    }
    return;
  }
  fs.copyFileSync(source,destination);
}

function filesUnder(root){
  const out=[];
  function walk(dir){
    for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
      const full=path.join(dir,entry.name);
      if(entry.isDirectory())walk(full);
      else if(entry.isFile())out.push(full);
      else throw new Error(`Unsupported release entry: ${full}`);
    }
  }
  walk(root);return out;
}

function wrapper(command){return `@echo off\r\nsetlocal\r\ncd /d "%~dp0jcc-local"\r\ncall ${command}\r\nset "JCC_RC=%ERRORLEVEL%"\r\nif not "%JCC_RC%"=="0" (\r\n  echo.\r\n  echo JCC command failed. Review the error above.\r\n  pause\r\n)\r\nexit /b %JCC_RC%\r\n`;}

function readme(version){return `JCC LOCAL ${version} - PORTABLE WINDOWS PACKAGE\r\n\r\nWHAT THIS PACKAGE CONTAINS\r\nA clean copy of JCC source code and setup files. It contains no sender CV, job database, applications, browser state, credentials, logs or Git history.\r\n\r\nREQUIREMENTS\r\n- Windows 10 or 11\r\n- Node.js 22 LTS or newer (includes npm)\r\n- Internet access for the one-time dependency and Chromium installation\r\n\r\nFIRST INSTALL\r\n1. Extract the entire ZIP to a normal writable local folder. Do not run it inside the ZIP.\r\n2. Double-click INSTALL-JCC.bat. Installation is successful only when Doctor and all tests pass.\r\n3. Double-click START-JCC.bat.\r\n4. Open http://127.0.0.1:8787 if the browser does not open automatically.\r\n5. Import your own Master CV and configure your own roles, locations and sources.\r\n\r\nDAILY USE\r\nUse START-JCC.bat and STOP-JCC.bat. JCC stores private data in new folders beside jcc-local. Never copy another person's JCC-Data into this installation.\r\n\r\nIMPORTANT LIMITS\r\nJCC never submits an application automatically. Job websites can change and may require manual import, login or CAPTCHA. A MANUAL ONLY source warning is expected when automated public retrieval is unavailable.\r\n\r\nTRANSFER CHECK\r\nSHA256SUMS.txt records every packaged file. Any checksum mismatch means the transfer is incomplete or altered.\r\n`;}

function assertSafeDestination(destination){
  const resolved=path.resolve(destination);
  const protectedRoots=[paths.repoRoot,paths.dataRoot,paths.knowledgeRoot];
  for(const root of protectedRoots){
    const relative=path.relative(path.resolve(root),resolved);
    if(relative===''||(!relative.startsWith('..')&&!path.isAbsolute(relative)))throw new Error(`Unsafe release destination: ${resolved}`);
  }
  if(resolved.toLowerCase()===path.resolve(paths.localRoot).toLowerCase())throw new Error(`Unsafe release destination: ${resolved}`);
  if(fs.existsSync(resolved))throw new Error(`Release destination already exists: ${resolved}`);
  return resolved;
}

export function buildPortableRelease(destination){
  const pkg=JSON.parse(fs.readFileSync(path.join(paths.repoRoot,'package.json'),'utf8'));
  const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z').replace('T','-');
  const target=assertSafeDestination(destination||path.join(paths.localRoot,'Releases',`JCC-LOCAL-${pkg.version}-portable-${stamp}`));
  const staging=path.join(path.dirname(target),`.${path.basename(target)}-${process.pid}-${crypto.randomUUID()}.tmp`);
  fs.mkdirSync(staging,{recursive:true});
  try{
    const code=path.join(staging,'jcc-local');fs.mkdirSync(code,{recursive:true});
    for(const name of SOURCE_DIRS)copyChecked(path.join(paths.repoRoot,name),path.join(code,name));
    for(const name of SOURCE_FILES)copyChecked(path.join(paths.repoRoot,name),path.join(code,name));
    fs.writeFileSync(path.join(staging,'README-FIRST.txt'),readme(pkg.version),'utf8');
    fs.writeFileSync(path.join(staging,'INSTALL-JCC.bat'),wrapper('install.bat'),'utf8');
    fs.writeFileSync(path.join(staging,'START-JCC.bat'),wrapper('start-jcc.bat'),'utf8');
    fs.writeFileSync(path.join(staging,'STOP-JCC.bat'),wrapper('stop-jcc.bat'),'utf8');

    for(const file of filesUnder(staging)){
      const rel=path.relative(staging,file);const segments=rel.split(path.sep);
      if(segments.some(x=>FORBIDDEN_NAMES.has(x)))throw new Error(`Forbidden release path: ${rel}`);
      if(TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())){
        const content=fs.readFileSync(file,'utf8');
        if(/C:\\Users\\[^\\\r\n]+/i.test(content))throw new Error(`Private machine path found in ${rel}`);
      }
    }

    const manifest=filesUnder(staging).map(file=>{
      const hash=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      return `${hash} *${path.relative(staging,file).replace(/\\/g,'/')}`;
    }).join(os.EOL)+os.EOL;
    fs.writeFileSync(path.join(staging,'SHA256SUMS.txt'),manifest,'utf8');
    fs.mkdirSync(path.dirname(target),{recursive:true});fs.renameSync(staging,target);
    return {target,version:pkg.version,files:filesUnder(target).length};
  }catch(error){fs.rmSync(staging,{recursive:true,force:true});throw error;}
}

const invoked=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
  const outputIndex=process.argv.indexOf('--output');
  const result=buildPortableRelease(outputIndex>=0?process.argv[outputIndex+1]:undefined);
  console.log(JSON.stringify(result,null,2));
}

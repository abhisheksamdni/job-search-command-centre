import fs from 'node:fs';
import path from 'node:path';
import { paths } from './paths.mjs';
import { initFolders } from './initFolders.mjs';
import { slugify } from './security.mjs';
import { emitJccEvent } from './events.mjs';

const VAULT_DIRS = [
  'Candidate','Skills','Agents','Sources','Applications','Jobs','Jobs/Analysis','Architecture',
  'Decisions','Failures','Runbooks','Releases','CV','Interviews','Followups','Companies','Contacts'
];

const BASE_ADAPTERS = [
  ['Greenhouse','greenhouse','READY'],['Ashby','ashby','READY'],['Lever','lever','READY'],
  ['Workday','workday','READY'],['RSS','rss','READY'],['Sitemap','sitemap','DEGRADED'],
  ['Playwright','playwright','OPTIONAL'],['Agent Reach','agent-reach','OPTIONAL'],['LinkedIn','manual','MANUAL ONLY']
];

const SKILL_DEPENDENCIES = {
  'discovery':['Source Recipes','Role Gate','Location Normalizer'],
  'source-onboarding':['Discovery','Source Recipes'],
  'role-gate':['Target Roles'],
  'location-normalizer':['Target Locations'],
  'jd-cleaner':['Job'],
  'senior-recruiter':['JD Cleaner','Evidence Ledger','Active CV'],
  'ats-exact':['Recruiter Requirements','Active CV'],
  'cv-tailor':['Evidence Ledger','Senior Recruiter','ATS Exact'],
  'post-tailor-verifier':['CV Tailor','Evidence Ledger','Senior Recruiter','ATS Exact'],
  'cover-letter':['Evidence Ledger','Job'],
  'application-questions':['Evidence Ledger','Application'],
  'outreach':['Contact','Job'],
  'follow-up':['Application Tracker'],
  'interview-prep':['Application','Job','CV Version','Evidence Ledger'],
  'application-tracker':['Application Archive','CV Version','Job'],
  'skill-refiner':['Skill Index','Failures and Fixes']
};

const SKILL_FILES = {
  'discovery':['src/discovery/service.mjs','src/discovery/registry.mjs','adapters/'],
  'source-onboarding':['src/services/sourceOnboarding.mjs'],
  'role-gate':['src/services/roleGate.mjs'],
  'location-normalizer':['src/services/locationNormalizer.mjs'],
  'jd-cleaner':['src/services/jdCleaner.mjs','src/services/requirements.mjs'],
  'senior-recruiter':['src/services/recruiter.mjs','src/services/requirements.mjs'],
  'ats-exact':['src/services/atsExact.mjs'],
  'cv-tailor':['src/services/cvTailor.mjs','src/services/jobWorkflow.mjs'],
  'post-tailor-verifier':['src/services/integrity.mjs','src/services/jobWorkflow.mjs'],
  'cover-letter':['skills/cover-letter/'],
  'application-questions':['skills/application-questions/'],
  'outreach':['skills/outreach/'],
  'follow-up':['src/services/applicationTracker.mjs'],
  'interview-prep':['skills/interview-prep/','src/services/applicationTracker.mjs'],
  'application-tracker':['src/services/applicationTracker.mjs','src/services/applicationArchive.mjs'],
  'skill-refiner':['skills/skill-refiner/']
};

function pretty(name='') { return name.split(/[-_]/).filter(Boolean).map(x=>x.charAt(0).toUpperCase()+x.slice(1)).join(' '); }
function idJob(id){return `JOB-${String(id).padStart(6,'0')}`;}
function idCv(id){return `CV-${String(id).padStart(4,'0')}`;}
function safeName(value='Note'){return String(value).replace(/[<>:"/\\|?*]/g,'-').replace(/\s+/g,' ').trim().slice(0,140)||'Note';}
function fileFor(dir,name){return path.join(paths.knowledgeRoot,dir,`${safeName(name)}.md`);}
function wiki(name,alias=null){return `[[${name}${alias?`|${alias}`:''}]]`;}
function localLink(p){return String(p||'').replace(/\\/g,'/');}
function readIf(file){try{return fs.readFileSync(file,'utf8');}catch{return '';}}
function extractVersion(text){return text.match(/\*\*Version:\*\*\s*([^\n]+)/i)?.[1]?.trim()||null;}
function extractSection(text,heading){const re=new RegExp(`##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`,'i');return text.match(re)?.[1]?.trim()||'';}

function yamlValue(v){
  if(v===null||v===undefined)return 'null';
  if(typeof v==='number'||typeof v==='boolean')return String(v);
  return JSON.stringify(String(v));
}
function fm(data={}){
  const lines=['---'];
  for(const [k,v] of Object.entries(data)){
    if(v===undefined||v===null||v==='')continue;
    if(Array.isArray(v)){lines.push(`${k}:`);for(const x of v)lines.push(`  - ${yamlValue(x)}`);}
    else lines.push(`${k}: ${yamlValue(v)}`);
  }
  return `${lines.join('\n')}\n---\n\n`;
}
function write(file,content){fs.mkdirSync(path.dirname(file),{recursive:true});const existing=readIf(file);if(existing===content)return file;const tmp=`${file}.tmp`;fs.writeFileSync(tmp,content,'utf8');fs.renameSync(tmp,file);emitJccEvent('knowledge:changed',{file:path.relative(paths.knowledgeRoot,file).replace(/\\/g,'/')});return file;}
function note(file,frontmatter,title,body){return write(file,`${fm(frontmatter)}# ${title}\n\n${body.trim()}\n`);}
function latestAnalysis(db,jobId,type){const r=db?.prepare('SELECT * FROM job_analysis WHERE job_id=? AND analysis_type=? ORDER BY id DESC LIMIT 1').get(jobId,type);if(!r)return null;try{return {...r,payload:JSON.parse(r.payload_json||'{}')};}catch{return {...r,payload:{}};}}

function ensureStructure(){initFolders();for(const d of VAULT_DIRS)fs.mkdirSync(path.join(paths.knowledgeRoot,d),{recursive:true});}

function coreNotes(){
  const today=new Date().toISOString().slice(0,10);
  const notes={
    '00_HOME.md': `${fm({type:'home',tags:['architecture','runbook'],updated:today})}# JCC Knowledge\n\n${wiki('JCC LOCAL')} is the hub. Start with ${wiki('CURRENT_STATE')}, ${wiki('SYSTEM_MAP')}, ${wiki('DATA_MODEL')}, ${wiki('SKILL_INDEX')}, ${wiki('AGENT_INDEX')}, ${wiki('SOURCE_INDEX')}, ${wiki('DECISIONS')}, ${wiki('FAILURES_AND_FIXES')} and ${wiki('RELEASES')}.\n\n## Main clusters\n- ${wiki('Discovery')} → ${wiki('Source Recipes')} → ${wiki('Job')}\n- ${wiki('JD Cleaner')} → ${wiki('Senior Recruiter')} → ${wiki('ATS Exact')}\n- ${wiki('Evidence Ledger')} → ${wiki('CV Tailor')} → ${wiki('Post Tailor Verifier')}\n- ${wiki('Application Tracker')} → ${wiki('Application Archive')} → ${wiki('Interview Prep')}\n\nUse ${wiki('Live Knowledge Graph')} in JCC for the built-in 3D view; ${wiki('3D GRAPH GUIDE')} also documents the optional Obsidian-native view.\n`,
    'JCC LOCAL.md': `${fm({type:'architecture',tags:['architecture'],updated:today})}# JCC LOCAL\n\nLocal-first Job Command Centre.\n\n## System\n${wiki('Discovery')} · ${wiki('Senior Recruiter')} · ${wiki('ATS Exact')} · ${wiki('CV Tailor')} · ${wiki('Application Tracker')} · ${wiki('Interview Prep')}\n\n## Operating model\n${wiki('CURRENT_STATE')} · ${wiki('SYSTEM_MAP')} · ${wiki('DECISIONS')} · ${wiki('RELEASES')}\n`,
    'CURRENT_STATE.md': `${fm({type:'architecture',tags:['architecture','release'],updated:today})}# Current State\n\nVersion: 2.0.0-alpha.4\n\nJCC is in release hardening. It is local-first with SQLite persistence, deterministic Recruiter/ATS analysis, zero-paid-runtime discovery fallbacks, immutable application archives, real DOCX/PDF/Markdown tailored child outputs and a localhost dashboard. Manual Mode is the default. The built-in live 3D graph is a non-blocking read-model derived from the Obsidian-compatible Markdown vault; optional Obsidian 3D plugins show the same knowledge.\n\n## Validation state\n- Expanded alpha.4 release-hardening regression suite is validated before candidate freeze; exact counts are recorded in BUILD_REPORT.md.\n- Graph/SSE regression coverage remains part of the full suite.\n- Workday detection covers current public myworkdayjobs.com and locale-prefixed myworkdaysite.com/recruiting/... URL families with fixture validation.\n- Agent Reach is wired after Playwright in both listing and full-JD fallback chains, but target-machine availability is optional and checked by Doctor.\n- Windows target-machine validation is still required before v2.0.0-local can be frozen.\n\n## Paths\n- Code: <JCC home>\\jcc-local\n- Private data: <JCC home>\\JCC-Data\n- Knowledge: <JCC home>\\JCC-Knowledge\n\n## Priorities\n1. ${wiki('Discovery')} source health.\n2. ${wiki('Senior Recruiter')} remains primary; ${wiki('ATS Exact')} secondary.\n3. ${wiki('Application Tracker')} never marks APPLIED without explicit user action.\n4. ${wiki('Application Archive')} preserves exact submitted CV and JD.\n5. ${wiki('Live Knowledge Graph')} and ${wiki('3D GRAPH GUIDE')} remain non-blocking.\n6. Windows target-machine validation remains the only release boundary.\n`,
    'SYSTEM_MAP.md': `${fm({type:'architecture',tags:['architecture'],updated:today})}# System Map\n\n- ${wiki('Database')} → migrations/001_initial.sql + migrations/002_cv_version_files.sql + migrations/003_alpha4_global_discovery.sql\n- ${wiki('Role Gate')} → src/services/roleGate.mjs\n- ${wiki('Location Normalizer')} → src/services/locationNormalizer.mjs + src/services/targetLocations.mjs; normalized_key provides durable target identity\n- ${wiki('JD Cleaner')} → src/services/jdCleaner.mjs\n- ${wiki('Senior Recruiter')} → src/services/recruiter.mjs\n- ${wiki('ATS Exact')} → src/services/atsExact.mjs\n- ${wiki('CV Tailor')} → src/services/cvTailor.mjs + src/services/cvRenderer.mjs\n- ${wiki('Post Tailor Verifier')} → src/services/integrity.mjs + src/services/jobWorkflow.mjs\n- ${wiki('Application Tracker')} → src/services/applicationTracker.mjs\n- ${wiki('Application Archive')} → src/services/applicationArchive.mjs\n- ${wiki('Discovery')} → src/discovery/service.mjs + src/discovery/queryPlanner.mjs → SYSTEM/AUTO_DISCOVERED/USER_ADDED sources → direct ATS/API/feed → generic HTTP/RSS/sitemap → Playwright → Agent Reach → MANUAL ONLY\n- ${wiki('Public ATS')} → Greenhouse/Ashby/Lever/Workday plus SmartRecruiters/Recruitee/Personio/Breezy direct readers; other detected ATS families degrade through the normal fallback chain\n- ${wiki('Knowledge Map')} → src/knowledgeVault.mjs\n- ${wiki('Live Knowledge Graph')} → src/graph/indexer.mjs + src/graph/service.mjs + public/knowledge-graph.*\n- ${wiki('Doctor')} → src/doctor.mjs; includes required SQLite integrity check and optional graph/Agent Reach checks\n- ${wiki('Dashboard')} → public/ + src/server.mjs\n`,
    'DATA_MODEL.md': `${fm({type:'architecture',tags:['architecture'],updated:today})}# Data Model\n\nCore SQLite entities remain canonical. Alpha.4 adds normalized target-location identity, source ownership/health/provenance, source attempts, source sightings and separate employer/source publication metadata. The graph is derived from useful entities only.\n\n${wiki('Application')} → ${wiki('CV Version')}\n${wiki('Application')} → ${wiki('Job')}\n${wiki('Job')} → ${wiki('Source Recipes')}\n${wiki('Interview')} → ${wiki('Application')}\n${wiki('Skill Index')} → ${wiki('Skills')}\n`,
    'SKILL_INDEX.md': `${fm({type:'index',tags:['skill'],updated:today})}# Skill Index\n\nGenerated skill notes live in **Skills/** and are linked to dependencies/dependents.\n`,
    'AGENT_INDEX.md': `${fm({type:'index',tags:['agent'],updated:today})}# Agent Index\n\nAgent contracts live in **Agents/**. Skills remain the source of truth.\n`,
    'SOURCE_INDEX.md': `${fm({type:'index',tags:['source','adapter'],updated:today})}# Source Index\n\nFresh installs seed SYSTEM discovery radars. Ownership is SYSTEM / AUTO_DISCOVERED / USER_ADDED. Health is HEALTHY / DEGRADED / RATE_LIMITED / MANUAL_ONLY / DISABLED / UNTESTED. Priority: direct ATS/API → HTTP/RSS/sitemap → ${wiki('Playwright')} → ${wiki('Agent Reach')} → manual import.\n`,
    'DECISIONS.md': `${fm({type:'decision-log',tags:['decision','architecture'],updated:today})}# Decisions\n\n1. Local-first runtime; private data never committed.\n2. Manual application submission only.\n3. Recruiter Match dominates; ATS is secondary.\n4. Submitted CV snapshots are immutable and SHA-256 hashed.\n5. Obsidian-compatible Markdown is the knowledge source of truth.\n6. The built-in ${wiki('Live Knowledge Graph')} is a derived read-model from Markdown; no proprietary graph database.\n7. Graph failures are non-blocking to JCC core.\n8. Prefer ${wiki('New 3D Graph')} with ${wiki('Three D Graph View')} as optional Obsidian-native views.
9. Alpha.4 keeps first-seen/last-seen separate from employer/source publication dates and never presents first-seen as employer-confirmed.
10. SYSTEM and USER_ADDED source ownership cannot be silently downgraded by auto-discovery.\n`,
    'FAILURES_AND_FIXES.md': `${fm({type:'failure-log',tags:['failure','fix'],updated:today})}# Failures and Fixes\n\n- Graph index startup/write failures are contained so JCC core remains healthy; regression coverage lives in the knowledge-graph tests.\n- Backup folder collisions within the same timestamp are prevented with unique suffix allocation; backup/restore regression coverage verifies the safety backup path.\n- JCC stop now refuses to signal an unverified/reused PID.
- Alpha.4 migration merges legacy NULL/empty target-location duplicates and repeated init remains idempotent.
- Legacy READY/UNKNOWN source-health values normalize to UNTESTED/DISABLED production states; per-source failure is isolated.
- Greenhouse updated_at is not treated as an employer publication date.\n\nRecord future regressions with links to the owning ${wiki('Skill Index')} note and fixture. Do not create graph nodes for trivial logs.\n`,
    'RELEASES.md': `${fm({type:'release-log',tags:['release'],updated:today})}# Releases

## 2.0.0-alpha.4 — final dashboard and global discovery hardening
Donor-inspired daily dashboard and Settings separation; normalized global target locations with duplicate migration; auto-managed SYSTEM source registry and canonical AUTO_DISCOVERED onboarding; source health/failure isolation; expanded public ATS readers/detection; honest employer/source publication metadata; grounded cover-letter/application-answer/outreach/interview preparation; existing real DOCX/PDF/Markdown child CVs, immutable submitted-file SHA-256 archive, live Knowledge Graph/SSE and backup/restore preserved.

Validation: the exact candidate must pass the expanded regression suite, privacy/tree audit and remote branch verification. Full Windows migration plus controlled real discovery remain required before a local release is declared.

## 2.0.0-alpha.3
Built-in Knowledge Graph, real DOCX/PDF child CVs, immutable submitted-file archive and Windows lifecycle hardening.

## 2.0.0-alpha.1
Local-first foundation. See ${wiki('CURRENT_STATE')}.
`
  };
  notes['CURRENT_STATE.md']=notes['CURRENT_STATE.md'].replace(
    /## Paths\n[\s\S]*?\n\n## Priorities/,
    `## Paths\n- Code: ${paths.repoRoot}\n- Private data: ${paths.dataRoot}\n- Knowledge: ${paths.knowledgeRoot}\n\n## Priorities`
  );
  return notes;
}

function writeGraphGuide(){
  const groups=[
    ['Candidate / CV','path:"Candidate" OR path:"CV"','#5B8FF9'],['Skills','path:"Skills" OR tag:#skill','#61DDAA'],
    ['Agents','path:"Agents" OR tag:#agent','#65789B'],['Jobs','path:"Jobs" OR tag:#job','#F6BD16'],
    ['Applications','path:"Applications" OR tag:#application','#7262FD'],['Sources / Adapters','path:"Sources" OR tag:#source OR tag:#adapter','#78D3F8'],
    ['Architecture','path:"Architecture" OR tag:#architecture','#9661BC'],['Decisions','path:"Decisions" OR tag:#decision','#F6903D'],
    ['Failures / Fixes','path:"Failures" OR tag:#failure OR tag:#fix','#E8684A'],['Interviews / Follow-ups','path:"Interviews" OR path:"Followups" OR tag:#interview OR tag:#followup','#6DC8EC'],
    ['Releases','path:"Releases" OR tag:#release','#9270CA']
  ];
  const body=`${fm({type:'runbook',tags:['runbook','architecture']})}# 3D Graph Guide\n\nThe Markdown vault is canonical. JCC also renders the same vault as a live browser-native 3D graph at **/knowledge-graph**. Obsidian 3D plugins remain optional and must never affect JCC runtime health.\n\n## Preferred plugin\n1. Install **New 3D Graph** from Obsidian Community Plugins.\n2. Enable it.\n3. Command Palette → **Open 3D Graph**.\n4. If unavailable, use **Three D Graph View**.\n\n## Suggested color groups\n${groups.map(([n,q,c])=>`- **${n}** — \`${q}\` — \`${c}\``).join('\n')}\n\n## Suggested display\n- Show tags: ON\n- Show attachments: OFF\n- Show orphan nodes: OFF\n- Labels: fade by distance\n- Node sizing: modest increase for highly connected notes\n- Use folder/tag rules before content rules\n\n## Graph hygiene\n- Do not graph raw logs or every database row.\n- One stable note per useful job/application/CV/interview/source/skill entity.\n- Update frontmatter/status in place.\n- Keep full JDs and CV contents in canonical local files, not duplicated into graph notes.\n`;
  write(path.join(paths.knowledgeRoot,'Runbooks','3D GRAPH GUIDE.md'),body);
  const templateDir=path.join(paths.repoRoot,'templates','knowledge-vault');fs.mkdirSync(templateDir,{recursive:true});
  fs.writeFileSync(path.join(templateDir,'GRAPH_GROUPS.json'),JSON.stringify({plugin:'New 3D Graph',fallback:'Three D Graph View',groups:groups.map(([name,query,color])=>({name,query,color})),filters:{attachments:false,orphans:false,tags:true}},null,2)+'\n','utf8');
  fs.writeFileSync(path.join(templateDir,'README.md'),'# JCC Knowledge Vault Template\n\nSanitized visualization defaults only. The populated `JCC-Knowledge` vault is private/local and must not be committed.\n','utf8');
}

function reverseDependents(skill){const target=pretty(skill);return Object.entries(SKILL_DEPENDENCIES).filter(([,deps])=>deps.includes(target)).map(([name])=>pretty(name));}
function syncSkills(db){
  const skillsDir=path.join(paths.repoRoot,'skills');if(!fs.existsSync(skillsDir))return;
  const names=fs.readdirSync(skillsDir).filter(n=>fs.statSync(path.join(skillsDir,n)).isDirectory()).sort();
  const index=[];
  for(const name of names){
    const src=readIf(path.join(skillsDir,name,'SKILL.md'));const display=pretty(name);const dbVersion=db?.prepare('SELECT version FROM skill_versions WHERE skill=? AND status=? ORDER BY updated_at DESC LIMIT 1').get(name,'ACTIVE')?.version;
    const version=extractVersion(src)||dbVersion||'1.0.0';const purpose=extractSection(src,'Purpose')||'See skill contract.';const limitations=extractSection(src,'Failure modes')||'See skill contract.';
    const deps=SKILL_DEPENDENCIES[name]||[];const usedBy=reverseDependents(name);
    const body=`**Version:** ${version}\n\n## Purpose\n${purpose}\n\n## Implementation files\n${(SKILL_FILES[name]||[`skills/${name}/`]).map(x=>`- \`${x}\``).join('\n')}\n\n## Tests\n- \`skills/${name}/tests/\`\n- ${wiki(`${display} Fixtures`)}\n\n## Dependencies\n${deps.length?deps.map(x=>`- ${wiki(x)}`).join('\n'):'- None declared'}\n\n## Used by\n${usedBy.length?usedBy.map(x=>`- ${wiki(x)}`).join('\n'):'- No direct skill dependents declared'}\n\n## Last refinement\nSee \`skills/${name}/CHANGELOG.md\`.\n\n## Known limitations / failure modes\n${limitations}\n\nSource of truth: \`skills/${name}/SKILL.md\`.\n`;
    note(fileFor('Skills',display),{type:'skill',skill:name,version,tags:['skill'],updated:new Date().toISOString().slice(0,10)},display,body);
    note(fileFor('Skills',`${display} Fixtures`),{type:'test-fixtures',skill:name,tags:['skill']},`${display} Fixtures`,`Regression fixtures for ${wiki(display)} live under \`skills/${name}/fixtures/\`.\n`);
    index.push(`- ${wiki(display)} — v${version}`);
  }
  const file=path.join(paths.knowledgeRoot,'SKILL_INDEX.md');const base=readIf(file).replace(/\n?## Skills[\s\S]*$/,'').trimEnd();write(file,`${base}\n\n## Skills\n${index.join('\n')}\n`);
}

function syncAgents(){
  const dir=path.join(paths.repoRoot,'agents');if(!fs.existsSync(dir))return;const rows=[];
  for(const f of fs.readdirSync(dir).filter(x=>x.endsWith('.md')).sort()){
    const src=readIf(path.join(dir,f));const name=pretty(path.basename(f,'.md'));const links=[...src.matchAll(/\[\[([^\]]+)\]\]/g)].map(m=>pretty(m[1]));
    note(fileFor('Agents',name),{type:'agent',tags:['agent']},name,`${src.replace(/^# .*\n?/,'').trim()}\n\n## Related skills\n${links.length?[...new Set(links)].map(x=>`- ${wiki(x)}`).join('\n'):'- See agent contract.'}\n\nImplementation: \`agents/${f}\`.\n`);rows.push(`- ${wiki(name)}`);
  }
  const file=path.join(paths.knowledgeRoot,'AGENT_INDEX.md');const base=readIf(file).replace(/\n?## Agents[\s\S]*$/,'').trimEnd();write(file,`${base}\n\n## Agents\n${rows.join('\n')}\n`);
}

function syncBaseSources(){
  for(const [display,adapter,status] of BASE_ADAPTERS){
    const deps=display==='Agent Reach'?`${wiki('Discovery')} fallback`:`${wiki('Discovery')} adapter`;
    note(fileFor('Sources',display),{type:'adapter',adapter,status,tags:['source','adapter']},display,`Status: **${status}**\n\n- Relationship: ${deps}\n- Recipes: ${wiki('Source Recipes')}\n- Jobs: linked dynamically when configured and discovered.\n`);
  }
  note(fileFor('Sources','Source Recipes'),{type:'architecture',tags:['source','adapter']},'Source Recipes',`Persisted source-specific retrieval recipes used by ${wiki('Discovery')}.\n`);
}

export function syncSourceKnowledge(db,sourceId=null){
  ensureStructure();syncBaseSources();if(!db)return;
  const rows=sourceId?db.prepare(`SELECT s.*,r.adapter,r.status recipe_status,r.domain FROM sources s LEFT JOIN source_recipes r ON r.source_id=s.id WHERE s.id=?`).all(sourceId):db.prepare(`SELECT s.*,r.adapter,r.status recipe_status,r.domain FROM sources s LEFT JOIN source_recipes r ON r.source_id=s.id ORDER BY s.name`).all();
  for(const s of rows){const meta=(()=>{try{return JSON.parse(s.metadata_json||'{}')}catch{return {}}})();const display=s.name;const jobs=db.prepare('SELECT id FROM jobs WHERE source_id=? ORDER BY id DESC LIMIT 50').all(s.id);const adapter=pretty(s.adapter||meta.adapter||s.kind||'Source');
    note(fileFor('Sources',display),{type:'source',source_id:s.id,adapter:s.adapter||meta.adapter||s.kind,status:s.health,recipe_status:s.recipe_status,domain:s.domain,tags:['source','adapter']},display,`## Relationship\n- Adapter: ${wiki(adapter)}\n- Pipeline: ${wiki('Discovery')}\n- Recipes: ${wiki('Source Recipes')}\n\n## Jobs found\n${jobs.length?jobs.map(j=>`- ${wiki(`Job ${idJob(j.id)}`)}`).join('\n'):'- None recorded yet'}\n\nBase URL: ${s.base_url||''}\n`);
  }
  const list=db.prepare('SELECT name FROM sources ORDER BY name').all();const f=path.join(paths.knowledgeRoot,'SOURCE_INDEX.md');const base=readIf(f).replace(/\n?## Configured sources[\s\S]*$/,'').trimEnd();write(f,`${base}\n\n## Configured sources\n${list.length?list.map(x=>`- ${wiki(x.name)}`).join('\n'):'- None configured yet'}\n`);
}

function ensureCompanyNote(db,company){const jobs=db.prepare('SELECT id,title,status FROM jobs WHERE company=? ORDER BY id DESC').all(company);return note(fileFor('Companies',`Company ${company}`),{type:'company',company,tags:['job']},`Company ${company}`,`## Jobs\n${jobs.map(j=>`- ${wiki(`Job ${idJob(j.id)}`)} — ${j.title} — ${j.status}`).join('\n')||'- None'}\n`);}
function ensureCvNote(db,cvVersionId){if(!cvVersionId)return null;const cv=db.prepare(`SELECT v.*,d.original_filename,d.stored_path,d.sha256 FROM cv_versions v JOIN cv_documents d ON d.id=v.document_id WHERE v.id=?`).get(cvVersionId);if(!cv)return null;const name=`CV Version ${idCv(cv.id)}`;const parent=cv.parent_version_id?wiki(`CV Version ${idCv(cv.parent_version_id)}`):'None';const job=cv.job_id?wiki(`Job ${idJob(cv.job_id)}`):'None';const files=db.prepare('SELECT format,path,sha256,is_primary FROM cv_version_files WHERE cv_version_id=? ORDER BY is_primary DESC,id').all(cv.id);note(fileFor('CV',name),{type:'cv_version',cv_version:idCv(cv.id),master:!!cv.is_master,active:!!cv.is_active,job_id:cv.job_id? idJob(cv.job_id):undefined,created:cv.created_at,tags:['cv','candidate']},name,`- Original file: ${cv.original_filename}\n- SHA-256: \`${cv.sha256}\`\n- Canonical local file: \`${localLink(cv.stored_path)}\`\n- Parent: ${parent}\n- Job: ${job}\n- Evidence: ${wiki('Evidence Ledger')}\n\n## Physical files\n${files.length?files.map(f=>`- ${f.format}${f.is_primary?' (primary)':''}: \`${localLink(f.path)}\` — \`${f.sha256}\``).join('\n'):'- Source document only'}\n`);return name;}

function syncAnalysisNotes(db,job){
  const jid=idJob(job.id);const recruiter=latestAnalysis(db,job.id,'RECRUITER');const ats=latestAnalysis(db,job.id,'ATS_EXACT');
  if(recruiter){const cv=ensureCvNote(db,recruiter.cv_version_id),r=recruiter.payload||{},rir=r.recruiterIntelligenceRecord||{};note(fileFor('Jobs/Analysis',`Senior Recruiter Analysis ${jid}`),{type:'analysis',analysis:'senior-recruiter',job_id:jid,score:recruiter.score,verdict:recruiter.verdict,methodology:rir.version||undefined,tags:['job','skill']},`Senior Recruiter Analysis ${jid}`,`- Job: ${wiki(`Job ${jid}`)}\n- Engine: ${wiki('Senior Recruiter')}\n- Methodology: **${rir.version||'legacy / not recorded'}**\n- Clean input: ${wiki('JD Cleaner')}\n- CV: ${cv?wiki(cv):'Not recorded'}\n- Recruiter qualification: **${r.recruiterQualificationScore??recruiter.score??'—'}**\n- Evidence match: **${r.evidenceMatchScore??'—'}**\n- ATS discoverability: **${r.atsDiscoverabilityScore??'—'}**\n- Interview defensibility: **${r.interviewDefensibilityScore??'—'}**\n- Interview risk: **${r.interviewRiskScore??'—'}**\n- Verdict: **${recruiter.verdict||'—'}**\n- Application priority: **${r.applicationPriority||'—'}**\n- Controlled actions: ${(r.improvementInstructions||[]).length}\n\n${rir.scoreDisclaimer||'JCC recruiter estimates are not commercial ATS scores.'}\n`);}
  if(ats){const cv=ensureCvNote(db,ats.cv_version_id);note(fileFor('Jobs/Analysis',`ATS Analysis ${jid}`),{type:'analysis',analysis:'ats-exact',job_id:jid,score:ats.score,tags:['job','skill']},`ATS Analysis ${jid}`,`- Job: ${wiki(`Job ${jid}`)}\n- Engine: ${wiki('ATS Exact')}\n- Requirements: ${wiki('Recruiter Requirements')}\n- CV: ${cv?wiki(cv):'Not recorded'}\n- Score: **${ats.score??'—'}**\n`);}
  return {recruiter,ats};
}

export function syncJobKnowledge(db,jobId){
  ensureStructure();const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);if(!job)return null;const jid=idJob(job.id);const {recruiter,ats}=syncAnalysisNotes(db,job);ensureCompanyNote(db,job.company);
  const app=db.prepare('SELECT * FROM applications WHERE job_id=?').get(job.id);const source=job.source_id?db.prepare('SELECT name FROM sources WHERE id=?').get(job.source_id)?.name:null;const cvId=app?.submitted_cv_version_id||db.prepare('SELECT id FROM cv_versions WHERE job_id=? ORDER BY id DESC LIMIT 1').get(job.id)?.id;const cvName=ensureCvNote(db,cvId);
  const body=`## Relationships\n- System: ${wiki('JCC LOCAL')}\n- Company: ${wiki(`Company ${job.company}`)}\n- Discovery: ${wiki('Discovery')}\n- Source: ${source?wiki(source):'Not linked to a configured source'}\n- Recruiter: ${recruiter?wiki(`Senior Recruiter Analysis ${jid}`):wiki('Senior Recruiter')}\n- ATS: ${ats?wiki(`ATS Analysis ${jid}`):wiki('ATS Exact')}\n- Application: ${app?wiki(`Application ${jid}`):'Not created'}\n- CV: ${cvName?wiki(cvName):'No job-specific CV yet'}\n\n## Canonical records\n- Source URL: ${job.source_url||''}\n- Application URL: ${job.application_url||job.canonical_job_url||''}\n- Full JD remains in SQLite/application archive; it is not duplicated here.\n`;
  const file=path.join(paths.knowledgeRoot,'Jobs',`${applicationFolderBase(job)}.md`);note(file,{type:'job',job_id:jid,company:job.company,title:job.title,status:job.status,recruiter_match:recruiter?.score,ats_exact:ats?.score,cv_version:cvId?idCv(cvId):undefined,source:source||undefined,created:job.first_seen_at,tags:['job',job.role_family?slugify(job.role_family):'job']},`Job ${jid}`,body);return file;
}

function applicationFolderBase(job){return `${idJob(job.id)}__${slugify(job.company)}__${slugify(job.title)}`;}
function syncContactNotes(db,job){const contacts=db.prepare(`SELECT c.* FROM contacts c JOIN job_contacts jc ON jc.contact_id=c.id WHERE jc.job_id=? ORDER BY c.id`).all(job.id);const links=[];for(const c of contacts){const n=`Contact ${c.id} ${c.name}`;note(fileFor('Contacts',n),{type:'contact',contact_id:c.id,company:c.company||job.company,tags:['application']},n,`- Company: ${wiki(`Company ${c.company||job.company}`)}\n- Role: ${c.role||''}\n- Related job: ${wiki(`Job ${idJob(job.id)}`)}\n`);links.push(n);}return links;}

function syncFollowupNote(db,app,job){const rows=db.prepare('SELECT * FROM followups WHERE application_id=? ORDER BY due_at').all(app.id);if(!rows.length)return null;const name=`Follow-up ${idJob(job.id)}`;note(fileFor('Followups',name),{type:'followup',job_id:idJob(job.id),application_id:app.id,status:rows.some(x=>x.status==='DUE')?'DUE':'COMPLETE',tags:['followup','application']},name,`- Application: ${wiki(`Application ${idJob(job.id)}`)}\n- Job: ${wiki(`Job ${idJob(job.id)}`)}\n\n## Schedule\n${rows.map(x=>`- ${x.due_at} — ${x.kind} — ${x.status}${x.notes?` — ${x.notes}`:''}`).join('\n')}\n`);return name;}

export function syncInterviewKnowledge(db,applicationId){
  const app=db.prepare('SELECT * FROM applications WHERE id=?').get(applicationId);if(!app)return null;const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(app.job_id);if(!job)return null;const rows=db.prepare('SELECT * FROM interviews WHERE application_id=? ORDER BY scheduled_at,id').all(applicationId);if(!rows.length)return null;const jid=idJob(job.id);const cvName=ensureCvNote(db,app.submitted_cv_version_id);const name=`Interview ${jid}`;note(fileFor('Interviews',name),{type:'interview',job_id:jid,application_id:app.id,status:rows.at(-1)?.status||'SCHEDULED',stage:rows.at(-1)?.stage||undefined,tags:['interview','application']},name,`- Application: ${wiki(`Application ${jid}`)}\n- Job: ${wiki(`Job ${jid}`)}\n- CV used: ${cvName?wiki(cvName):'Pending'}\n- Prep skill: ${wiki('Interview Prep')}\n\n## Interviews\n${rows.map(x=>`- ${x.scheduled_at||'TBD'} — ${x.stage||'Stage TBD'} — ${x.mode||'Mode TBD'} — ${x.status}`).join('\n')}\n`);return name;}

export function syncApplicationKnowledge(db,applicationId){
  ensureStructure();const app=db.prepare('SELECT * FROM applications WHERE id=?').get(applicationId);if(!app)return null;const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(app.job_id);if(!job)return null;const jid=idJob(job.id);syncJobKnowledge(db,job.id);const {recruiter,ats}=syncAnalysisNotes(db,job);const cvId=app.submitted_cv_version_id||db.prepare('SELECT id FROM cv_versions WHERE job_id=? ORDER BY id DESC LIMIT 1').get(job.id)?.id;const cvName=ensureCvNote(db,cvId);const submitted=db.prepare("SELECT * FROM application_documents WHERE application_id=? AND kind='SUBMITTED_CV' ORDER BY id DESC LIMIT 1").get(app.id);let submittedName=null;
  if(submitted){submittedName=`Submitted CV ${jid}`;note(fileFor('CV',submittedName),{type:'submitted_cv',job_id:jid,application_id:app.id,cv_version:submitted.cv_version_id?idCv(submitted.cv_version_id):undefined,sha256:submitted.sha256,tags:['cv','application']},submittedName,`- Application: ${wiki(`Application ${jid}`)}\n- Job: ${wiki(`Job ${jid}`)}\n- CV Version: ${cvName?wiki(cvName):'Unknown'}\n- Immutable local file: \`${localLink(submitted.path)}\`\n- SHA-256: \`${submitted.sha256||''}\`\n`);}
  const follow=syncFollowupNote(db,app,job);const interview=syncInterviewKnowledge(db,app.id);const contacts=syncContactNotes(db,job);ensureCompanyNote(db,job.company);
  const body=`## Relationships\n- Job: ${wiki(`Job ${jid}`)}\n- Company: ${wiki(`Company ${job.company}`)}\n- CV Version: ${cvName?wiki(cvName):'Pending'}\n- Submitted CV: ${submittedName?wiki(submittedName):'Pending'}\n- Recruiter analysis: ${recruiter?wiki(`Senior Recruiter Analysis ${jid}`):wiki('Senior Recruiter')}\n- ATS analysis: ${ats?wiki(`ATS Analysis ${jid}`):wiki('ATS Exact')}\n- Follow-up: ${follow?wiki(follow):'Not created'}\n- Interview: ${interview?wiki(interview):'Not created'}\n${contacts.length?`- Contacts: ${contacts.map(x=>wiki(x)).join(', ')}\n`:''}\n## Canonical local records\n- Application folder: \`${localLink(app.application_folder)}\`\n- Applied on: ${app.applied_at||'Not applied'}\n- Exact CV/JD/application artifacts stay in the application folder; this note only maps relationships.\n`;
  const file=path.join(paths.knowledgeRoot,'Applications',`${applicationFolderBase(job)}.md`);note(file,{type:'application',job_id:jid,application_id:app.id,company:job.company,status:app.status,recruiter_match:recruiter?.score,ats_exact:ats?.score,cv_version:cvId?idCv(cvId):undefined,created:app.created_at,applied:app.applied_at||undefined,tags:['application','job']},`Application ${jid}`,body);return file;
}

export function syncCvKnowledge(db,cvVersionId){ensureStructure();return ensureCvNote(db,cvVersionId);}


function syncConceptNotes(db){
  const concepts={
    'Database':['SQLite persistence defined by migrations.','architecture'],
    'Evidence Ledger':['Traceable CV evidence used to prevent unsupported claims.','architecture'],
    'Recruiter Requirements':['Recruiter-approved requirement set used by ATS Exact.','architecture'],
    'Application Archive':['Immutable application folder containing submitted CV, JD snapshot and related artifacts.','architecture'],
    'Knowledge Map':['Obsidian-compatible Markdown graph generated from real JCC relationships.','architecture'],
    'Live Knowledge Graph':['Browser-native 3D read-model derived from the canonical Markdown vault and streamed to open dashboards.','architecture'],
    'Dashboard':['Local UI served from 127.0.0.1:8787.','architecture'],
    'Job':['Operational job entity. Useful jobs receive stable graph notes.','architecture'],
    'Application':['Operational application entity linked to job and exact CV.','architecture'],
    'CV Version':['Immutable or derived CV version entity.','architecture'],
    'Interview':['Interview entity linked back to application, job and submitted CV.','architecture'],
    'Contact':['Recruiter/hiring-manager contact linked to relevant jobs.','architecture'],
    'Target Roles':['User-configurable role phrases used by Role Gate.','architecture'],
    'Target Locations':['User-configurable location targets used by Location Normalizer.','architecture'],
    'New 3D Graph':['Preferred optional Obsidian visualization plugin. It is not a JCC runtime dependency.','runbook'],
    'Three D Graph View':['Fallback optional Obsidian 3D visualization plugin. It is not a JCC runtime dependency.','runbook']
  };
  for(const [name,[desc,type]] of Object.entries(concepts)) note(fileFor(type==='runbook'?'Runbooks':'Architecture',name),{type,tags:[type==='runbook'?'runbook':'architecture']},name,`${desc}\n\nSee ${wiki('JCC LOCAL')} and ${wiki('SYSTEM_MAP')}.\n`);
  const active=db?.prepare(`SELECT v.id,v.version_label,d.original_filename FROM cv_versions v JOIN cv_documents d ON d.id=v.document_id WHERE v.is_active=1 ORDER BY v.id DESC LIMIT 1`).get();
  note(fileFor('Candidate','Active CV'),{type:'candidate',tags:['candidate','cv']},'Active CV',active?`Current: ${wiki(`CV Version ${idCv(active.id)}`)}\n\nFile: ${active.original_filename}\n`:'No Active CV registered yet.\n');
}

function syncAllDbEntities(db){
  if(!db)return;syncSourceKnowledge(db);for(const r of db.prepare('SELECT id FROM jobs ORDER BY id').all())syncJobKnowledge(db,r.id);for(const r of db.prepare('SELECT id FROM applications ORDER BY id').all())syncApplicationKnowledge(db,r.id);
}

export function refreshKnowledgeVault(db=null){
  ensureStructure();for(const [file,content] of Object.entries(coreNotes()))write(path.join(paths.knowledgeRoot,file),content);writeGraphGuide();syncConceptNotes(db);syncSkills(db);syncAgents();syncBaseSources();syncAllDbEntities(db);return paths.knowledgeRoot;
}

if(import.meta.url===`file://${process.argv[1]}`){
  const { openDb }=await import('./db.mjs');const { migrate }=await import('./migrate.mjs');const db=openDb();migrate(db);console.log(`Knowledge vault refreshed: ${refreshKnowledgeVault(db)}`);
}

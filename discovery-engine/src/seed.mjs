import { pathToFileURL } from 'node:url';
import { openDb } from './db.mjs';
import { migrate } from './migrate.mjs';
import { upsertTargetLocation } from './services/targetLocations.mjs';
import { seedSystemSources } from './services/systemSources.mjs';

const ROLES={
  TRADING:['Trader','Trading Analyst','Derivatives Trader','Derivatives Trading Analyst','Execution Trader','Execution Analyst','Securities Lending Trader','Fixed Income Trading Analyst','Equity Trader','Systematic Trading Analyst'],
  INVESTMENT_RESEARCH:['Investment Analyst','Equity Analyst','Equity Research Analyst','Equity Research Associate','Portfolio Analyst','Market Analyst','Investment Research Analyst']
};
const LOCATIONS=['London, United Kingdom','Amsterdam, Netherlands','Poland','Switzerland','Norway','Dubai, United Arab Emirates','Abu Dhabi, United Arab Emirates','Boston, United States'];
const SKILLS=['discovery','source-onboarding','role-gate','location-normalizer','jd-cleaner','senior-recruiter','ats-exact','cv-tailor','post-tailor-verifier','cover-letter','application-questions','outreach','follow-up','interview-prep','application-tracker','skill-refiner','humanizer','fact-verifier','search-supervisor'];

export function seed(db=openDb()){
  migrate(db);
  const insRole=db.prepare('INSERT OR IGNORE INTO target_roles(family,phrase) VALUES (?,?)');for(const [family,phrases] of Object.entries(ROLES))for(const phrase of phrases)insRole.run(family,phrase);
  for(const label of LOCATIONS)upsertTargetLocation(db,{label,origin:'SYSTEM_DEFAULT'});
  const set=db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES (?,?)');
  set.run('mode','MANUAL');set.run('host','127.0.0.1');set.run('port','8787');set.run('search_window_hours','96');
  set.run('auto_prepare_enabled','1');set.run('auto_prepare_verdicts','STRONG MATCH,GOOD MATCH');set.run('application_package_required','1');set.run('auto_contact_research','1');set.run('contact_research_limit','6');set.run('manual_submission_required','1');
  set.run('local_writer_enabled','1');set.run('local_writer_url','http://127.0.0.1:11434');set.run('local_writing_model','');
  set.run('manual_search_soft_limit_minutes','10');set.run('manual_search_hard_limit_minutes','15');set.run('discovery_stall_seconds','120');set.run('source_circuit_breaker_failures','2');set.run('watchdog_auto_restart','0');
  set.run('active_job_retention_days','14');set.run('heavy_payload_retention_days','90');set.run('jev_enabled','0');set.run('jev_path','D:\\Tools\\Jev\\jev.cmd');
  const insSkill=db.prepare('INSERT OR IGNORE INTO skill_versions(skill,version,status) VALUES (?,?,?)');for(const s of SKILLS)insSkill.run(s,'1.0.0','ACTIVE');
  seedSystemSources(db);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) { seed(); console.log('Seed complete'); }

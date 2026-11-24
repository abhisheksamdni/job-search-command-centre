CREATE TABLE IF NOT EXISTS migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS candidate_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT, email TEXT, phone TEXT, current_location TEXT,
  work_authorization_json TEXT NOT NULL DEFAULT '{}',
  preferences_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS cv_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  original_filename TEXT NOT NULL, stored_path TEXT NOT NULL, sha256 TEXT NOT NULL UNIQUE,
  mime_type TEXT, extracted_text TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS cv_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES cv_documents(id), parent_version_id INTEGER REFERENCES cv_versions(id),
  version_label TEXT NOT NULL, is_master INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 0,
  job_id INTEGER, change_log TEXT NOT NULL DEFAULT '', evidence_map_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS evidence_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT, cv_version_id INTEGER REFERENCES cv_versions(id), category TEXT NOT NULL,
  claim TEXT NOT NULL, source_text TEXT NOT NULL, source_ref TEXT, fingerprint TEXT NOT NULL,
  UNIQUE(cv_version_id, fingerprint)
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, external_id TEXT, company TEXT NOT NULL, title TEXT NOT NULL,
  location_raw TEXT NOT NULL DEFAULT '', country TEXT, country_code TEXT, city TEXT, region TEXT,
  remote INTEGER NOT NULL DEFAULT 0, location_confidence REAL NOT NULL DEFAULT 0,
  source_id INTEGER, source_url TEXT, canonical_job_url TEXT, application_url TEXT,
  role_classification TEXT NOT NULL DEFAULT 'REVIEW', role_family TEXT,
  status TEXT NOT NULL DEFAULT 'DISCOVERED', first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, posted_at TEXT, closed_at TEXT,
  UNIQUE(company, title, canonical_job_url)
);
CREATE TABLE IF NOT EXISTS job_urls (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  url_type TEXT NOT NULL, url TEXT NOT NULL, canonical_url TEXT NOT NULL, is_preferred INTEGER NOT NULL DEFAULT 0,
  UNIQUE(job_id, canonical_url)
);
CREATE TABLE IF NOT EXISTS job_jd_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  jd_raw TEXT NOT NULL, jd_clean TEXT NOT NULL, jd_clean_hash TEXT NOT NULL, jd_quality TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(job_id, jd_clean_hash)
);
CREATE TABLE IF NOT EXISTS job_analysis (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  cv_version_id INTEGER REFERENCES cv_versions(id), analysis_type TEXT NOT NULL,
  score REAL, verdict TEXT, payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS requirements (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  category TEXT NOT NULL, text TEXT NOT NULL, evidence_grade TEXT, evidence_ref TEXT
);
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, base_url TEXT,
  enabled INTEGER NOT NULL DEFAULT 1, health TEXT NOT NULL DEFAULT 'UNKNOWN', last_success TEXT, last_failure TEXT,
  last_error TEXT, metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS source_recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  domain TEXT NOT NULL, adapter TEXT NOT NULL, recipe_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'READY',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(source_id, domain)
);
CREATE TABLE IF NOT EXISTS discovery_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, mode TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT, stats_json TEXT NOT NULL DEFAULT '{}', error TEXT
);
CREATE TABLE IF NOT EXISTS discovery_run_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL REFERENCES discovery_runs(id) ON DELETE CASCADE,
  source_id INTEGER REFERENCES sources(id), status TEXT NOT NULL, stats_json TEXT NOT NULL DEFAULT '{}', error TEXT
);
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL UNIQUE REFERENCES jobs(id), status TEXT NOT NULL DEFAULT 'SAVED',
  application_folder TEXT NOT NULL, submitted_cv_version_id INTEGER REFERENCES cv_versions(id),
  applied_at TEXT, followup_due_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS application_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  old_status TEXT, new_status TEXT NOT NULL, actor TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS application_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT, application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, path TEXT NOT NULL, sha256 TEXT, cv_version_id INTEGER REFERENCES cv_versions(id),
  immutable INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, company TEXT, role TEXT, email TEXT, linkedin_url TEXT,
  relationship TEXT, last_contact TEXT, next_followup TEXT, notes TEXT
);
CREATE TABLE IF NOT EXISTS job_contacts (
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  PRIMARY KEY(job_id, contact_id)
);
CREATE TABLE IF NOT EXISTS followups (
  id INTEGER PRIMARY KEY AUTOINCREMENT, application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  due_at TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'APPLICATION', status TEXT NOT NULL DEFAULT 'DUE', notes TEXT
);
CREATE TABLE IF NOT EXISTS interviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT, application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  scheduled_at TEXT, stage TEXT, mode TEXT, interviewers TEXT, notes TEXT, status TEXT NOT NULL DEFAULT 'SCHEDULED'
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL, body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, entity_type TEXT NOT NULL, entity_id INTEGER, event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS skill_versions (
  skill TEXT NOT NULL, version TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(skill, version)
);
CREATE TABLE IF NOT EXISTS target_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT, family TEXT NOT NULL, phrase TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS target_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, country TEXT, country_code TEXT, city TEXT, region TEXT, enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE(country_code, city, region)
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_role ON jobs(role_classification, role_family);
CREATE INDEX IF NOT EXISTS idx_jobs_location ON jobs(country_code, city);
CREATE INDEX IF NOT EXISTS idx_jobs_seen ON jobs(first_seen_at, last_seen_at);
CREATE INDEX IF NOT EXISTS idx_analysis_job ON job_analysis(job_id, analysis_type, created_at);
CREATE INDEX IF NOT EXISTS idx_followups_due ON followups(status, due_at);
CREATE INDEX IF NOT EXISTS idx_app_status ON applications(status, applied_at);

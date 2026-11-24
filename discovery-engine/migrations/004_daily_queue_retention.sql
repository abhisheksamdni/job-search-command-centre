ALTER TABLE jobs ADD COLUMN saved_at TEXT;
ALTER TABLE jobs ADD COLUMN archived_at TEXT;
ALTER TABLE jobs ADD COLUMN archive_reason TEXT;
ALTER TABLE jobs ADD COLUMN payload_purged_at TEXT;

CREATE TABLE IF NOT EXISTS job_tombstones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  source_id INTEGER,
  source_job_id TEXT,
  canonical_url TEXT,
  canonical_url_hash TEXT,
  fingerprint TEXT NOT NULL UNIQUE,
  company TEXT,
  title TEXT,
  first_seen_at TEXT,
  last_seen_at TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS application_work_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  jd_hash TEXT NOT NULL,
  queue_version INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'QUEUED',
  folder_path TEXT NOT NULL,
  queued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(job_id, jd_hash),
  UNIQUE(job_id, queue_version)
);

ALTER TABLE sources ADD COLUMN incremental_json TEXT NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_jobs_archive ON jobs(status, archived_at);
CREATE INDEX IF NOT EXISTS idx_queue_state ON application_work_queue(state, queued_at);
CREATE INDEX IF NOT EXISTS idx_tombstones_source_job ON job_tombstones(source_id, source_job_id);
CREATE INDEX IF NOT EXISTS idx_tombstones_url_hash ON job_tombstones(canonical_url_hash);

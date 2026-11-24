ALTER TABLE application_work_queue ADD COLUMN reviewed_at TEXT;
ALTER TABLE application_work_queue ADD COLUMN approved_at TEXT;
ALTER TABLE application_work_queue ADD COLUMN actor TEXT;
ALTER TABLE application_work_queue ADD COLUMN application_id INTEGER REFERENCES applications(id);
ALTER TABLE application_work_queue ADD COLUMN approved_cv_version_id INTEGER REFERENCES cv_versions(id);
ALTER TABLE application_work_queue ADD COLUMN approved_cv_file_id INTEGER REFERENCES cv_version_files(id);
ALTER TABLE application_work_queue ADD COLUMN approved_cv_sha256 TEXT;
ALTER TABLE application_work_queue ADD COLUMN approved_jd_hash TEXT;
ALTER TABLE application_work_queue ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE application_work_queue ADD COLUMN last_error TEXT;

CREATE INDEX IF NOT EXISTS idx_queue_application ON application_work_queue(application_id);

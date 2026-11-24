ALTER TABLE job_tombstones ADD COLUMN deleted_at TEXT;
ALTER TABLE job_tombstones ADD COLUMN suppression_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_tombstones_suppression
ON job_tombstones(suppression_reason, deleted_at);

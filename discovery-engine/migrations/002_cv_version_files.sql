CREATE TABLE IF NOT EXISTS cv_version_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cv_version_id INTEGER NOT NULL REFERENCES cv_versions(id) ON DELETE CASCADE,
  format TEXT NOT NULL,
  path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  mime_type TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(cv_version_id, path)
);
CREATE INDEX IF NOT EXISTS idx_cv_version_files_version ON cv_version_files(cv_version_id, is_primary DESC, id);
INSERT OR IGNORE INTO cv_version_files(cv_version_id,format,path,sha256,mime_type,is_primary)
SELECT v.id,'SOURCE',d.stored_path,d.sha256,d.mime_type,1
FROM cv_versions v JOIN cv_documents d ON d.id=v.document_id;

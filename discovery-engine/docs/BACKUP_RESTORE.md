# Backup and Restore

Run `backup-jcc.bat` to create a collision-safe timestamped backup under `JCC-Data\Backups`. The backup uses a consistent SQLite snapshot, includes safe configuration metadata and the knowledge vault, and excludes secrets/cookies by default.

Run `restore-jcc.bat` only while JCC is stopped. Select the exact backup folder name. Before replacing the current database, restore creates a mandatory safety backup. If that pre-restore backup fails, the restore aborts.

Restore replaces the backed-up knowledge-vault snapshot exactly so stale newer notes are not retained. After restore, Doctor runs and includes SQLite integrity checking. Do not manually overwrite a live SQLite database or delete a backup to force a restore through an error.

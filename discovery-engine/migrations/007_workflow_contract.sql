ALTER TABLE jobs ADD COLUMN application_override_at TEXT;
ALTER TABLE jobs ADD COLUMN application_override_reason TEXT;
ALTER TABLE jobs ADD COLUMN application_override_actor TEXT;

-- Older alpha builds could promote packages directly from automatic preparation.
-- Under the SEND -> REVIEW -> APPROVE contract, READY_TO_APPLY is valid only when
-- an approved queue record pins the exact CV file and JD hash.
INSERT INTO application_status_history(application_id,old_status,new_status,actor,note)
SELECT a.id,'READY_TO_APPLY','SAVED','migration',
       'Reset legacy READY_TO_APPLY package: explicit work-queue approval is required.'
FROM applications a
WHERE a.status='READY_TO_APPLY'
  AND NOT EXISTS (
    SELECT 1 FROM application_work_queue q
    WHERE q.application_id=a.id
      AND q.state='APPROVED'
      AND q.approved_cv_version_id IS NOT NULL
      AND q.approved_jd_hash IS NOT NULL
  );

INSERT INTO audit_events(entity_type,entity_id,event_type,payload_json)
SELECT 'application',a.id,'LEGACY_READY_RESET',
       '{"actor":"migration","reason":"MISSING_EXPLICIT_QUEUE_APPROVAL"}'
FROM applications a
WHERE a.status='READY_TO_APPLY'
  AND NOT EXISTS (
    SELECT 1 FROM application_work_queue q
    WHERE q.application_id=a.id
      AND q.state='APPROVED'
      AND q.approved_cv_version_id IS NOT NULL
      AND q.approved_jd_hash IS NOT NULL
  );

UPDATE jobs
SET status='SAVED'
WHERE id IN (
  SELECT a.job_id FROM applications a
  WHERE a.status='READY_TO_APPLY'
    AND NOT EXISTS (
      SELECT 1 FROM application_work_queue q
      WHERE q.application_id=a.id
        AND q.state='APPROVED'
        AND q.approved_cv_version_id IS NOT NULL
        AND q.approved_jd_hash IS NOT NULL
    )
);

UPDATE applications
SET status='SAVED',updated_at=CURRENT_TIMESTAMP
WHERE status='READY_TO_APPLY'
  AND NOT EXISTS (
    SELECT 1 FROM application_work_queue q
    WHERE q.application_id=applications.id
      AND q.state='APPROVED'
      AND q.approved_cv_version_id IS NOT NULL
      AND q.approved_jd_hash IS NOT NULL
  );


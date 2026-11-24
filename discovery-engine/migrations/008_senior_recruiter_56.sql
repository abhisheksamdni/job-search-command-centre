UPDATE skill_versions
SET status='SUPERSEDED',updated_at=CURRENT_TIMESTAMP
WHERE skill='senior-recruiter' AND version!='2.0.0' AND status='ACTIVE';

INSERT OR IGNORE INTO skill_versions(skill,version,status)
VALUES ('senior-recruiter','2.0.0','ACTIVE');

UPDATE skill_versions
SET status='SUPERSEDED',updated_at=CURRENT_TIMESTAMP
WHERE skill='cv-tailor' AND version!='1.3.0' AND status='ACTIVE';

INSERT OR IGNORE INTO skill_versions(skill,version,status)
VALUES ('cv-tailor','1.3.0','ACTIVE');

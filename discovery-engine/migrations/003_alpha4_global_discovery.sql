ALTER TABLE jobs ADD COLUMN employer_published_at TEXT;
ALTER TABLE jobs ADD COLUMN source_published_at TEXT;
ALTER TABLE jobs ADD COLUMN published_precision TEXT;
ALTER TABLE jobs ADD COLUMN posting_date_confidence TEXT NOT NULL DEFAULT 'UNVERIFIED';
ALTER TABLE target_locations ADD COLUMN display_label TEXT;
ALTER TABLE target_locations ADD COLUMN country_name TEXT;
ALTER TABLE target_locations ADD COLUMN normalized_key TEXT;
ALTER TABLE target_locations ADD COLUMN origin TEXT NOT NULL DEFAULT 'USER';
ALTER TABLE sources ADD COLUMN ownership TEXT NOT NULL DEFAULT 'USER_ADDED';
ALTER TABLE sources ADD COLUMN adapter TEXT;
ALTER TABLE sources ADD COLUMN canonical_key TEXT;
ALTER TABLE sources ADD COLUMN provenance_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE sources ADD COLUMN last_checked TEXT;
ALTER TABLE sources ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sources ADD COLUMN jobs_found INTEGER NOT NULL DEFAULT 0;

-- Alpha.3 allowed logically duplicate target rows whenever one of the legacy
-- UNIQUE(country_code, city, region) columns was NULL. Collapse those rows
-- before any alpha.4 normalization can turn NULL/blank values into the same
-- non-NULL legacy key. Preserve the strongest enabled state.
UPDATE target_locations AS t
SET enabled=(
  SELECT MAX(t2.enabled)
  FROM target_locations AS t2
  WHERE lower(trim(COALESCE(NULLIF(t2.country_code,''),t2.country,'')))=lower(trim(COALESCE(NULLIF(t.country_code,''),t.country,'')))
    AND lower(trim(COALESCE(t2.city,'')))=lower(trim(COALESCE(t.city,'')))
    AND lower(trim(COALESCE(t2.region,'')))=lower(trim(COALESCE(t.region,'')))
);

DELETE FROM target_locations
WHERE id NOT IN (
  SELECT MIN(id)
  FROM target_locations
  GROUP BY lower(trim(COALESCE(NULLIF(country_code,''),country,''))),
           lower(trim(COALESCE(city,''))),
           lower(trim(COALESCE(region,'')))
);

-- UAE canonicalization changes NULL/blank region to the city name. A legacy
-- row may already have that canonical region, so collapse the entire
-- prospective canonical group before performing the UPDATE that would
-- otherwise trip alpha.3's old UNIQUE constraint.
UPDATE target_locations AS t
SET enabled=(
  SELECT MAX(t2.enabled)
  FROM target_locations AS t2
  WHERE upper(trim(COALESCE(t2.country_code,'')))='AE'
    AND lower(trim(COALESCE(t2.city,'')))=lower(trim(COALESCE(t.city,'')))
    AND lower(trim(COALESCE(t2.city,''))) IN ('dubai','abu dhabi')
    AND (t2.region IS NULL OR trim(t2.region)='' OR lower(trim(t2.region))=lower(trim(t2.city)))
)
WHERE upper(trim(COALESCE(t.country_code,'')))='AE'
  AND lower(trim(COALESCE(t.city,''))) IN ('dubai','abu dhabi')
  AND (t.region IS NULL OR trim(t.region)='' OR lower(trim(t.region))=lower(trim(t.city)));

DELETE FROM target_locations
WHERE upper(trim(COALESCE(country_code,'')))='AE'
  AND lower(trim(COALESCE(city,''))) IN ('dubai','abu dhabi')
  AND (region IS NULL OR trim(region)='' OR lower(trim(region))=lower(trim(city)))
  AND id NOT IN (
    SELECT MIN(id)
    FROM target_locations
    WHERE upper(trim(COALESCE(country_code,'')))='AE'
      AND lower(trim(COALESCE(city,''))) IN ('dubai','abu dhabi')
      AND (region IS NULL OR trim(region)='' OR lower(trim(region))=lower(trim(city)))
    GROUP BY lower(trim(city))
  );

UPDATE target_locations
SET region=city
WHERE upper(trim(COALESCE(country_code,'')))='AE'
  AND lower(trim(COALESCE(city,''))) IN ('dubai','abu dhabi')
  AND (region IS NULL OR trim(region)='');

UPDATE target_locations
SET country_name=COALESCE(country_name,country),
    display_label=COALESCE(NULLIF(trim(display_label),''), trim(COALESCE(city||', ','')||COALESCE(region||', ','')||COALESCE(country,''))),
    normalized_key=(
      CASE lower(trim(COALESCE(country_code,country,'')))
        WHEN 'united kingdom' THEN 'gb' WHEN 'uk' THEN 'gb' WHEN 'great britain' THEN 'gb'
        WHEN 'netherlands' THEN 'nl' WHEN 'holland' THEN 'nl'
        WHEN 'poland' THEN 'pl' WHEN 'switzerland' THEN 'ch' WHEN 'norway' THEN 'no'
        WHEN 'united arab emirates' THEN 'ae' WHEN 'uae' THEN 'ae'
        WHEN 'united states' THEN 'us' WHEN 'united states of america' THEN 'us' WHEN 'usa' THEN 'us'
        WHEN 'india' THEN 'in' WHEN 'germany' THEN 'de' WHEN 'france' THEN 'fr'
        WHEN 'ireland' THEN 'ie' WHEN 'singapore' THEN 'sg' WHEN 'australia' THEN 'au' WHEN 'canada' THEN 'ca'
        ELSE lower(trim(COALESCE(country_code,country,'')))
      END
      || '|' || lower(trim(COALESCE(city,'')))
      || '|' || lower(trim(COALESCE(region,'')))
    ),
    origin=COALESCE(NULLIF(trim(origin),''),'USER')
WHERE normalized_key IS NULL OR trim(normalized_key)='';

UPDATE target_locations
SET enabled=(SELECT MAX(t2.enabled) FROM target_locations t2 WHERE t2.normalized_key=target_locations.normalized_key)
WHERE normalized_key IS NOT NULL;

DELETE FROM target_locations
WHERE normalized_key IS NOT NULL
  AND id NOT IN (SELECT MIN(id) FROM target_locations WHERE normalized_key IS NOT NULL GROUP BY normalized_key);

UPDATE sources SET health='UNTESTED' WHERE upper(trim(COALESCE(health,''))) IN ('READY','UNKNOWN','');

CREATE UNIQUE INDEX IF NOT EXISTS idx_target_locations_normalized_key ON target_locations(normalized_key) WHERE normalized_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_canonical_key ON sources(canonical_key) WHERE canonical_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS discovery_attempts (
 id INTEGER PRIMARY KEY AUTOINCREMENT, source_id INTEGER REFERENCES sources(id) ON DELETE CASCADE,
 run_id INTEGER REFERENCES discovery_runs(id) ON DELETE CASCADE, query_url TEXT, layer TEXT NOT NULL,
 status TEXT NOT NULL, error TEXT, jobs_found INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS job_source_sightings (
 job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
 seen_url TEXT, first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(job_id,source_id)
);
CREATE INDEX IF NOT EXISTS idx_jobs_publication ON jobs(employer_published_at,source_published_at,posted_at);
CREATE INDEX IF NOT EXISTS idx_discovery_attempts_run ON discovery_attempts(run_id,source_id);

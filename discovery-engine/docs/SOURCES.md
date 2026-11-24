# Sources

## Ownership

- `SYSTEM` — shipped auto-managed discovery radars.
- `AUTO_DISCOVERED` — employer/ATS source learned from job provenance.
- `USER_ADDED` — manually added advanced source.

Explicit SYSTEM/USER_ADDED ownership is preserved when an auto-discovered URL collides with the same canonical source.

## Health

Production source health is one of:

`HEALTHY · DEGRADED · RATE_LIMITED · MANUAL_ONLY · DISABLED · UNTESTED`

Legacy `READY` / `UNKNOWN` source health is normalized during alpha.4 migration/seeding. `READY` may still exist as an internal **recipe** status, not a source-health state.

Disabled sources are skipped. Rate-limited, degraded and manual-only sources are isolated and cannot abort other sources.

## Retrieval order

1. Direct ATS/API/feed.
2. Generic HTTP/RSS/sitemap.
3. Playwright for dynamic public pages.
4. Agent Reach public-web fallback when installed.
5. `MANUAL ONLY` when lawful/reliable automation cannot retrieve the source.

## Direct public adapters

Validated deterministic readers exist for Greenhouse, Ashby, Lever, Workday public CXS recipes, SmartRecruiters, Recruitee, Personio and Breezy.

Detection/fallback support only (no invented public API contract): Workable, BambooHR, Teamtailor, Pinpoint, Oracle Recruiting Cloud, Phenom, iCIMS, Radancy/TalentBrew and SuccessFactors.

Fresh installations seed SYSTEM radars for eFinancialCareers, LinkedIn public jobs, Indeed supplemental and JobServe. These are discovery radars, not claims that every page is anonymously scrapeable at all times. Access blocks degrade honestly.

## Publication-date integrity

Official direct-ATS publication values are stored as employer-reported where the upstream field actually represents publication/creation. Feed/aggregator dates are source-reported. Greenhouse `updated_at` is not treated as an employer posting date. JCC never substitutes `first_seen_at` for a reported posting date.

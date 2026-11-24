# Search Supervisor

Deterministic local supervision for JCC discovery. This is not an LLM decision-maker and does not submit applications or send messages.

## Pre-flight
Verify JCC/SQLite health, enabled roles, enabled target locations, enabled discovery sources, Playwright/Chromium availability, Active Master CV status, and one cached Agent Reach availability check. A missing Master may warn while discovery continues; missing sources/roles/locations block a meaningless run.

## Run-time
Use persisted `discovery_runs`, `discovery_run_sources`, `discovery_attempts`, and `stats_json` as discovery truth. Maintain a heartbeat (`lastProgressAt`), current source/query/retrieval layer, planned/completed counters, bounded retrieval, circuit breakers, cancellation, and soft/hard time budgets. Preserve completed work on cancellation, source failure, or `PARTIAL_TIMEOUT`. Never infer liveness with an LLM.

## Post-run
Report explicit status, duration, source outcomes, queries attempted, listings, deduped jobs, role/location matches, JDs, new candidates, Strong/Good counts, errors, and actionable source warnings.

## Safety
- One active discovery run at a time.
- Agent Reach availability is checked once per run; unavailable Agent Reach is skipped rather than retried for every query.
- Public source blocking, CAPTCHA, 403/429, and login walls are recorded accurately; never bypass them.
- Operational logs must not contain CV bodies, full job descriptions, credentials, cookies, tokens, or private application answers.
- Manual application submission and manual message sending remain mandatory.

Related: [[Discovery Agent]], [[Source Onboarding]], [[Application Tracker Agent]]

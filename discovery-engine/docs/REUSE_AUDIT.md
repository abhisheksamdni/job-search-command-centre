# Reuse Audit

| Component | Source | Decision | JCC use |
|---|---|---|---|
| Greenhouse/Ashby/Lever API detection + parsing | career-ops `scan.mjs` | ADAPT | Split into typed adapters; candidate filters come from JCC settings. |
| API-first zero-token scanning | career-ops | ADAPT | Direct public endpoints are first discovery priority. |
| Liveness classification | career-ops `liveness-core.mjs` | ADAPT | Pattern concept retained for source/job health checks. |
| Markdown pipeline storage | career-ops | REPLACE | SQLite is JCC system of record. |
| Career-Ops Go terminal dashboard | career-ops | IGNORE | JCC uses the existing browser-first requirement. |
| Generic public webpage read | Agent-Reach `WebChannel` | ADAPT | Optional fallback provider; never required for core JCC. |
| Agent-Reach doctor/read | Agent-Reach CLI + public web channel | ADAPT | Optional health + public listing/detail fallback after Playwright; never required for core JCC. |
| Social-platform automation | Agent-Reach | IGNORE BY DEFAULT | LinkedIn remains manual/alert mode. |
| JCC v1.7 stable source | local/project files | NOT FOUND IN GITHUB BUILD CONTEXT | No code was overwritten; import path remains a future/local migration task if files are found on the Windows root. |

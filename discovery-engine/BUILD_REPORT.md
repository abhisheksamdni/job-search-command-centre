# JCC LOCAL Build Report

**Version:** 2.0.0-alpha.4  
**Status:** frozen-candidate hardening in progress; Windows target-machine acceptance is still required. This is not `v2.0.0-local` and is not yet declared ready for daily applications.

## Candidate scope

Alpha.4 preserves the local-first SQLite/application-archive/Obsidian architecture and replaces only the daily dashboard experience plus discovery/location hardening. The JobHunt donor supplied visual patterns only; its backend/workflow was not copied.

Key alpha.4 changes:
- donor-inspired navy-sidebar/light-workspace dashboard with compact KPIs, filters, dense table, pagination and modal job workspace;
- configuration moved to Settings/Candidate Profile/Tools;
- deterministic target-location identity via `normalized_key`, migration-time deduplication and idempotent seeding;
- offline/global country aliases and representative financial-centre normalization;
- auto-managed SYSTEM source registry, AUTO_DISCOVERED ATS onboarding and USER_ADDED advanced sources;
- source health model: `HEALTHY`, `DEGRADED`, `RATE_LIMITED`, `MANUAL_ONLY`, `DISABLED`, `UNTESTED`;
- source failure isolation and canonical source deduplication;
- public direct readers for Greenhouse, Ashby, Lever, Workday, SmartRecruiters, Recruitee, Personio and Breezy;
- detection/fallback-only handling for Workable, BambooHR, Teamtailor, Pinpoint, Oracle Recruiting Cloud, Phenom, iCIMS, Radancy/TalentBrew and SuccessFactors;
- honest publication-date model separating employer/source dates from first/last seen timestamps;
- existing Recruiter Match, ATS Exact, CV child versions, DOCX/PDF, integrity verifier and immutable submitted-CV archive preserved;
- grounded cover-letter, application-answer, outreach and interview-prep generation inside the existing application archive;
- Knowledge Graph/SSE and backup/restore retained as non-blocking subsystems.

## Validation

Final expanded regression result on the alpha.4 candidate working tree: **85/85 PASS — 0 failed, 0 skipped, 0 cancelled**. The exact remote candidate tree is reverified after freeze; Windows target acceptance remains separate.

Targeted alpha.4 validation covers:
- alpha.3 duplicate-location migration and repeated-init idempotence;
- global aliases/country-only/free-form city matching;
- source registry without user-added sources;
- source ownership/health normalization and failure isolation;
- ATS-family detection/direct fixtures/fallback honesty;
- publication-date integrity;
- new dashboard/Settings/job-workspace shell;
- grounded package preparation;
- full isolated Discovery → analysis → tailoring → READY TO APPLY → explicit MARK APPLIED → archive/hash/follow-up/interview/graph flow;
- application archive, DOCX/PDF, Knowledge Graph/SSE, Doctor, backup/restore, Workday/RSS and server E2E.

## Live-source validation boundary

Public-page evidence is used only as page-level evidence. Adapter-runtime PASS is not inferred from a browser/search result. CAPTCHA, login and access controls are never bypassed. Any public adapter/browser path that cannot execute in the build environment remains `WINDOWS LIVE VALIDATION REQUIRED`.

## Controlled public-source evidence

Build-environment status is intentionally conservative:

| Source | Build-environment result | Candidate interpretation |
|---|---|---|
| Greenhouse / Point72 | PUBLIC-PAGE PASS | current listing/title/company/location/full JD visible; JCC adapter runtime remains Windows live acceptance |
| Ashby / Checkout.com | PUBLIC-PAGE PASS | current London role/full description visible; JCC adapter runtime remains Windows live acceptance |
| Workday | PUBLIC-PAGE PASS | title/location/requisition/relative posted-on/full description visible; CXS POST runtime remains Windows live acceptance |
| SmartRecruiters | PUBLIC-PAGE PASS | current role/full description visible; JCC direct reader has deterministic fixture coverage; runtime remains Windows live acceptance |
| Generic employer careers / Point72 | PUBLIC-PAGE PASS | multi-location live inventory visible; Playwright runtime remains Windows live acceptance |
| eFinancialCareers | PUBLIC-PAGE PASS / access variability | current London trader listings and source-relative ages visible through web evidence; runtime browser handling remains Windows live acceptance |
| Recruitee / Personio / Breezy | WINDOWS LIVE VALIDATION REQUIRED | deterministic reader fixtures pass; no live adapter execution claimed here |
| Intentional blocked path | DEGRADED / MANUAL ONLY | deterministic fallback/isolation tests pass; no access-control bypass |

No `LIVE ADAPTER PASS` is claimed from this sandbox because direct runtime network/Playwright availability is not equivalent to the web evidence channel.

## Windows acceptance boundary

The candidate must still be installed over the existing alpha.3 Windows deployment at `<JCC home>\jcc-local`, preserving sibling `JCC-Data` and `JCC-Knowledge`. Windows acceptance must prove migration, no logical location duplicates, repeated-init idempotence, global location entry, system sources, real discovery with zero user-added sources, Recruiter/ATS/CV pipeline, Knowledge Graph and backup/restore/restart before `main` can be promoted.

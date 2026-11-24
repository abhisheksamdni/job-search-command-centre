# Architecture

JCC LOCAL is a local Node.js 22+ service bound to `127.0.0.1:8787`. SQLite under sibling `JCC-Data` is the structured system of record; application artifacts are immutable files; `JCC-Knowledge` is the durable Obsidian-compatible knowledge source.

## Discovery

Fresh installs seed auto-managed SYSTEM radars so normal operation is:

`Active CV + target roles + target locations → RUN SEARCH NOW`

Manual Add Source is advanced configuration only.

Retrieval remains:

`Direct ATS/API/feed → HTTP/RSS/Sitemap → Playwright → Agent Reach → MANUAL ONLY`

Each source is isolated. A degraded, rate-limited or manual-only source cannot abort the whole run. Employer ATS URLs discovered through aggregators may be onboarded as `AUTO_DISCOVERED` sources using canonical source identity.

## Analysis, writing and application

`listing normalization → role/location gates → JD Cleaner → requirements → Senior Recruiter → ATS Exact → immutable Master CV baseline → deterministic evidence-safe CV tailor → optional localhost Ollama line rewrite → Humanizer → factual/metric verifier → Recruiter/ATS re-score → template-preserving DOCX/PDF/Markdown child → cover letter/application answers → public contact research → unsent outreach → human review → manual external submission → MARK APPLIED → immutable submitted-CV/JD archive → follow-up/interview`

Recruiter Match is primary. ATS Exact is secondary. Google XYZ is used only when the source evidence contains the result/metric; no metric is created to complete the formula. The optional local writer is restricted to loopback HTTP and is never required for JCC to function. Its output must pass the same deterministic evidence gate or JCC keeps the deterministic version.

The Senior Recruiter owns the complete 56-point Recruiter Intelligence Record. Atomic JD items are classified as `MANDATORY`, `CORE`, `IMPORTANT`, `PREFERRED`, `BONUS`, `BEHAVIOURAL`, `BACKGROUND` or `NOT_A_REQUIREMENT`; candidate evidence is graded as `EXACT_EVIDENCE`, `STRONG_EQUIVALENT`, `TRANSFERABLE_PARTIAL` or `NO_EVIDENCE`. Evidence qualification and ATS lexical discoverability remain separate. CV Tailor can act only through `SURFACE`, `REPHRASE`, `STRENGTHEN`, `GAP_DO_NOT_ADD` and `REMOVE`. Every SEND refreshes this analysis for that exact Job ID before the work-queue eligibility decision.

When the Master is DOCX, JCC edits a copy of the actual DOCX package and records whether template preservation succeeded. PDF conversion prefers local Word automation, then LibreOffice, then a controlled local fallback. Preservation flags and warnings report what actually happened rather than claiming fidelity after fallback rendering.

Application-writing, contact, outreach and follow-up stages are preparation only. JCC never submits an application, sends a recruiter message, invents a contact, or marks APPLIED without explicit user action. Interview prep is pinned to the exact submitted CV version/hash and stored JD snapshot.

## Location model

`target_locations.normalized_key` is the durable logical identity. Alpha.4 migration merges legacy NULL/empty duplicates. Country-only, city/country and unresolved free-form locations are supported without inventing geography.

## Publication dates

`employer_published_at`, `source_published_at`, `posted_at`, `first_seen_at`, `last_seen_at`, `published_precision` and `posting_date_confidence` remain separate. `first_seen_at` is discovery evidence, never an employer-confirmed posting date.

## Knowledge graph

`JCC-Knowledge` remains canonical for relationships. Skill and agent Markdown contracts use wikilinks such as `[[humanizer]]`, `[[cv-tailor]]`, `[[post-tailor-verifier]]`, `[[cover-letter]]`, `[[outreach]]` and `[[follow-up]]`, so the existing graph index exposes the writing/application orchestration without copying private CV/JD bodies. JCC derives `JCC-Data\graph\graph-index.json` and streams changes to `/knowledge-graph` over SSE. Graph failure is non-blocking to core JCC.

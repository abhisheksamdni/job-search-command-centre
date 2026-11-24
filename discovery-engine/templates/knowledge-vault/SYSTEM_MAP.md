---
type: architecture
tags: [architecture]
---
# System Map

- Database → migrations/001_initial.sql + 002_cv_version_files.sql + 003_alpha4_global_discovery.sql
- Discovery → SYSTEM/AUTO_DISCOVERED/USER_ADDED sources → direct ATS/API/feed → HTTP/RSS/sitemap → Playwright → Agent Reach → MANUAL ONLY
- Location Normalizer → normalized_key target identity + global aliases + tolerant matching
- Senior Recruiter → primary professional match
- ATS Exact → secondary exact-term analysis
- CV Tailor / Renderer → child Markdown + DOCX + PDF → Post Tailor Verifier
- Application Tracker / Archive → explicit MARK APPLIED → exact submitted file + SHA-256
- Package Prep → grounded cover letter / answers / outreach / interview prep
- Knowledge Map → JCC-Knowledge Markdown
- Live Knowledge Graph → graph index + watcher + SSE + `/knowledge-graph`

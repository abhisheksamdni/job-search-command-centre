# JCC LOCAL v2

**Current build: 2.0.0-alpha.4 — release hardening.**

Local-first Job Command Centre for zero-paid-runtime job discovery, evidence-based Recruiter/ATS analysis, immutable CV versioning, manual applications, follow-ups, interview recall and a live local 3D knowledge graph. JCC never auto-submits applications or automatically marks a job APPLIED.

## Windows quick start

Put the repository in a folder named `jcc-local`, run `install.bat`, then `start-jcc.bat`. Dashboard: `http://127.0.0.1:8787`. Knowledge Graph: `http://127.0.0.1:8787/knowledge-graph`.

Private runtime data lives outside Git under sibling `JCC-Data`; the populated Obsidian-compatible vault lives under sibling `JCC-Knowledge`.

This alpha is not a frozen `v2.0.0-local` release until the real Windows target-machine validation succeeds.

To share a clean copy, run `npm run release:portable`. The allow-listed package excludes private data, CVs, applications, browser state, logs, databases, secrets, Git history and installed dependencies. See `docs/SHARING.md`.

See `docs/INSTALL.md`, `docs/DAILY_WORKFLOW.md`, `docs/SOURCES.md`, `docs/APPLICATION_ARCHIVE.md`, `docs/KNOWLEDGE_GRAPH.md` and `BUILD_REPORT.md`.

# interview-agent

Builds interview preparation from the immutable submitted application package.

Orchestration:
1. Load the exact submitted CV artifact and recorded SHA-256.
2. Load the immutable submitted JD snapshot, cover letter, application answers, Recruiter analysis, ATS analysis and application history.
3. Run [[interview-prep]].
4. Run [[humanizer]].
5. Run [[fact-verifier]] after Humanizer.
6. Store interview preparation without modifying any submitted artifact.

A later Master or tailored CV must never replace the submitted baseline. Skills are the source of truth; this file defines orchestration only.

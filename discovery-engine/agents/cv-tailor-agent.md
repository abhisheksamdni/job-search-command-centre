# cv-tailor-agent

Owns the job-specific CV-writing pass.

Orchestration:
1. Use the immutable Master CV as the default parent.
2. Read Recruiter Match + ATS Exact requirement/evidence maps.
3. Run [[cv-tailor]] using Google XYZ where evidence supports it.
4. Run [[humanizer]] on changed candidate-facing prose only.
5. Render a new job-linked child CV; never mutate the Master.
6. Hand the child version to [[post-tailor-verifier]] / Verification Agent.

Hard stop: no invented metric, responsibility, tool, title, date or qualification. A score improvement never overrides evidence integrity.

Skills are the source of truth; this file defines orchestration only.

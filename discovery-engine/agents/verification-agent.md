# verification-agent

Owns the post-tailor quality gate.

Orchestration:
1. Run [[post-tailor-verifier]] against the immutable Master parent and actual tailored child.
2. Re-run Recruiter Match and ATS Exact.
3. Verify title/date/qualification/metric integrity and evidence traceability.
4. Verify Google XYZ metrics are source-backed.
5. Run [[humanizer]] audit for voice drift, generic filler, fake specificity, prompt/tool residue and formatting artifacts.
6. Block `READY_TO_APPLY` if unsupported claims or factual drift exist.

A higher score never overrides factual integrity.

Skills are the source of truth; this file defines orchestration only.

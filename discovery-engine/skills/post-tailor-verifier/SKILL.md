# post-tailor-verifier

**Version:** 1.2.0

## Purpose
Re-run Recruiter Match and ATS Exact after tailoring, verify factual/evidence integrity, and block any application package whose child CV drifts from the immutable Master CV.

## Inputs
Master CV, tailored child CV, evidence ledger, JD requirements, pre-tailor analysis, [[humanizer]] audit

## Outputs
Before/after Recruiter score, before/after ATS score, requirement coverage, unsupported claims, metric/date/title drift report, humanizer audit, integrity `PASS/FAIL`

## Hard rules
- Unsupported claims must equal zero before recommending `READY_TO_APPLY`.
- Every numeric value in a rewritten CV claim must be traceable to Master/evidence data.
- Employer names, titles, dates, education, qualifications and existing metrics must not drift.
- New tools, products or asset classes, leadership/seniority/scope inflation, invented responsibilities, PnL/performance/client/achievement claims and deletion of high-value evidence must fail verification.
- Missing requirements remain gaps; they must not be hidden through vague wording.
- New JD terminology is acceptable only when the evidence ledger supports the underlying claim.
- Verify Google XYZ bullets: `Y` may only be a real existing measure; no manufactured metric.
- Verify that the tailored version's default parent is the immutable Master CV, not another job-tailored child.
- Run [[humanizer]] checks for generic filler, voice drift, prompt/tool residue, fake specificity and formatting residue.

## Failure modes
- Missing parent/evidence/JD: return `REVIEW_AGAIN`.
- Any unsupported claim or numeric drift: `FAIL`.
- Abrupt regional-English/voice change without destination requirement: flag for review.
- Rendering fallback: report it explicitly rather than claiming template preservation.

## Acceptance tests
- Recruiter/ATS are rerun against the actual child text.
- Before/after results are stored with the job and CV version.
- Unsupported claims = 0 for `PASS`.
- Title/date/metric drift = 0 for `PASS`.
- Humanizer/tool-residue audit passes.
- Master/Submitted CV files remain unchanged.

## What this skill MUST NOT do
- Submit applications or send messages.
- Bypass authentication, CAPTCHA, paywalls or technical access restrictions.
- Approve a CV that introduced unsupported content merely because its score improved.

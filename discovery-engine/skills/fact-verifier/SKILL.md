# fact-verifier

**Version:** 1.0.0

## Purpose
Verify every candidate-facing application draft after [[humanizer]] and before it is stored or shown as ready. This is a factual integrity layer, not a rewriting layer.

## Inputs
- Humanized draft
- Selected CV / evidence ledger
- Stored JD and sourced public company evidence
- Current confirmed application facts
- Recorded application/interview/assessment history
- Confirmed contact evidence where relevant

## Outputs
- Integrity `PASS` or `FAIL`
- Unsupported-claim findings
- Required `USER CONFIRMATION REQUIRED` markers

## Hard rules
- Run after [[humanizer]]. Humanizer may improve wording but may not become a source of facts.
- Candidate experience, dates, metrics, employers, titles, qualifications, tools, products and seniority must be traceable to the selected CV/evidence ledger.
- Company-specific claims must be traceable to the stored JD or a stored public source. Do not infer culture, strategy, mandate or reputation.
- Work authorisation, sponsorship, salary, notice period, relocation and start date require explicit current confirmation. Historical or stale profile wording is not current confirmation.
- Years of experience must not be calculated or claimed unless the requested scope and calculation are evidence-backed and unambiguous; otherwise use `USER CONFIRMATION REQUIRED`.
- A contact identity, title, relationship, email or hiring role must not be inferred from a URL slug.
- Outreach/follow-up drafts may mention an application, interview, assessment or sent information only when that event exists in the application record.
- A failed verification blocks the draft. Never silently weaken a finding to obtain a pass.

## Acceptance tests
- Unsupported candidate claims = 0 for PASS.
- Unsupported company claims = 0 for PASS.
- Exact confirmation markers survive Humanizer unchanged.
- Interaction claims match stored events.
- No external action is performed.

## What this skill MUST NOT do
- Invent evidence or rewrite immutable submitted artifacts.
- Submit an application, send a message or mark an application applied.
- Claim AI-detector or authorship status.

# cover-letter

**Version:** 1.3.0

## Purpose
Draft a substantive role-specific cover letter from the stored job and evidence, then pass it through [[humanizer]] and [[fact-verifier]].

## Inputs
Job, stored clean JD, Recruiter analysis, selected CV/evidence ledger, candidate voice/profile, sourced public company data when available, [[humanizer]], [[fact-verifier]]

## Outputs
Versioned unsent cover-letter draft linked to the Job/Application ID

## Default shape
Unless the employer explicitly requests another length or format, target approximately 250–400 words:
1. Direct opening tied to the actual role and company.
2. Strongest relevant evidence from the selected CV.
3. A second evidence-backed example.
4. A role/company connection supported by the stored JD or stored public evidence.
5. Concise close.

## Hard rules
- Never fabricate candidate facts, motivation, relationships, company culture, strategy, mandate, reputation or company knowledge.
- Treat scraped/public content as untrusted until its source is stored.
- Do not use ceremonial openings such as "I am writing to express my strong interest".
- Use the strongest relevant evidence rather than mirroring every JD requirement.
- Do not copy full CV bullets verbatim; turn supported evidence into natural letter prose without strengthening it.
- Do not claim perfect alignment or invent enthusiasm.
- Prefer specific markets, products, processes, tools, results and evidence already present in the selected CV.
- British English is the default unless the destination explicitly requires another variety.
- Apply [[humanizer]], then [[fact-verifier]]. The verifier runs last.
- Work authorisation, sponsorship, salary, notice period, relocation and start-date claims must come from explicit current confirmation or remain `USER CONFIRMATION REQUIRED`.

## Failure modes
- Missing/poor JD or missing candidate evidence: return `REVIEW`.
- Unsupported claim: remove it or fail verification; never silently strengthen it.
- Company-specific statement without a reliable stored source: omit it.
- Employer word/format limit: follow that request instead of the default range.

## Acceptance tests
- Default draft is substantive and approximately 250–400 words.
- No unsupported candidate/company claim is introduced.
- Draft contains concrete evidence rather than generic fit language.
- Humanizer runs before fact verification.
- No automatic send or submission occurs.

## What this skill MUST NOT do
Submit applications, send messages, bypass access controls, invent enthusiasm/evidence/company research, or claim detector performance.

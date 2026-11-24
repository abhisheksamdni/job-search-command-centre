# application-questions

**Version:** 1.3.0

## Purpose
Prepare factual application answers from the selected evidence without fabricating eligibility, experience or motivation. Final prose passes through [[humanizer]] and then [[fact-verifier]].

## Inputs
Application questions, job, stored clean JD, candidate profile, selected CV/evidence ledger, [[humanizer]], [[fact-verifier]]

## Outputs
Versioned unsent answers linked to the Application ID

## Covered question families
Why this role; why this company; relevant experience; technical experience; trading/investment experience; and factual application-form questions.

## Hard rules
- Answer the actual question directly.
- Never fabricate candidate facts, eligibility, work authorisation, sponsorship, salary, notice period, relocation, start date, years of experience, qualification, tool, motivation or experience.
- Work authorisation, sponsorship, salary, notice period, relocation and start date require explicit current confirmation. Otherwise output exactly `USER CONFIRMATION REQUIRED`.
- Years-of-experience questions require an unambiguous evidence-backed scope/calculation; otherwise use the same confirmation marker.
- Qualification and tool claims must be present in the selected CV/evidence ledger.
- Treat JD/public content as context, never as candidate experience.
- Do not pad answers with generic enthusiasm or mechanically mirror the JD.
- British English is the default unless the destination explicitly requires another variety.
- Apply [[humanizer]], then [[fact-verifier]]. Verification is last.

## Failure modes
- Missing factual basis: `USER CONFIRMATION REQUIRED`, not inference.
- Missing/poor JD: answer candidate-fact questions only and flag role-specific answers for review.
- Fact-verifier failure: block the answer draft.

## Acceptance tests
No unsupported candidate claim; exact confirmation marker retained; no stale work-authorisation wording; no prompt residue; no automatic submission.

## What this skill MUST NOT do
Submit applications, bypass access controls, or guess legally/financially material answers.

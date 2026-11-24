# outreach

**Version:** 1.3.0

## Purpose
Research relevant public hiring contacts and draft short unsent messages. Final prose runs through [[humanizer]] and then [[fact-verifier]].

## Inputs
Job/company, public contact evidence, candidate evidence, actual application state, [[humanizer]], [[fact-verifier]]

## Outputs
Contact candidates with source/confidence/confirmation state/relationship plus unsent personalised drafts

## Contact-research order
1. Official employer careers/team/staff/job-posting metadata.
2. Public web/ATS sources already available to JCC.
3. Agent Reach as an optional public-web fallback/router.
4. Manual research when access is blocked or identity cannot be verified.

## Hard rules
- Never fabricate a name, title, email, LinkedIn URL, relationship or role in the hiring process.
- A URL slug alone is never enough to confirm identity.
- Store source URL, LinkedIn URL when supported, confidence, confirmation state and relationship.
- Auto-discovered people remain unconfirmed until corroborated/user-confirmed.
- Do not invent familiarity, mutual connections, referrals or prior conversations.
- Use the actual role/company and strongest supported candidate evidence.
- Do not write "I applied" or an equivalent submission claim until a manual MARK APPLIED event exists.
- Avoid generic flattery and invented enthusiasm.
- Apply [[humanizer]], then [[fact-verifier]].
- Manual send is mandatory. Do not automate login, CAPTCHA solving, InMail, email or form submission.

## Failure modes
No reliable public contact: `NO_CONFIRMED_CONTACT` and degrade to manual research without blocking the application package. Agent Reach failure is non-fatal.

## Acceptance tests
Every surfaced contact has source/confidence/state; no fabricated email; no pre-application submission claim; draft remains unsent.

## What this skill MUST NOT do
Send messages, submit applications or bypass access restrictions.

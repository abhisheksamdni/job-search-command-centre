# follow-up

**Version:** 1.2.0

## Purpose
Create evidence-grounded unsent follow-up drafts only after the relevant real event is recorded. Final prose passes through [[humanizer]] and then [[fact-verifier]].

## Supported events
- Manually recorded application submission.
- Completed interview recorded as completed.
- Completed assessment recorded in application history/evidence.
- Requested information recorded as sent.

## Hard rules
- Block a stage-specific follow-up when its event is missing.
- Never fabricate an application, interview, assessment, sent information, candidate fact, recruiter interest, feedback, promise or urgency.
- Refer only to stored events/dates/contacts.
- Missing contact name uses a neutral greeting; never invent a name.
- Keep the message short and specific.
- British English/voice is preserved.
- Apply [[humanizer]], then [[fact-verifier]].
- Sending remains manual.

## Acceptance tests
Application follow-up is blocked without MARK APPLIED; interview follow-up is blocked until completion evidence exists; verifier passes; no send action exists.

## What this skill MUST NOT do
Send outreach, bypass access restrictions, or rewrite immutable submitted artifacts.

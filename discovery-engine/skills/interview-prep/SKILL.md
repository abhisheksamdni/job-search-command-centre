# interview-prep

**Version:** 1.3.0

## Purpose
Build role-specific interview preparation from the exact immutable package that was submitted. Final prose runs through [[humanizer]] and then [[fact-verifier]].

## Required immutable inputs
- Exact submitted CV artifact
- Submitted CV version ID and SHA-256
- Submitted JD snapshot
- Submitted cover letter
- Submitted application answers
- Recruiter analysis frozen at submission
- ATS analysis frozen at submission
- Application status/history frozen at submission

## Outputs
Technical/behavioural preparation, evidence emphasis, safe gap handling, likely topic map and questions to ask

## Hard rules
- The submitted CV, never a later Master or tailored CV, is the factual baseline.
- Validate the stored submitted artifact against its recorded SHA before preparation.
- Use the submitted cover letter/answers as commitments already made to the employer.
- Never fabricate examples, PnL, metrics, responsibilities, motivations, interviewer information or resolved confirmation facts.
- Unknown interviewer/contact remains unknown.
- Preserve `USER CONFIRMATION REQUIRED` where the submitted package left a fact unresolved.
- British English/voice is preserved.
- Apply [[humanizer]], then [[fact-verifier]] without modifying immutable inputs.

## Failure modes
Any missing/changed required submitted artifact: stop and require the correct archive. Unsupported evidence: flag it rather than turning it into a story.

## Acceptance tests
Prep references the exact submitted CV version/SHA and frozen package; later CV/application edits do not affect it; verifier passes.

## What this skill MUST NOT do
Submit applications, send messages, bypass access restrictions, or rewrite submitted artifacts.

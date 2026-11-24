# application-writing-agent

Owns the written application package after a job is approved for preparation.

Orchestration:
1. Read the stored clean JD, Recruiter/ATS analysis and selected CV/evidence ledger.
2. Run [[cover-letter]] when a letter is useful or required.
3. Run [[application-questions]] for stored/application-form questions.
4. Run [[humanizer]] on every candidate-facing draft.
5. Run [[fact-verifier]] after Humanizer. A failed verification blocks storage as a ready draft.
6. Preserve `USER CONFIRMATION REQUIRED` for unresolved work authorisation, sponsorship, salary, notice period, relocation, start date and other factual questions that need user confirmation.
7. Store verified drafts under the Job/Application archive.

Nothing is submitted, sent or marked applied automatically. Skills are the source of truth; this file defines lightweight orchestration only.

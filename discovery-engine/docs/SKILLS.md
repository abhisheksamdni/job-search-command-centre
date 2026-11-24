# Skills and agent contracts

Each `skills/<name>/SKILL.md` is a behavioural contract. Code owns deterministic execution; skills define inputs, outputs, hard rules, failure modes and acceptance criteria. Agents orchestrate skills rather than duplicating their logic.

JCC currently carries these reusable skills:

1. `discovery`
2. `source-onboarding`
3. `role-gate`
4. `location-normalizer`
5. `jd-cleaner`
6. `senior-recruiter`
7. `ats-exact`
8. `cv-tailor`
9. `post-tailor-verifier`
10. `cover-letter`
11. `application-questions`
12. `outreach`
13. `follow-up`
14. `interview-prep`
15. `application-tracker`
16. `skill-refiner`
17. `humanizer`

`humanizer` is a shared final-writing layer rather than a replacement for any domain skill. It applies after factual/evidence decisions have been made and before candidate-facing text is stored. It preserves facts, intent, voice, vocabulary, regional English and formality; removes formulaic filler and tool residue; and never optimizes for AI-detector evasion.

CV writing follows Google XYZ where evidence supports it: **Accomplished X, as measured by Y, by doing Z.** A metric is never invented merely to complete the formula. The immutable Master CV remains the default parent for every job-tailored child.

The optional local writing engine is an Ollama-compatible enhancement restricted to localhost/loopback. It works line-by-line after deterministic tailoring; any rewrite that changes a number or fails factual integrity is rejected. If the service/model is absent, normal deterministic JCC operation continues.

Agent Reach remains part of JCC's retrieval fallback after Playwright and is also used conservatively for public contact research. Contact candidates retain source/confidence and remain unconfirmed until evidence supports identity; URL slugs and guessed email patterns are not treated as identities.

Application Writing, Outreach and Follow-up agents orchestrate their domain skills plus `humanizer`. The exact unresolved-fact marker is `USER CONFIRMATION REQUIRED`. Application-writing agents never submit or send externally. Final application submission, recruiter/referral outreach and follow-up sending remain manual actions.

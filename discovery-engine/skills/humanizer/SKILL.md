# humanizer

**Version:** 1.0.0

## Purpose

Provide the shared final-writing layer for every candidate-facing or recruiter-facing draft produced by JCC: CV bullets, profile text, cover letters, application answers, outreach, follow-ups and interview material.

The goal is natural, specific, selective writing that preserves the candidate's real facts and voice. This skill must never claim, promise or optimize for AI-detector evasion.

## Inputs

- Source text or generated draft
- Candidate evidence ledger and immutable CV facts where applicable
- Intended reader and purpose
- Regional English / voice sample when available
- Domain: `CV`, `COVER_LETTER`, `APPLICATION_ANSWER`, `OUTREACH`, `FOLLOW_UP`, `INTERVIEW`, `GENERAL`

## Outputs

- Finalized text
- Change/audit notes when requested by another skill
- `USER CONFIRMATION REQUIRED` markers for facts that cannot be established safely

## Prime directive

Preserve the writer's facts, intent, voice, vocabulary, regional English and level of formality. Change only what needs changing.

Prefer specificity over polish, evidence over adjectives, direct verbs over abstract nouns, natural repetition over synonym cycling, and selective coverage over artificial completeness.

## Mandatory rules

- Never invent a fact, date, metric, title, qualification, location, source, relationship, emotion, anecdote or personal experience.
- Never strengthen a claim beyond the evidence ledger.
- Never create a metric to satisfy CV structure. If a measurable result is unavailable, use the supported non-metric result or leave the claim unchanged.
- Preserve distinctive wording that belongs to the candidate when it is clear and accurate.
- Preserve British/Indian/other regional English already used by the candidate unless a destination explicitly requires another variety.
- Do not manufacture typos, slang, hesitation, fragments, sensory details or other fake imperfections.
- Do not turn every idea into three points, equal-length bullets or symmetrical clauses.
- Do not use generic enthusiasm, inflated significance, promotional copy or consultant filler.
- Do not add generic introductions, conclusions, next steps, takeaways, pros/cons or headings unless the material genuinely needs them.
- Do not leave chatbot/meta text, Markdown residue, placeholders, tool references or internal instructions in finished copy.
- Protect URLs, email addresses, identifiers, exact values, citations, quotations, commands and other non-prose spans from stylistic rewriting.
- Remove clearly non-semantic artifacts such as BOM, soft-hyphen, zero-width-space and word-joiner when doing so cannot change meaning. Do not strip ZWNJ/ZWJ, variation selectors or no-break spaces by default because they can carry language, emoji or layout semantics.
- Never claim or optimize for detector evasion. Quality is judged by factual integrity, relevance, voice continuity, clarity and information density.

## High-risk patterns to remove when they are formulaic

Generic framing and wrap-up: `In today's...`, `When it comes to...`, `It is important to...`, `Overall`, `Ultimately`, `In conclusion`, `The key takeaway`.

Canned transitions and rhetorical scaffolding: repeated `Additionally`, `Furthermore`, `Moreover`, `That said`, `Here's the thing`, `The result?`, `The problem?`, repeated rhetorical questions, forced one-line punchiness.

Artificial symmetry: `not only X but also Y`, `not just X but Y`, repeated rule-of-three constructions, repeated adjective/verb/noun triplets, equal-length bullets written to a template rather than the evidence.

Corporate filler: `leverage`, `unlock value`, `foster collaboration`, `drive meaningful outcomes`, `navigate complexities`, `holistic`, `robust`, `seamless`, `dynamic landscape`, `actionable insights` when plain specific wording is more accurate.

Shallow analysis and vague attribution: `This highlights`, `This underscores`, `research suggests`, `experts agree`, `industry leaders believe` without named evidence.

Generic professional copy: `I hope this message finds you well`, `I am writing to express my strong interest`, `I would be thrilled`, `I am incredibly excited`, `uniquely suited`, `passionate about` unless those words genuinely belong to the candidate and add information.

## Domain rules

### CV

- Keep employer names, titles, dates, qualifications and metrics exact.
- Use the Google XYZ structure where evidence supports it: **Accomplished X, as measured by Y, by doing Z.**
- `Y` must already exist in the evidence. Never create a number or imply measurement that was not supplied.
- If no defensible `Y` exists, use an evidence-backed `X by doing Z` form rather than inventing a metric.
- One bullet should carry one main achievement or responsibility. Do not keyword-stuff.
- Prefer action + scope/method + result. Keep the candidate's domain terms.
- Tailored CVs are children of the immutable Master CV by default, never children of another job-tailored CV unless the user explicitly chooses that parent.
- The Master CV must never be overwritten or silently deactivated by a tailored child.

### Cover letter

- Start with the reason for the application, not a ceremonial opening.
- Use the strongest two or three relevant pieces of supported evidence only when they genuinely deserve inclusion; do not force a three-part structure.
- Do not mirror the JD line-by-line or claim perfect alignment.
- Keep the letter concise and role-specific.

### Application answers

- Answer the question directly.
- Use only confirmed profile/evidence data.
- Work authorisation, sponsorship, salary, relocation and start-date facts remain `USER CONFIRMATION REQUIRED` unless explicitly stored as current confirmed data.

### Outreach

- State why the recipient is relevant using public/confirmed information only.
- Do not invent familiarity, referrals or relationships.
- Keep messages brief, specific and unsent. Manual send remains mandatory.

### Follow-up

- Refer to the actual application/interview event and date when known.
- Do not manufacture urgency, recruiter interest or prior promises.
- Draft only; sending is manual.

### Interview material

- Use the exact submitted CV and stored JD snapshot as the factual baseline.
- Preserve uncertainty and gap-handling language rather than inventing examples.

## Text-hygiene layer

Before and after JCC-generated prose is finalized:

1. Preserve protected spans.
2. Remove only safe, clearly non-semantic text artifacts by default.
3. Preserve semantic Unicode and layout spaces unless an explicit normalization step is safe for the target format.
4. Remove prompt/tool/placeholder residue.
5. Re-run factual integrity and voice checks.

This separation is inspired by the useful conservative text-hygiene concepts in `guillaumemeyer/watermarks-remover` (MIT). JCC does **not** adopt detector scoring, stylometry optimization, artificial burstiness, recursive paraphrase or any promise of undetectability.

## Acceptance tests

- Facts, dates, names, titles and metrics do not drift.
- Unsupported claims remain zero.
- CV metrics in XYZ bullets are traceable to the source evidence.
- Generic boilerplate is not introduced by JCC-generated application copy.
- Voice/spelling does not abruptly switch without an explicit destination requirement.
- Tool/prompt/placeholder residue is absent.
- Manual-send boundaries remain intact.

## What this skill MUST NOT do

- Submit an application, send a message or contact a person automatically.
- Bypass authentication, CAPTCHA, paywalls or access restrictions.
- Fabricate evidence to improve Recruiter/ATS scores.
- Rewrite immutable submitted artifacts.
- Claim detector performance, human authorship or watermark-removal success.

# Automation: find, screen and tailor applications

You are run headlessly by the Command Centre (`_engine/autopilot.mjs`), one focused pass at a time; the
prompt says which step to do. Work only inside this folder. Never submit an application, send a message,
open a browser, or mark anything as sent: those are the user's own actions. Never edit anything under
`_engine/` except through the CLIs below, and never modify `_engine/master/`.

## Read first

- `_engine/candidate-facts.md` (copy of `candidate-facts.example.md`): truth constraints. These override
  everything else.
- `_engine/master/paragraph-map.txt`: numbered paragraphs of the master CV (the only factual source).
- `_engine/settings.json`: `minVerdict`.
- For Step 2: `APP-001 Example Markets - Junior Trader/spec.json` as a passing example of the shape.

## Step 0: Indeed (official connector)

Search Indeed with `search_jobs` for each of your role families in each of your locations. Edit both
lists for your own search:
- **Locations (country code):** London (GB), Amsterdam (NL), Dublin (IE).
- **Role families:** junior or graduate trader; trading analyst; market risk analyst; investment research
  analyst.

For every result posted in the last 14 days that fits the role families:
1. Check it hasn't been seen: `node _engine/queue.mjs --seen indeed:<jobId>`.
2. If it's NEW, call `get_job_details` and write `_engine/inbox-indeed/indeed-<jobId>.md` in this format:
   ```
   key: indeed:<jobId>
   title: <job title>
   company: <company>
   location: <location>
   url: <the Indeed apply URL, unchanged>
   posted: <YYYY-MM-DD>

   <the full job description text>
   ```

## Step 1: screen the given inbox files

For each role decide a verdict:
1. Remove employer marketing, benefits and EEO text.
2. List the real requirements, weighted 0-5.
3. Mark hard gates and knockouts.
4. Match each requirement against the master CV evidence: exact, strong semantic, partial, adjacent or none.

Automatic knockouts (verdict DO NOT APPLY) are listed in `candidate-facts.md`, for example a required
language you don't speak, a seniority level you don't have, or a must-have tool the master CV doesn't
evidence.

Verdicts, ranked STRONG > GOOD > STRETCH > WEAK > DO NOT APPLY:
- STRONG MATCH: strong evidence, no gate missing.
- GOOD MATCH: good evidence, no gate missing.
- STRETCH: one central gate partial.
- WEAK MATCH: weak evidence.
- DO NOT APPLY: a knockout.

Then act on it:
- **JCC files** (first line `jccJobId: <id>`):
  - below `minVerdict`: `node _engine/queue.mjs --screen <id> "<VERDICT>" "<one-line reason>"`;
  - otherwise: `node _engine/queue.mjs <id> "<VERDICT>" "<one-line reason>"`.
- **Indeed files** (`indeed-<jobId>.md`):
  - below `minVerdict`: `node _engine/queue.mjs --screen-ext indeed:<jobId> "<VERDICT>" "<reason>" "<title>" "<company>"`;
  - otherwise: `node _engine/queue.mjs --file _engine/inbox/indeed-<jobId>.md "<VERDICT>" "<one-line reason>"`.

## Step 2: tailor one application (the folder named in the prompt)

0. If `JD.md` has no real job description, do NOT tailor: run
   `node _engine/queue.mjs --status <APP-id> draft "No job description: paste it with + Add job"` and finish.
1. `node _engine/queue.mjs --status <APP-id> tailoring`
2. Read the folder's `JD.md`. Write `spec.json` with:
   - `analysis`: `priority`, a two-sentence `summary`, genuine `gaps`, `openQuestions` (right to work,
     notice period, salary, anything binding) and `requirements`:
     `[{ "req", "weight": 0-5, "gate": true|false, "match": "EXACT"|"STRONG"|"PARTIAL"|"ADJACENT"|"NONE", "quality": "recent"|"older"|"adjacent"|"project"|"academic"|"certification"|"skills", "evidence": "where in the master CV" }]`.
     Do not write scores or a verdict: the build computes them from this table and the JD keywords.
   - `cv.ops`: edits against paragraph numbers in `paragraph-map.txt`. Each op has `expect` (the start
     of that master paragraph):
     - `replace` {p, text};
     - `replaceAfter` {p, sep, text}: sep ":" for skills labels, "\t" for a manual bullet (a TEXT
       paragraph that starts with "• <TAB>");
     - `delete`: ONLY for BLANK paragraphs;
     - `moveBefore` {p:[block], before}: to bring the most relevant project or block forward.
   - `coverLetter`: date, recipient lines, subject, greeting, 4-5 paragraphs of 220-400 words in total
     naming the company, and signoff "Kind regards,".
   - `allowTerms`: only to name the role or state a gap, each with a reason.
3. `node _engine/build.mjs "<folder>"`. If it prints FAIL, fix the spec and rebuild, up to 3 attempts.
   If it still fails: `node _engine/queue.mjs --status <APP-id> draft "<what failed>"`.

## Never delete experience

Every role, project, bullet, certification and education entry in the master stays in every CV. Make
it relevant by rewriting, reordering and moving blocks, not by removing them. Each rewritten bullet keeps
every metric it had. The build fails a CV that deletes master content, drops a metric, drops a JD keyword
the master evidences, or lowers ATS keyword coverage.

## Bullet rules (enforced by the build)

- **Google XYZ.** "Accomplished X, as measured by Y, by doing Z". Use the metric only when the master has
  one; otherwise "Accomplished X by doing Z".
- **Full length.** A bullet of 20+ words in the master stays at 20+ words.
- **Same facts.** Keep every metric, tool, market and product the master bullet names.

## Writing rules

- **No new facts.** Never add a number, tool, product, language, qualification, title, date or
  responsibility that is not in the master CV.
- **No inflation.** Never turn simulated into live, project into employment, designing into deployed,
  supported into led, or contributed into caused.
- **Human, specific prose.** No "passionate", "leverage", "spearhead", "showcase", "results-driven",
  "fast-paced", "I am writing to express", em dashes, or "not only... but also".
- **Binding answers.** Never state visa status, notice period or salary. Put them in openQuestions.

## Step 3: replies and follow-ups (only if Gmail tools are available; otherwise skip silently)

For every application whose `job.json` status is `sent`, `screening` or `interview`:
- **Replies.** Search Gmail for messages from the company since `sentAt` and record any clear reply with
  `node _engine/queue.mjs --reply <APP-id> interview|rejected|screening "<one-line summary>"`.
- **Follow-ups.** For each due follow-up (n 1 or 2, not done, not drafted), create a Gmail draft (never
  send), then run `node _engine/queue.mjs --drafted <APP-id> <n>`.
- Never send an email, never reply on the user's behalf, never archive or delete mail.

## Finish

Print one line per role handled: `APP-id | company | role | PASS/FAIL` or `screened <key> | verdict | reason`.

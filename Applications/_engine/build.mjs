// Builds one application package and refuses to mark it ready unless it is truthful,
// genuinely tailored and correctly formatted.
//
//   node _engine/build.mjs "<application folder>"
//
// Reads spec.json (CV edit ops + cover letter) and job.json, writes the CV and cover letter
// (DOCX + PDF, rendered from the master DOCX by Word), build-report.json, and updates job.json.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cleanText, lintProse } from './textclean.mjs';
import { atsKeywords, recruiterScore, parsePdf, humanWriting, firstPass } from './checks.mjs';
import { fullName, candidate } from './store.mjs';
const NAME = fullName(), CAND = candidate();

const ENGINE = import.meta.dirname;
const folder = resolve(process.argv[2] || '.');
const specPath = join(folder, 'spec.json'), jobPath = join(folder, 'job.json');
if (!existsSync(specPath) || !existsSync(jobPath)) { console.error(`spec.json and job.json are required in ${folder}`); process.exit(2); }

const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const job = JSON.parse(readFileSync(jobPath, 'utf8'));
const masterMap = readFileSync(join(ENGINE, 'master', 'paragraph-map.txt'), 'utf8');
const masterParas = masterMap.split(/\r?\n/).filter(Boolean).map((line) => line.slice(11).replace(/ <TAB> /g, '\t'));
const masterText = masterParas.join('\n');
// Paragraph number -> { kind, text, section } from the master map.
const master = new Map();
let section = 'HEADER';
for (const line of masterMap.split(/\r?\n/).filter(Boolean)) {
  const id = parseInt(line, 10), kind = line.slice(4, 10).trim(), text = line.slice(11).replace(/ <TAB> /g, '\t');
  if (kind === 'TEXT' && /^[A-Z][A-Z &]{3,}$/.test(text.trim())) section = text.trim();
  master.set(id, { kind, text, section });
}

const errors = [], warnings = [], checks = {};
const WORDS = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };
const numbers = (s) => new Set([...String(s).toLowerCase().matchAll(/\b(\d+(?:[.,]\d+)?%?|one|two|three|four|five|six|seven|eight|nine|ten)\b/g)].map((m) => WORDS[m[1]] || m[1]));
const masterNumbers = numbers(masterText);
const GUARDED = ['Bloomberg', 'Refinitiv', 'Eikon', 'FIX', 'C\\+\\+', 'Java', 'SQL', 'MATLAB', 'VBA', 'kdb', 'CFA', 'FRM', 'bonds?', 'fixed income', 'rates', 'credit', 'FX', 'swaps?', 'crypto\\w*', 'AUM', 'German', 'French', 'Dutch', 'Polish', 'Spanish', 'Mandarin', 'Japanese', 'Arabic', 'deployed', 'production', 'institutional', 'regulated', 'million', 'billion', '£', '\\$', '€'];
// A guarded term may appear only with a recorded reason, e.g. naming the role or stating a gap.
const allow = new Set((spec.allowTerms || []).map((t) => String(t.term || t).toLowerCase()));
for (const t of spec.allowTerms || []) if (!t.reason) errors.push(`allowTerms "${t.term || t}" needs a reason`);
const INFLATION = /\b(?:led|owned|headed|directed|deployed|ran|oversaw)\b/gi;

// 1. Layer A clean every string in the spec, and police it.
let removed = 0, replaced = 0;
const clean = (s) => { const r = cleanText(s); removed += r.removed; replaced += r.replaced; return r.text; };
for (const op of spec.cv.ops) if (typeof op.text === 'string') op.text = clean(op.text);
if (spec.coverLetter) {
  const cl = spec.coverLetter;
  cl.paragraphs = cl.paragraphs.map(clean);
  for (const k of ['date', 'greeting', 'signoff', 'subject']) if (cl[k]) cl[k] = clean(cl[k]);
  cl.recipient = (cl.recipient || []).map(clean);
}

function factCheck(label, text) {
  for (const n of numbers(text)) if (!masterNumbers.has(n)) errors.push(`${label}: number "${n}" is not in the master CV`);
  for (const term of GUARDED) {
    const re = new RegExp(`(?:^|[^A-Za-z])${term}(?:$|[^A-Za-z])`, term.length <= 4 ? '' : 'i');
    if (re.test(text) && !re.test(masterText) && !allow.has(term.replace(/\\/g, '').replace(/\?$/, '').toLowerCase())) errors.push(`${label}: "${term.replace(/\\/g, '')}" is not evidenced in the master CV`);
  }
  // Candidate-specific wording rules from candidate.json, e.g. a skill that must always carry a qualifier.
  for (const q of CAND.qualify) if (new RegExp(q.term, 'i').test(text) && !new RegExp(q.mustMatch, 'i').test(text)) errors.push(`${label}: ${q.message}`);
}

const cvTexts = spec.cv.ops.filter((op) => typeof op.text === 'string').map((op) => op.text);
cvTexts.forEach((t, i) => { factCheck(`CV edit ${i + 1}`, t); for (const f of lintProse(t)) errors.push(`CV edit ${i + 1}: ${f.code} ("${f.match}")`); });
// The master's "leading an 8-person team" is evidence for "Led an 8-person team".
const masterInflation = (masterText.replace(/\bleading\b/gi, 'led').match(INFLATION) || []).length;

// 2. It must actually be tailored: the profile and a real share of the bullets change.
const opsBy = (name) => spec.cv.ops.filter((op) => op.op === name);
const touched = new Set([...opsBy('replace'), ...opsBy('replaceAfter')].flatMap((op) => [].concat(op.p)));
const bulletIds = masterMap.split(/\r?\n/).filter((l) => l.includes(' BULLET ')).map((l) => parseInt(l, 10));
const bulletShare = bulletIds.filter((id) => touched.has(id)).length / bulletIds.length;
if (!touched.has(5)) errors.push('Profile (paragraph 5) was not rewritten for this role');
if (bulletShare < 0.3) errors.push(`Only ${Math.round(bulletShare * 100)}% of bullets were rewritten; at least 30% is required`);

// 2b. Nothing from the master is removed: every role, project, bullet and qualification stays.
//     Only blank spacer paragraphs may be deleted; space is made by tightening wording instead.
for (const op of opsBy('delete')) for (const id of [].concat(op.p)) {
  const m = master.get(Number(id));
  if (m && m.text.trim()) errors.push(`Deletes master content (${m.section}, paragraph ${id}: "${m.text.trim().slice(0, 60)}…"). Rewrite it shorter instead.`);
}
// Bullets keep their substance: no squashing into one-liners, and experience bullets follow Google XYZ
// ("accomplished X, as measured by Y, by doing Z"; when there is no metric, "accomplished X by doing Z").
const wordsOf = (t) => String(t).split(/\s+/).filter(Boolean).length;
for (const op of [...opsBy('replace'), ...opsBy('replaceAfter')]) {
  const m = master.get(Number(op.p)); if (!m) continue;
  const isBullet = m.kind === 'BULLET' || op.sep === '\t'; if (!isBullet) continue;
  const before = wordsOf(op.op === 'replaceAfter' ? m.text.slice(m.text.indexOf(op.sep) + 1) : m.text), after = wordsOf(op.text);
  const floor = before >= 20 ? 20 : Math.max(6, before - 2);
  if (after < floor) errors.push(`Paragraph ${op.p} is cut to ${after} words (master ${before}); keep at least ${floor} so it is not a one-liner`);
  if (m.section === 'WORK EXPERIENCE' && !/\b(by|through|using|via|after|while|across|to)\b/i.test(op.text)) errors.push(`Paragraph ${op.p} is not in XYZ form: say how it was achieved (by / through / using …)`);
}
// A rewrite may reword a paragraph but never lose one of its metrics.
for (const op of [...opsBy('replace'), ...opsBy('replaceAfter')]) {
  const m = master.get(Number(op.p)); if (!m) continue;
  const src = op.op === 'replaceAfter' ? m.text.slice(m.text.indexOf(op.sep) + 1) : m.text;
  const kept = numbers(op.text);
  for (const n of numbers(src)) if (!kept.has(n) && !/^(19|20)\d\d$/.test(n)) errors.push(`Paragraph ${op.p} loses the metric "${n}" from your master`);
}

// 3. Cover letter checks.
if (spec.coverLetter) {
  const body = spec.coverLetter.paragraphs.join('\n\n');
  const words = body.split(/\s+/).filter(Boolean).length;
  if (words < 200 || words > 430) errors.push(`Cover letter is ${words} words; keep it between 200 and 430`);
  if (!body.includes(job.company.split(' ')[0])) errors.push('Cover letter never names the company');
  factCheck('Cover letter', body);
  for (const f of lintProse(body)) errors.push(`Cover letter: ${f.code} ("${f.match}")`);
}

// 4. Render through Word, then verify the real output.
let render = null;
if (!errors.length) {
  spec.candidateName = NAME;
  spec.fileStem = `${NAME} CV - ${job.company}`.replace(/[\\/:*?"<>|]/g, '');
  spec.letterStem = `${NAME} Cover Letter - ${job.company}`.replace(/[\\/:*?"<>|]/g, '');
  const cleanedSpec = join(folder, '.spec.clean.json');
  writeFileSync(cleanedSpec, JSON.stringify(spec, null, 2));
  const ps = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(ENGINE, 'render.ps1'), '-Spec', cleanedSpec, '-OutDir', folder], { encoding: 'utf8', timeout: 240000 });
  const line = (ps.stdout || '').trim().split(/\r?\n/).filter((l) => l.startsWith('{')).pop();
  // Windows PowerShell 5.1 leaves tabs and some control characters unescaped in ConvertTo-Json.
  render = line ? JSON.parse(line.replace(/\t/g, '\\t').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ')) : { ok: false, error: ps.stderr || 'Word render produced no output' };
  if (!render.ok) errors.push(`Render failed: ${render.error}`);
  else {
    // Count pages in the exported PDF itself; Word's own page statistic can be stale.
    const pdfPages = (p) => (readFileSync(p, 'latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    render.cv.pages = pdfPages(render.cv.pdf);
    if (render.letter) render.letter.pages = pdfPages(render.letter.pdf);
    if (render.cv.pages > 2) errors.push(`CV renders to ${render.cv.pages} pages; trim to 2`);
    if (render.letter && render.letter.pages > 1) errors.push(`Cover letter renders to ${render.letter.pages} pages; trim to 1`);
    const out = render.cv.text;
    for (const n of numbers(out)) if (!masterNumbers.has(n)) errors.push(`Rendered CV contains number "${n}" that is not in the master`);
    const inflation = (out.match(INFLATION) || []).length;
    if (inflation > masterInflation) warnings.push(`Rendered CV uses ownership verbs ${inflation} times vs ${masterInflation} in the master: re-check for inflation`);
    for (const must of [NAME, ...CAND.headings, ...CAND.employers]) if (!out.includes(must)) errors.push(`Rendered CV is missing "${must}"`);
    writeFileSync(join(folder, 'CV text (as parsed).txt'), out);

    // 5. Computed scores and checks (no estimates): ATS coverage, recruiter evidence, parse, writing.
    const jd = existsSync(join(folder, 'JD.md')) ? readFileSync(join(folder, 'JD.md'), 'utf8') : '';
    checks.ats = atsKeywords(jd, masterText, out);
    if (checks.ats.atsAfter < checks.ats.atsBefore) errors.push(`Tailoring lowered ATS keyword coverage (${checks.ats.atsBefore} → ${checks.ats.atsAfter})`);
    for (const t of checks.ats.dropped) errors.push(`Drops "${t}", which your master CV evidences and the JD asks for`);
    checks.recruiter = recruiterScore(spec.analysis?.requirements);
    if (!checks.recruiter) errors.push('No requirement table (analysis.requirements), so the recruiter score cannot be computed');
    checks.parse = await parsePdf(render.cv.pdf, { name: NAME, employers: CAND.employers, headings: CAND.headings });
    for (const c of checks.parse.checks) if (!c.ok) errors.push(`ATS parse check failed: ${c.check}`);
    const bullets = [...opsBy('replace'), ...opsBy('replaceAfter')].filter((op) => master.get(Number(op.p))?.kind === 'BULLET' || op.sep === '\t').map((op) => op.text);
    checks.writing = humanWriting(bullets, spec.coverLetter?.paragraphs.join(' ') || '');
    // Human-sounding writing is required, not advised: any finding blocks Ready to apply.
    for (const f of checks.writing.flags) errors.push(`Writing: ${f}`);
    const monthsSinceLastRole = Math.max(0, Math.round((Date.now() - new Date('2025-10-31')) / (30.4 * 86400000)));
    checks.firstPass = firstPass({ cv: out, role: job.role, terms: checks.ats.terms, gapMonths: monthsSinceLastRole });
  }
}

// Every edit, as before → after, so it is always clear what tailoring changed.
const changes = spec.cv.ops.flatMap((op) => [].concat(op.p).map((id) => {
  const m = master.get(Number(id)) || {};
  if (op.op === 'delete') return { p: id, section: m.section, kind: 'removed blank line', before: '', after: '' };
  if (op.op === 'moveBefore') return { p: id, section: m.section, kind: 'moved', before: m.text, after: `moved above paragraph ${op.before}` };
  if (op.op === 'insertAfter') return { p: id, section: m.section, kind: 'added', before: '', after: op.text };
  return { p: id, section: m.section, kind: 'rewritten', before: op.op === 'replaceAfter' ? m.text.slice(m.text.indexOf(op.sep) + 1).trim() : m.text, after: op.text };
})).filter((c) => c.kind !== 'removed blank line');

const passed = errors.length === 0;
const report = { builtAt: new Date().toISOString(), passed, errors, warnings, layerA: { invisibleRemoved: removed, spacesNormalised: replaced }, bulletsRewrittenShare: Number(bulletShare.toFixed(2)), cv: render?.cv && { pdf: basename(render.cv.pdf), docx: basename(render.cv.docx), pages: render.cv.pages }, letter: render?.letter && { pdf: basename(render.letter.pdf), docx: basename(render.letter.docx), pages: render.letter.pages }, checks, changes };
writeFileSync(join(folder, 'build-report.json'), JSON.stringify(report, null, 2));

// The 56-point analysis travels with the spec; the scores are the computed ones, never the claimed ones.
if (spec.analysis) for (const k of ['priority', 'summary', 'gaps', 'openQuestions', 'requirements']) if (spec.analysis[k] !== undefined) job[k] = spec.analysis[k];
if (checks.recruiter && checks.ats) {
  const r = checks.recruiter;
  job.verdict = r.verdict;
  job.scores = { recruiter: r.score, atsBefore: checks.ats.atsBefore, atsAfter: checks.ats.atsAfter, firstPass: checks.firstPass.score,
    hardGates: r.gates ? `${r.gatesMet}/${r.gates} met${r.gatesPartial ? `, ${r.gatesPartial} partial` : ''}${r.gatesMissing ? `, ${r.gatesMissing} missing` : ''}` : 'none stated',
    computed: true };
  if (spec.analysis?.verdict && spec.analysis.verdict !== r.verdict) warnings.push(`Claimed verdict ${spec.analysis.verdict} differs from computed ${r.verdict}; computed is shown`);
}
if (passed) job.tailoredAt = report.builtAt;
// Only a real render replaces the documents; a failed pre-check keeps the last files on record.
if (report.cv) job.documents = { cv: report.cv, letter: report.letter || null };
job.build = { at: report.builtAt, passed, errors: errors.length, warnings: warnings.length };
// A package that no longer passes is not left in Ready to apply.
if (!passed && ['queued', 'tailoring', 'ready'].includes(job.status)) { job.status = 'draft'; (job.history ||= []).push({ status: 'draft', at: report.builtAt }); }
if (passed && ['queued', 'tailoring', 'draft', 'building', 'ready'].includes(job.status)) {
  if (job.status !== 'ready') (job.history ||= []).push({ status: 'ready', at: report.builtAt });
  job.status = 'ready';
}
writeFileSync(jobPath, JSON.stringify(job, null, 2));

console.log(`${passed ? 'PASS' : 'FAIL'}  ${job.id} ${job.company} - ${job.role}`);
for (const e of errors) console.log(`  x ${e}`);
for (const w of warnings) console.log(`  ! ${w}`);
if (report.cv) console.log(`  CV ${report.cv.pages} page(s)${report.letter ? `, letter ${report.letter.pages} page(s)` : ''}; Layer A removed ${removed}, normalised ${replaced}`);
process.exit(passed ? 0 : 1);

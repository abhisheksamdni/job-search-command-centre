// Deterministic checks behind every score the dashboard shows. Nothing here is an estimate:
// each number can be traced to the keyword table, the requirement table or the parsed PDF.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lintProse } from './textclean.mjs';

// ---------- ATS keyword coverage (56-point §40: exact 1.00, variant 0.95, synonym 0.75) ----------
// Terms an ATS or recruiter filter would search for in this field. [canonical, variants, synonyms]
const LEXICON = [
  ['trader', ['traders', 'trading'], []], ['trade execution', ['execution', 'executing trades', 'executed trades'], ['order execution']],
  ['liquidity', [], []], ['market making', ['market maker'], []], ['market microstructure', ['microstructure'], ['order book', 'order-book']],
  ['P&L', ['pnl', 'p&l'], ['profit and loss']], ['risk management', ['risk monitoring', 'manage risk', 'managing risk'], ['risk checks', 'risk limits']],
  ['risk limits', ['limits'], []], ['Greeks', ['delta', 'gamma', 'vega'], []], ['volatility', [], []], ['options', ['option'], []],
  ['futures', [], []], ['derivatives', ['derivative'], []], ['equities', ['equity'], ['stocks', 'shares', 'cash equities']],
  ['commodities', ['commodity'], []], ['energy', ['power', 'gas', 'lng'], []], ['crude oil', ['oil'], []], ['metals', ['gold', 'silver', 'base metals'], []],
  ['FX', ['foreign exchange', 'forex'], []], ['fixed income', ['bonds', 'bond', 'rates', 'credit'], []], ['ETF', ['etfs'], []],
  ['hedging', ['hedge'], []], ['arbitrage', [], []], ['portfolio management', ['portfolio'], ['managed portfolio']],
  ['investment', ['investments', 'investing'], []], ['fundamental analysis', ['fundamental research', 'fundamentals'], []],
  ['technical analysis', ['technical indicators', 'chart analysis'], []], ['market analysis', ['market research', 'monitor markets', 'monitoring markets'], ['market trends']],
  ['trade ideas', ['trading ideas', 'trade idea'], ['idea generation']], ['strategy development', ['trading strategies', 'trading strategy', 'strategy'], []],
  ['quantitative', ['quant', 'quantitative analysis'], ['numerical']], ['statistics', ['statistical'], []], ['backtesting', ['backtest'], []],
  ['algorithmic trading', ['algorithmic', 'algo trading'], []], ['systematic trading', ['systematic'], []], ['automation', ['automate', 'automated'], []],
  ['data analysis', ['analysing data', 'analyse data', 'large datasets', 'large data sets', 'structured datasets', 'datasets'], ['analytical']],
  ['machine learning', ['gradient boosting'], ['predictive model']], ['financial modelling', ['financial modeling', 'valuation', 'cash flow modelling'], []],
  ['Excel', ['microsoft excel'], []], ['PowerPoint', [], []], ['VBA', [], []], ['Python', [], []], ['SQL', [], []], ['C++', [], []], ['R', [], []],
  ['Bloomberg', [], []], ['Refinitiv', ['eikon'], []], ['FIX', [], []], ['AI tools', ['ai-assisted', 'claude code', 'artificial intelligence'], []],
  ['reconciliation', ['reconciled', 'reconcile', 'reconciling'], []], ['trade capture', ['trade booking', 'booking'], []], ['settlement', ['settlements'], []],
  ['trade support', ['trading support', 'desk support'], ['supported trading desk']], ['middle office', [], []], ['operations', ['operational'], []],
  ['compliance', ['regulatory', 'regulation'], []], ['client relationships', ['clients', 'client'], ['customer']], ['stakeholder management', ['stakeholders'], []],
  ['brokers', ['broker', 'counterparties', 'counterparty'], []], ['communication', ['communicating', 'communicate'], []],
  ['market commentary', ['commentary', 'market updates', 'client updates'], []], ['reporting', ['reports', 'report'], ['summaries']],
  ['attention to detail', ['detail-oriented', 'accuracy', 'accurate'], []], ['problem solving', ['problem-solving', 'resolve', 'resolution'], []],
  ['negotiation', ['negotiate', 'negotiations'], []], ['mentoring', ['mentored', 'mentor'], []], ['leadership', ['led', 'leading', 'team leadership'], []],
  ['teamwork', ['collaborate', 'collaboration', 'collaborated', 'collaborating', 'collaborative', 'team player'], []], ['pressure', ['high-pressure', 'fast-paced', 'time-sensitive'], []],
  ['CISI', ['investment advice diploma'], []], ['CFA', [], []], ['FRM', [], []], ['degree', ["bachelor's", 'bachelor', 'msc', "master's", 'masters'], []],
  ['finance', ['financial markets', 'financial'], []], ['mathematics', ['maths', 'math'], []], ['economics', ['macroeconomic', 'microeconomic'], []],
  ['engineering', ['engineer'], []], ['proprietary trading', ['prop trading', 'proprietary'], []], ['hedge fund', ['buy-side', 'buy side'], []],
  ['pricing', ['price', 'pricing models'], []], ['structuring', [], []], ['OTC', ['over-the-counter'], []], ['exchange-traded', ['listed', 'exchange traded'], []],
  // Sales, coverage and business-development roles (sales trading, derivatives sales, client coverage).
  ['sales', ['sales trading', 'selling'], []], ['business development', ['biz dev'], []], ['CRM', ['salesforce', 'hubspot'], []],
  ['pipeline', ['pipeline management'], []], ['KPIs', ['kpi', 'key performance indicators'], ['metrics']], ['revenue targets', ['revenue', 'volume targets', 'targets'], []],
  ['outbound', ['prospecting', 'lead generation', 'sourcing'], []], ['account management', ['coverage', 'book of clients', 'client book'], []],
  ['perpetual futures', ['perpetuals', 'perps', 'perpetual'], []], ['dashboards', ['dashboard', 'tableau', 'power bi'], []],
  ['onboarding', ['onboard'], []], ['institutional clients', ['institutional'], []], ['market making', ['liquidity provider'], []],
];
const SOFT = new Set(['pressure', 'teamwork', 'communication', 'attention to detail', 'problem solving', 'finance', 'degree', 'leadership', 'reporting', 'operations', 'client relationships', 'investment', 'trader', 'engineering', 'mathematics', 'economics']);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Short all-caps terms (R, FIX, SQL…) are matched case-sensitively, so "for" never counts as "FIX".
const rx = (term) => new RegExp(`(?<![A-Za-z0-9])${esc(term)}(?![A-Za-z0-9])`, /^[A-Z+&]{1,4}$/.test(term) ? '' : 'i');
const count = (text, term) => (String(text).match(new RegExp(rx(term).source, rx(term).flags + 'g')) || []).length;
function state(text, [canon, variants, synonyms]) {
  if (count(text, canon)) return { level: 'EXACT', L: 1 };
  if (variants.some((v) => count(text, v))) return { level: 'VARIANT', L: 0.95 };
  if (synonyms.some((v) => count(text, v))) return { level: 'SYNONYM', L: 0.75 };
  return { level: 'MISSING', L: 0 };
}

// JD noise (56-point §1, §21): drop marketing, benefits and EEO paragraphs before extracting terms.
const NOISE = /\b(benefits?|we offer|perks|salary|bonus|vacation|holiday|pension|equal opportunit|diversity|inclusion|about us|our culture|who we are|why join|wellbeing|well-being)\b/i;
export function jdRequirementsText(jd) {
  return String(jd).split(/\n{2,}/).filter((block) => !NOISE.test(block.slice(0, 120))).join('\n\n');
}

export function atsKeywords(jd, before, after) {
  const body = jdRequirementsText(jd);
  const terms = [];
  for (const entry of LEXICON) {
    const n = count(body, entry[0]) + entry[1].reduce((s, v) => s + count(body, v), 0);
    if (!n) continue;
    // "R" is the language only when listed with other languages, never a stray letter.
    if (entry[0] === 'R' && !/(python|sql|matlab|stata|vba|c\+\+)[^.\n]{0,40}\bR\b|\bR\b[^.\n]{0,40}(python|sql|matlab|stata)/i.test(body)) continue;
    // Weight: how often the JD uses it (capped at 3). Behavioural and generic terms are weak
    // differentiators (56-point §4), so they never weigh more than 1.
    const weight = SOFT.has(entry[0]) ? 1 : Math.min(3, n);
    const b = state(before, entry), a = state(after, entry);
    terms.push({ term: entry[0], weight, inJd: n, before: b.level, after: a.level, Lb: b.L, La: a.L });
  }
  const W = terms.reduce((s, t) => s + t.weight, 0) || 1;
  const score = (k) => Math.round((100 * terms.reduce((s, t) => s + t.weight * t[k], 0)) / W);
  return { terms: terms.sort((x, y) => y.weight - x.weight || x.term.localeCompare(y.term)), atsBefore: score('Lb'), atsAfter: score('La'),
    missing: terms.filter((t) => t.after === 'MISSING').map((t) => t.term), dropped: terms.filter((t) => t.before !== 'MISSING' && t.after === 'MISSING').map((t) => t.term) };
}

// ---------- Recruiter evidence score (56-point §37-39, §44) ----------
const E = { EXACT: 1, STRONG: 0.85, PARTIAL: 0.65, ADJACENT: 0.4, WEAK: 0.4, SKILLS_ONLY: 0.2, NONE: 0 };
const Q = { recent: 1, older: 0.9, adjacent: 0.75, project: 0.7, academic: 0.6, certification: 0.5, skills: 0.35 };
export function recruiterScore(reqs = []) {
  const rows = reqs.filter((r) => Number(r.weight) > 0);
  if (!rows.length) return null;
  const W = rows.reduce((s, r) => s + Number(r.weight), 0);
  const contrib = rows.map((r) => ({ ...r, E: E[r.match] ?? 0, Q: Q[r.quality] ?? (r.match === 'NONE' ? 0 : 0.9) }));
  let score = Math.round((100 * contrib.reduce((s, r) => s + r.weight * r.E * r.Q, 0)) / W);
  const gates = rows.filter((r) => r.gate), missing = gates.filter((r) => r.match === 'NONE'), partial = gates.filter((r) => ['PARTIAL', 'ADJACENT', 'WEAK'].includes(r.match));
  const cap = missing.length >= 2 ? 50 : missing.length === 1 ? 65 : null;
  const capped = cap !== null && score > cap;
  if (capped) score = cap;
  const verdict = score >= 80 && !missing.length ? 'STRONG MATCH' : score >= 65 && !missing.length ? 'GOOD MATCH' : score >= 50 ? 'STRETCH' : 'WEAK MATCH';
  return { score, verdict, cap, capped, gates: gates.length, gatesMet: gates.length - missing.length - partial.length, gatesPartial: partial.length, gatesMissing: missing.length, rows: contrib };
}

// ---------- ATS parse check: read the exported PDF back the way an ATS would ----------
export async function parsePdf(pdfPath, { name = 'Candidate', employers = [], headings = [] } = {}) {
  const { PDFParse } = await import(pathToFileURL(join(import.meta.dirname, '..', '..', 'discovery-engine', 'node_modules', 'pdf-parse', 'dist', 'pdf-parse', 'esm', 'index.js')).href).catch(() => import('pdf-parse'));
  const parser = new PDFParse({ data: readFileSync(pdfPath) });
  const text = (await parser.getText())?.text || '';
  await parser.destroy?.();
  const checks = [
    ['Text is machine-readable', text.replace(/\s/g, '').length > 1500],
    ['Name found', text.includes(name)],
    ['Email found', /[\w.+-]+@[\w-]+\.[\w.]+/.test(text)],
    ['Phone found', /\+?\d[\d\s]{9,}/.test(text)],
    ['Dates are parseable', (text.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December)[a-z]*\s+\d{4}\b/g) || []).length >= 6],
    ['Every employer found', employers.every((e) => text.includes(e))],
    ['Standard headings, in order', headings.every((h, i) => text.indexOf(h) >= 0 && (i === 0 || text.indexOf(h) > text.indexOf(headings[i - 1])))],
    ['No broken characters', !/�/.test(text)],
  ].map(([check, ok]) => ({ check, ok }));
  return { ok: checks.every((c) => c.ok), checks, chars: text.length };
}

// ---------- Human-writing check ----------
export function humanWriting(bullets = [], letter = '') {
  const flags = [];
  for (const t of [...bullets, letter]) for (const f of lintProse(t)) flags.push(`${f.code}: “${f.match}”`);
  const openers = bullets.map((b) => (b.match(/^[A-Za-z]+/) || [''])[0].toLowerCase()).filter(Boolean);
  const top = Object.entries(openers.reduce((m, w) => ((m[w] = (m[w] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 4 && top[1] / openers.length > 0.25) flags.push(`repetitive openers: ${top[1]} bullets start with “${top[0]}”`);
  // Redundancy (56-point §27): the same 4-word phrase in two different bullets wastes CV space.
  const grams = new Map();
  bullets.forEach((b, i) => { const w = b.toLowerCase().replace(/[^a-z0-9& ]/g, ' ').split(/\s+/).filter(Boolean); for (let k = 0; k + 4 <= w.length; k++) { const g = w.slice(k, k + 4).join(' '); if (!/^(and|the|of|to|in|with|for|a)\b/.test(g)) { const s = grams.get(g) || new Set(); s.add(i); grams.set(g, s); } } });
  for (const [g, s] of grams) if (s.size > 1) flags.push(`repeated phrase in ${s.size} bullets: “${g}”`);
  const sentences = letter.split(/(?<=[.!?])\s+/).filter((s) => s.length > 3);
  const lens = sentences.map((s) => s.split(/\s+/).length), avg = lens.reduce((a, b) => a + b, 0) / (lens.length || 1);
  const spread = Math.sqrt(lens.reduce((s, l) => s + (l - avg) ** 2, 0) / (lens.length || 1));
  if (letter && spread < 4) flags.push('letter sentences are all a similar length (reads mechanical)');
  if (letter && avg > 30) flags.push(`letter sentences average ${Math.round(avg)} words (too long)`);
  return { ok: flags.length === 0, flags: [...new Set(flags)], letterSentences: sentences.length, avgSentenceWords: Math.round(avg) };
}

// ---------- First-pass recruiter signal (56-point §45-46), five dimensions × 20 ----------
export function firstPass({ cv, role, terms, gapMonths }) {
  const top = cv.slice(0, Math.floor(cv.length / 3)), heavy = terms.filter((t) => t.weight >= 2);
  const roleWords = String(role).toLowerCase().match(/[a-z]{4,}/g) || [];
  const identity = Math.round(20 * Math.min(1, roleWords.filter((w) => top.toLowerCase().includes(w)).length / Math.max(1, Math.min(2, roleWords.length))));
  const visibility = Math.round(20 * (heavy.length ? heavy.filter((t) => state(top, LEXICON.find((e) => e[0] === t.term)).L > 0).length / heavy.length : 1));
  const density = Math.round(20 * (terms.length ? terms.filter((t) => state(top, LEXICON.find((e) => e[0] === t.term)).L > 0).length / terms.length : 1));
  const credibility = 20;
  const risk = gapMonths >= 12 ? 8 : gapMonths >= 6 ? 14 : 20;
  return { score: identity + visibility + density + credibility + risk, parts: { identity, visibility, credibility, density, risk } };
}

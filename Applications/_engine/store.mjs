// Shared access to the application folders, the JCC database (read-only) and autopilot settings.
// Used by the dashboard server, the autopilot and the queue CLI that headless Claude runs.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, basename } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const ENGINE = import.meta.dirname;
export const APPS = resolve(ENGINE, '..');
export const ROOT = resolve(APPS, '..');
export const JCC_DIR = join(ROOT, 'discovery-engine');
export const JCC_DB = join(ROOT, 'JCC-Data', 'database', 'jcc.sqlite');
export const JCC_URL = 'http://127.0.0.1:8787';
export const INBOX = join(ENGINE, 'inbox');
export const STATUSES = ['queued', 'tailoring', 'draft', 'ready', 'sent', 'screening', 'interview', 'offer', 'accepted', 'rejected', 'declined', 'withdrawn'];

const readJson = (p, fallback) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; } };
const writeJson = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2));

// ---------- settings ----------
const SETTINGS = join(ENGINE, 'settings.json');
// No caps on how many roles are screened or tailored per Search (user's choice, 29 Oct 2026).
export const DEFAULT_SETTINGS = { autopilot: false, applyMode: 'manual', windowHours: 96, minVerdict: 'STRETCH', tailorOnQueue: true };
export const settings = () => ({ ...DEFAULT_SETTINGS, ...readJson(SETTINGS, {}) });
export const saveSettings = (patch) => { const s = { ...settings(), ...patch }; writeJson(SETTINGS, s); return s; };

// ---------- screening decisions (so nothing is screened twice) ----------
const SCREENED = join(ENGINE, 'screened.json');
export const screened = () => readJson(SCREENED, {});
// key is a JCC job id, or "indeed:<id>" for roles found through the Indeed connector.
export function recordScreen(key, verdict, reason, meta = {}) {
  const all = screened();
  const job = /^\d+$/.test(String(key)) ? jccJob(key) : null;
  all[key] = { verdict, reason, at: new Date().toISOString(), title: job?.title || meta.title || null, company: job?.company || meta.company || null, source: job ? 'JCC' : meta.source || 'Indeed' };
  writeJson(SCREENED, all);
  return all[key];
}
export const seenExternal = (key) => Boolean(screened()[key]) || apps().some((a) => a.externalKey === key);

// ---------- application folders ----------
export function appFolders() {
  return readdirSync(APPS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^APP-\d+/.test(d.name) && existsSync(join(APPS, d.name, 'job.json')))
    .map((d) => join(APPS, d.name));
}
export function loadApp(folder) {
  const job = readJson(join(folder, 'job.json'), null);
  job.folder = basename(folder);
  job.files = readdirSync(folder).filter((f) => /\.(pdf|docx|md|txt)$/i.test(f) && !f.startsWith('.'));
  const report = join(folder, 'build-report.json');
  if (existsSync(report)) job.buildReport = readJson(report, null);
  return job;
}
export const apps = () => appFolders().map(loadApp).sort((a, b) => a.id.localeCompare(b.id));
export function findApp(id) {
  const folder = appFolders().find((f) => basename(f).startsWith(`${id} `) || basename(f) === id);
  if (!folder) throw Object.assign(new Error(`No application ${id}`), { code: 404 });
  return folder;
}
export function saveApp(folder, job) {
  const { folder: _f, files: _x, buildReport: _r, ...clean } = job;
  writeJson(join(folder, 'job.json'), clean);
}
export function updateApp(id, fn) {
  const folder = findApp(id), job = readJson(join(folder, 'job.json'), null);
  fn(job); saveApp(folder, job); return loadApp(folder);
}
const nextId = () => `APP-${String(Math.max(0, ...appFolders().map((f) => parseInt(basename(f).slice(4), 10) || 0)) + 1).padStart(3, '0')}`;
// ASCII-only folder names: Windows PowerShell 5.1 mangles characters such as en dashes in arguments.
export const safeName = (s) => String(s || '').normalize('NFKD').replace(/[–—]/g, '-').replace(/[^\x20-\x7e]/g, '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 70);

function createApp({ company, role, location, url, source, jccJobId = null, postedAt = null, foundAt = null, jd }) {
  const id = nextId();
  const folder = join(APPS, `${id} ${safeName(company)} - ${safeName(role)}`);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'JD.md'), `# ${role}\n\n${company} · ${location || ''}\n\nPosting: ${url || '(none)'}\n\n${jd || '(No description. Paste it here before tailoring.)'}\n`);
  const now = new Date().toISOString();
  saveApp(folder, { id, company, role, location: location || '', url: url || '', source, jccJobId, postedAt, foundAt: foundAt || now, status: 'queued', verdict: null, priority: null, scores: {}, summary: 'Waiting for 56-point analysis and tailoring.', gaps: [], history: [{ status: 'queued', at: now }], sentAt: null, followUps: [], interviews: [], contacts: [], notes: '' });
  return loadApp(folder);
}

// ---------- JCC (read-only) ----------
let db = null;
export function jcc() {
  if (db) return db;
  if (!existsSync(JCC_DB)) return null;
  try { db = new DatabaseSync(JCC_DB, { readOnly: true }); } catch { db = null; }
  return db;
}
export const decode = (s = '') => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d));
export const stripHtml = (s = '') => decode(decode(s)).replace(/<\s*(br|\/p|\/li|\/h\d)\s*\/?>/gi, '\n').replace(/<li[^>]*>/gi, '- ').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();

export function jccJob(jobId) {
  const d = jcc(); if (!d) return null;
  const j = d.prepare('SELECT * FROM jobs WHERE id=?').get(Number(jobId));
  if (!j) return null;
  const jd = d.prepare('SELECT jd_raw, jd_clean FROM job_jd_versions WHERE job_id=? ORDER BY id DESC LIMIT 1').get(j.id);
  return {
    id: j.id, title: decode(j.title), company: decode(j.company), location: decode(j.location_raw || ''),
    url: decode(j.application_url || j.canonical_job_url || j.source_url || ''),
    posted: j.employer_published_at || j.source_published_at || j.posted_at || null, seen: j.first_seen_at, status: j.status,
    jd: stripHtml(jd?.jd_clean || jd?.jd_raw || ''),
  };
}
export function queueFromJcc(jobId) {
  const existing = apps().find((a) => a.jccJobId === Number(jobId));
  if (existing) return existing;
  const j = jccJob(jobId);
  if (!j) throw Object.assign(new Error(`JCC job ${jobId} not found`), { code: 404 });
  // The same role found twice (e.g. two LinkedIn listings) is tailored once.
  const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const dup = apps().find((a) => norm(a.company) === norm(j.company) && norm(a.role) === norm(j.title) && norm(a.location).split(' ')[0] === norm(j.location).split(' ')[0]);
  if (dup) return dup;
  return createApp({ company: j.company, role: j.title, location: j.location, url: j.url, source: 'JCC', jccJobId: j.id, postedAt: j.posted, foundAt: j.seen, jd: j.jd });
}
export function queueManual({ company, role, location, url, jd, source = 'Manual', externalKey = null, postedAt = null }) {
  if (!company || !role) throw Object.assign(new Error('Company and role are required'), { code: 400 });
  if (!jd || jd.trim().length < 200) throw Object.assign(new Error('Paste the full job description (at least a few paragraphs)'), { code: 400 });
  if (externalKey) { const dup = apps().find((a) => a.externalKey === externalKey); if (dup) return dup; }
  // Same role already in the pipeline from another board (e.g. LinkedIn): don't tailor it twice.
  const same = apps().find((a) => a.company.toLowerCase() === company.trim().toLowerCase() && a.role.toLowerCase() === role.trim().toLowerCase());
  if (same) return same;
  const app = createApp({ company: company.trim(), role: role.trim(), location: (location || '').trim(), url: (url || '').trim(), source, postedAt, jd: jd.trim() });
  if (externalKey) updateApp(app.id, (j) => { j.externalKey = externalKey; });
  return loadApp(findApp(app.id));
}

export function discovery() {
  const d = jcc();
  if (!d) return { available: false, jobs: [], sources: [], lastRun: null };
  const byJcc = new Map(apps().filter((a) => a.jccJobId).map((a) => [a.jccJobId, a.id]));
  const scr = screened();
  const jobs = d.prepare(`
    SELECT j.id, j.title, j.company, j.location_raw AS location, j.remote, j.status, s.name AS source,
           COALESCE(j.application_url, j.canonical_job_url, j.source_url) AS url,
           COALESCE(j.employer_published_at, j.source_published_at, j.posted_at) AS posted, j.first_seen_at AS seen
    FROM jobs j LEFT JOIN sources s ON s.id=j.source_id
    WHERE j.status != 'ARCHIVED'
    ORDER BY COALESCE(j.employer_published_at, j.source_published_at, j.posted_at, j.first_seen_at) DESC
    LIMIT 400`).all().map((j) => ({ ...j, title: decode(j.title), company: decode(j.company), url: decode(j.url || ''), appId: byJcc.get(j.id) || null, screen: scr[j.id] || null }));
  const sources = d.prepare('SELECT id, name, kind, base_url, enabled, health, last_success, last_error, jobs_found, ownership FROM sources ORDER BY id').all();
  const roles = d.prepare('SELECT id, family, phrase, enabled FROM target_roles ORDER BY family, phrase').all();
  const locations = d.prepare('SELECT id, country, city, region, enabled FROM target_locations ORDER BY country, city').all();
  const lastRun = d.prepare('SELECT id, mode, status, started_at, finished_at FROM discovery_runs ORDER BY id DESC LIMIT 1').get() || null;
  const set = Object.fromEntries(d.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
  return { available: true, jobs, sources, roles, locations, lastRun, mode: set.mode || 'MANUAL', windowHours: settings().windowHours };
}

// ---------- status changes (shared by the dashboard and the auto-apply engine) ----------
const DAY = 86400000;
export function setStatus(id, status, extra = {}) {
  if (!STATUSES.includes(status)) throw Object.assign(new Error(`Unknown status ${status}`), { code: 400 });
  const folder = findApp(id);
  return updateApp(id, (job) => {
    const now = new Date();
    if (status === 'sent' && !job.sentAt) {
      if (!job.documents?.cv) throw Object.assign(new Error('Build the CV before marking this as sent'), { code: 400 });
      job.sentAt = (extra.sentAt ? new Date(extra.sentAt) : now).toISOString();
      const base = new Date(job.sentAt).getTime();
      job.followUps = [
        { n: 1, kind: 'First follow-up', due: new Date(base + 7 * DAY).toISOString(), done: false },
        { n: 2, kind: 'Second follow-up', due: new Date(base + 14 * DAY).toISOString(), done: false },
        { n: 3, kind: 'Close as no reply', due: new Date(base + 30 * DAY).toISOString(), done: false },
      ];
      // Freeze exactly what was sent, with hashes (JCC immutable-archive rule).
      const sub = join(folder, 'submitted'); mkdirSync(sub, { recursive: true });
      job.submitted = [];
      for (const doc of [job.documents.cv, job.documents.letter].filter(Boolean)) for (const name of [doc.pdf, doc.docx]) {
        if (!name || !existsSync(join(folder, name))) continue;
        copyFileSync(join(folder, name), join(sub, name));
        job.submitted.push({ file: `submitted/${name}`, sha256: createHash('sha256').update(readFileSync(join(sub, name))).digest('hex') });
      }
    }
    if (['screening', 'interview', 'offer', 'accepted', 'rejected', 'declined', 'withdrawn'].includes(status))
      for (const f of job.followUps || []) if (!f.done) f.done = 'superseded';
    job.status = status;
    (job.history ||= []).push({ status, at: now.toISOString(), ...(extra.note ? { note: extra.note } : {}) });
  });
}

// ---------- profile: the user's own answers for application forms ----------
const PROFILE = join(ENGINE, 'profile.json');
// profile.json is private (git-ignored); profile.example.json lets a fresh copy run with demo data.
export const profile = () => readJson(PROFILE, null) || readJson(join(ENGINE, 'profile.example.json'), {});
export const fullName = () => { const p = profile(); return [p.firstName, p.lastName].filter(Boolean).join(' ') || 'Candidate'; };
// candidate.json: the master CV's employers, section headings and wording rules used by the build checks.
export const candidate = () => ({ employers: [], headings: ['WORK EXPERIENCE', 'EDUCATION', 'SKILLS'], qualify: [],
  ...(readJson(join(ENGINE, 'candidate.json'), null) || readJson(join(ENGINE, 'candidate.example.json'), {})) });
export const saveProfile = (p) => { writeJson(PROFILE, p); return p; };

// ---------- delete and override ----------
// Deleting an application moves its folder to Applications/_deleted (recoverable), never erases it.
export function deleteApp(id) {
  const folder = findApp(id), name = basename(folder), bin = join(APPS, '_deleted');
  mkdirSync(bin, { recursive: true });
  const target = join(bin, `${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')} ${name}`);
  renameSync(folder, target);
  return { deleted: id, movedTo: target };
}
export function forgetScreen(key) {
  const all = screened(); const had = all[key]; delete all[key]; writeJson(SCREENED, all); return had || null;
}
// Override: tailor a role the screening ruled out. It is queued with the override recorded on the card.
export function tailorAnyway(key) {
  const k = String(key);
  let app;
  if (/^\d+$/.test(k)) app = queueFromJcc(Number(k));
  else {
    const file = join(ENGINE, 'indeed-archive', `${k.replace(':', '-')}.md`);
    if (!existsSync(file)) throw Object.assign(new Error('The saved description for this Indeed role is gone; add it with + Add job instead'), { code: 404 });
    app = queueFromFile(file);
  }
  const prior = forgetScreen(k);
  return updateApp(app.id, (j) => { j.override = { at: new Date().toISOString(), what: 'Tailor despite screening', priorVerdict: prior?.verdict || null, priorReason: prior?.reason || null }; if (prior?.verdict) j.screenVerdict = prior.verdict; });
}
// Parse a saved role file (key/title/company/location/url/posted headers, blank line, then the JD) and queue it.
export function queueFromFile(path) {
  const raw = readFileSync(path, 'utf8'), [head, ...body] = raw.split(/\r?\n\r?\n/);
  const h = Object.fromEntries(head.split(/\r?\n/).map((l) => l.match(/^(\w+):\s*(.*)$/)).filter(Boolean).map((m) => [m[1].toLowerCase(), m[2].trim()]));
  return queueManual({ company: h.company, role: h.title, location: h.location, url: h.url, postedAt: h.posted || null, jd: body.join('\n\n'), source: h.key?.startsWith('indeed:') ? 'Indeed' : 'Manual', externalKey: h.key || null });
}

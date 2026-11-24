// Job Command Centre: one local dashboard over JCC discovery (read-only database + JCC API) and the
// application pipeline in the Applications folders, with the autopilot that screens and tailors.
//
//   node --no-warnings _engine/server.mjs      ->  http://127.0.0.1:8790
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { ENGINE, APPS, JCC_URL, STATUSES, apps, findApp, loadApp, updateApp, discovery, jccJob, screened, queueFromJcc, queueManual, settings, setStatus, profile, saveProfile, deleteApp, forgetScreen, tailorAnyway } from './store.mjs';
import { applyRoute } from './apply.mjs';
import { spawnSync } from 'node:child_process';
import * as autopilot from './autopilot.mjs';

const PORT = Number(process.env.PORT || 8790);
const DAY = 86400000;
const FUNNEL = ['sent', 'screening', 'interview', 'offer', 'accepted'];
async function jccHealth() {
  try { const r = await fetch(`${JCC_URL}/api/health`, { signal: AbortSignal.timeout(1200) }); return r.ok ? { running: true, ...(await r.json()) } : { running: false }; } catch { return { running: false }; }
}
async function jccCall(method, path, payload) {
  let r;
  try { r = await fetch(`${JCC_URL}${path}`, { method, headers: { 'content-type': 'application/json' }, body: payload ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(20000) }); }
  catch {
    // JCC is the engine behind this dashboard: start it on demand, then retry once.
    autopilot.startJcc();
    for (let i = 0; i < 20 && !(await jccHealth()).running; i++) await new Promise((r) => setTimeout(r, 1000));
    try { r = await fetch(`${JCC_URL}${path}`, { method, headers: { 'content-type': 'application/json' }, body: payload ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(20000) }); }
    catch { throw Object.assign(new Error('The search engine (JCC) did not start. See JCC-Data/Logs/server.log'), { code: 503 }); }
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `JCC HTTP ${r.status}`), { code: r.status });
  return j;
}

function figures(list) {
  const now = Date.now();
  const reached = (a, stage) => {
    const seen = new Set((a.history || []).map((h) => h.status)); seen.add(a.status);
    return FUNNEL.slice(FUNNEL.indexOf(stage)).some((s) => seen.has(s)) || (stage === 'sent' && Boolean(a.sentAt));
  };
  const funnel = FUNNEL.map((stage, i) => {
    const count = list.filter((a) => reached(a, stage)).length, prev = i ? list.filter((a) => reached(a, FUNNEL[i - 1])).length : 0;
    return { stage, count, conversion: i && prev ? Math.round((count / prev) * 100) : null };
  });
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, list.filter((a) => a.status === s).length]));
  const weeks = [];
  for (let w = 11; w >= 0; w--) { const end = now - w * 7 * DAY, start = end - 7 * DAY; weeks.push({ start: new Date(start).toISOString(), sent: list.filter((a) => a.sentAt && +new Date(a.sentAt) > start && +new Date(a.sentAt) <= end).length }); }
  const attention = [], events = [];
  for (const a of list) {
    const label = `${a.company}, ${a.role}`;
    if (a.status === 'ready') attention.push({ id: a.id, label, status: a.status, reason: `Package passed every check. ${a.verdict || ''}`.trim(), action: 'Apply', rank: 1 });
    if (a.status === 'offer') attention.push({ id: a.id, label, status: a.status, reason: 'An offer is waiting for your answer.', action: 'Review', rank: 0 });
    for (const i of a.interviews || []) {
      events.push({ at: i.at, kind: 'interview', label: `${i.stage || 'Interview'}: ${a.company}`, id: a.id });
      if (+new Date(i.at) > now && +new Date(i.at) - now < 7 * DAY) attention.push({ id: a.id, label, status: 'interview', reason: `${i.stage || 'Interview'} on ${new Date(i.at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`, action: 'Prepare', rank: 0, soon: true });
    }
    for (const f of a.followUps || []) if (!f.done) events.push({ at: f.due, kind: 'followup', label: `${f.kind}: ${a.company}`, id: a.id });
    const due = (a.followUps || []).find((f) => !f.done && +new Date(f.due) <= now);
    if (due) attention.push({ id: a.id, label, status: a.status, reason: `${due.kind} due: sent ${Math.round((now - +new Date(a.sentAt)) / DAY)} days ago with no reply.`, action: 'Follow up', rank: 2 });
    if (a.status === 'draft') attention.push({ id: a.id, label, status: a.status, reason: a.build && !a.build.passed ? `Build failed with ${a.build.errors} issue(s).` : 'Tailoring stopped before it passed the checks.', action: 'Fix', rank: 3 });
  }
  attention.sort((x, y) => x.rank - y.rank);
  const sent = funnel[0].count, heard = funnel[1].count;
  return { funnel, byStatus, weeks, attention, events, sent, heardBack: heard, heardBackPercent: sent ? Math.round((heard / sent) * 100) : null, reachedInterview: funnel[2].count, followUpsDue: list.reduce((n, a) => n + (a.followUps || []).filter((f) => !f.done && +new Date(f.due) <= now).length, 0), interviews: list.reduce((n, a) => n + (a.interviews || []).filter((i) => +new Date(i.at) > now).length, 0) };
}

// Insights: what the market asks for (from recent job descriptions) against what the master CV evidences.
// "have" is computed: yes when the master CV mentions the skill, otherwise no (a gap to review).
const SKILLS = [
  ['Python', /\bpython\b/i, 'partial'], ['SQL', /\bsql\b/i, 'no'], ['C++', /c\+\+/i, 'no'], ['VBA', /\bvba\b/i, 'no'],
  ['Excel', /\bexcel\b/i, 'yes'], ['Bloomberg / Refinitiv', /\bbloomberg\b|refinitiv|eikon/i, 'no'],
  ['Options', /\boptions?\b(?! to)/i, 'yes'], ['Futures', /\bfutures\b/i, 'yes'], ['Equities', /\bequit(?:y|ies)\b/i, 'yes'],
  ['Commodities', /\bcommodit/i, 'yes'], ['Power / gas / energy', /\bpower\b|\bgas\b|\benergy\b|\blng\b/i, 'no'],
  ['Fixed income / bonds', /fixed income|\bbonds?\b|\brates\b|\bcredit\b/i, 'no'], ['FX', /\bfx\b|foreign exchange/i, 'no'],
  ['Crypto / digital assets', /crypto|digital asset|defi/i, 'no'], ['Risk management', /risk manage|risk limit|risk monitor/i, 'yes'],
  ['Execution', /\bexecut/i, 'yes'], ['Market making', /market[- ]mak/i, 'no'], ['Statistics / quant modelling', /statistic|quantitative model|stochastic|econometric/i, 'partial'],
  ['Machine learning', /machine learning|\bml\b/i, 'partial'], ['P&L ownership track record', /track record|p&l of|pnl >|\$\d+m/i, 'no'],
  ['Second language required', /\b(?:german|french|dutch|mandarin|cantonese|polish|spanish|italian|japanese|arabic)\b/i, 'no'],
];
let insightsCache = { at: 0, data: null };
function insights() {
  if (Date.now() - insightsCache.at < 10 * 60000 && insightsCache.data) return insightsCache.data;
  const d = discovery(), since = Date.now() - 30 * DAY;
  const recent = d.jobs.filter((j) => +new Date(String(j.posted || j.seen).replace(' ', 'T')) >= since);
  const texts = recent.map((j) => { const x = jccJob(j.id); return `${x?.title || ''}\n${x?.jd || ''}`; }).filter((t) => t.length > 300);
  let masterText = ''; try { masterText = readFileSync(join(ENGINE, 'master', 'paragraph-map.txt'), 'utf8'); } catch {}
  const skills = SKILLS.map(([name, re]) => ({ name, have: re.test(masterText) ? 'yes' : 'no', count: texts.filter((t) => re.test(t)).length })).filter((s) => s.count).sort((a, b) => b.count - a.count);
  const country = (loc = '') => /london|united kingdom|england/i.test(loc) ? 'United Kingdom' : /netherlands|amsterdam/i.test(loc) ? 'Netherlands' : /switzerland|geneva|zurich|baden/i.test(loc) ? 'Switzerland' : /dubai|abu dhabi|emirates/i.test(loc) ? 'UAE' : /ireland|dublin/i.test(loc) ? 'Ireland' : /poland|warsaw/i.test(loc) ? 'Poland' : /norway|oslo/i.test(loc) ? 'Norway' : /, ma\b|boston/i.test(loc) ? 'United States' : 'Other';
  const by = (arr, f) => Object.entries(arr.reduce((m, x) => ((m[f(x)] = (m[f(x)] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
  const scr = Object.values(screened());
  const family = (t) => /junior|graduate|intern|trainee/i.test(t) ? 'Junior / graduate' : /quant|systematic|algo/i.test(t) ? 'Quant / systematic' : /analyst|research|associate/i.test(t) ? 'Analyst / research' : /trader|trading|dealer/i.test(t) ? 'Trader' : 'Other';
  const data = { jobsAnalysed: texts.length, windowDays: 30, skills, locations: by(recent, (j) => country(j.location)), families: by(recent, (j) => family(j.title)),
    screening: { total: scr.length, byVerdict: by(scr, (s) => s.verdict), reasons: scr.slice(-12).reverse() },
    pipeline: Object.fromEntries(STATUSES.map((s) => [s, apps().filter((a) => a.status === s).length])) };
  insightsCache = { at: Date.now(), data };
  return data;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.pdf': 'application/pdf', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript; charset=utf-8', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(type === 'application/json' ? JSON.stringify(body) : body); };
const bodyOf = (req) => new Promise((ok) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch { ok({}); } }); });
function insideApp(id, file) {
  const folder = findApp(id), full = resolve(folder, file);
  if (!full.startsWith(folder + sep) || !existsSync(full)) throw Object.assign(new Error('File not found'), { code: 404 });
  return full;
}
const tailorSoon = () => { if (settings().tailorOnQueue) autopilot.run({ discover: false, reason: 'queue' }); };

createServer(async (req, res) => {
  // Only this machine: refuse anything that is not a loopback request.
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return send(res, 403, { error: 'local only' });
  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const route = `${req.method} ${url.pathname}`;
  try {
    if (route === 'GET /' || route === 'GET /index.html') return send(res, 200, readFileSync(join(ENGINE, 'dashboard.html')), MIME['.html']);
    if (route === 'GET /api/state') {
      const list = apps();
      return send(res, 200, { now: new Date().toISOString(), apps: list.map((a) => ({ ...a, refining: autopilot.isRefining(a.id), route: applyRoute(a.url) })), figures: figures(list), discovery: discovery(), jcc: await jccHealth(), autopilot: autopilot.status(), profile: profile(),
        // Roles screened from Indeed live only in screened.json (JCC roles carry theirs in discovery.jobs).
        screenedExternal: Object.entries(screened()).filter(([k]) => !/^\d+$/.test(k)).map(([key, v]) => ({ key, ...v })) });
    }
    if (route === 'GET /api/insights') return send(res, 200, insights());
    if (route === 'GET /api/master/cv.pdf') return send(res, 200, readFileSync(join(ENGINE, 'master', 'Master CV.pdf')), MIME['.pdf']);
    if (req.method === 'GET' && parts[0] === 'files' && parts.length >= 3) { const full = insideApp(parts[1], parts.slice(2).join('/')); return send(res, 200, readFileSync(full), MIME[extname(full).toLowerCase()] || 'application/octet-stream'); }

    if (req.method === 'POST' && parts[0] === 'api' && parts[1] === 'app') {
      const id = parts[2], b = await bodyOf(req);
      if (parts[3] === 'status') return send(res, 200, setStatus(id, b.status, b));
      if (parts[3] === 'update') return send(res, 200, updateApp(id, (job) => {
        if (typeof b.notes === 'string') job.notes = b.notes;
        if (b.followUpDone) { const f = (job.followUps || []).find((x) => x.n === b.followUpDone); if (f) f.done = new Date().toISOString(); }
        if (b.interview) (job.interviews ||= []).push({ at: new Date(b.interview.at).toISOString(), stage: String(b.interview.stage || 'Interview'), notes: String(b.interview.notes || '') });
      }));
      if (parts[3] === 'apply') {
        // Manual click or Auto mode: the engine submits only when it can do so truthfully, else says why.
        return send(res, 200, await autopilot.applyOne(id, { dryRun: Boolean(b.dryRun) }));
      }
      if (parts[3] === 'delete') {
        const app = loadApp(findApp(id));
        if (b.hide && app.jccJobId) { try { await jccCall('DELETE', `/api/jobs/${app.jccJobId}`); } catch {} }
        return send(res, 200, deleteApp(id));
      }
      if (parts[3] === 'override') {
        // ready: accept a package despite failed checks (recorded); requeue: tailor it again from the master.
        if (b.action === 'ready') return send(res, 200, setStatus(id, 'ready', { note: `Override: marked ready by you${b.reason ? ' (' + b.reason + ')' : ''}` }));
        if (b.action === 'requeue') { const a = setStatus(id, 'queued', { note: 'Override: tailor again' }); tailorSoon(); return send(res, 200, a); }
        throw Object.assign(new Error('Unknown override'), { code: 400 });
      }
      if (parts[3] === 'edit') {
        // Edit one CV paragraph by hand, then rebuild with every check. The spec keeps the edit for good.
        const folder = findApp(id), specPath = join(folder, 'spec.json'), spec = JSON.parse(readFileSync(specPath, 'utf8'));
        const p = Number(b.p), text = String(b.text || '').trim();
        if (!p || !text) throw Object.assign(new Error('Paragraph and text are required'), { code: 400 });
        const op = spec.cv.ops.find((o) => Number(o.p) === p && (o.op === 'replace' || o.op === 'replaceAfter'));
        if (op) op.text = text; else throw Object.assign(new Error('That paragraph has no tailored version to edit'), { code: 400 });
        writeFileSync(specPath, JSON.stringify(spec, null, 2));
        const r = spawnSync(process.execPath, ['--no-warnings', join(ENGINE, 'build.mjs'), folder], { encoding: 'utf8', timeout: 300000 });
        updateApp(id, (j) => (j.history ||= []).push({ status: j.status, at: new Date().toISOString(), note: `You edited paragraph ${p}` }));
        return send(res, 200, { passed: r.status === 0, output: (r.stdout || r.stderr || '').trim() });
      }
      if (parts[3] === 'refine') {
        if (!String(b.instruction || '').trim()) throw Object.assign(new Error('Say what to change'), { code: 400 });
        const folder = loadApp(findApp(id)).folder;
        const r = await autopilot.refine(id, folder, String(b.instruction).trim());
        updateApp(id, (job) => (job.refinements ||= []).push({ at: new Date().toISOString(), ask: b.instruction, reply: r.reply, ok: r.ok }));
        return send(res, r.ok ? 200 : 502, r.ok ? r : { error: r.reply || 'Refine failed' });
      }
    }
    if (route === 'POST /api/job/delete') {
      const b = await bodyOf(req), key = String(b.key);
      forgetScreen(key);
      if (/^\d+$/.test(key)) await jccCall('DELETE', `/api/jobs/${key}`);
      return send(res, 200, { deleted: key });
    }
    if (route === 'POST /api/job/tailor-anyway') { const b = await bodyOf(req); const a = tailorAnyway(b.key); tailorSoon(); return send(res, 200, a); }
    if (route === 'POST /api/queue') { const b = await bodyOf(req); const a = queueFromJcc(Number(b.jobId)); tailorSoon(); return send(res, 200, a); }
    if (route === 'POST /api/import') { const b = await bodyOf(req); const a = queueManual(b); tailorSoon(); return send(res, 200, a); }
    if (route === 'POST /api/autopilot/run') { const b = await bodyOf(req); autopilot.run({ discover: b.discover !== false, reason: 'manual' }); return send(res, 202, autopilot.status()); }
    if (route === 'POST /api/autopilot/config') { const b = await bodyOf(req); const allowed = ['minVerdict', 'tailorOnQueue', 'windowHours', 'applyMode']; return send(res, 200, autopilot.configure(Object.fromEntries(Object.entries(b).filter(([k]) => allowed.includes(k))))); }
    if (route === 'POST /api/profile') { const b = await bodyOf(req); const keep = ['firstName', 'lastName', 'email', 'phone', 'city', 'linkedin', 'authorisedUK', 'sponsorshipUK', 'authorisedOther', 'sponsorshipOther', 'rightToWork', 'visa', 'noticePeriod', 'availableFrom', 'salaryUK', 'salaryEU', 'salaryUAE', 'relocation', 'heardAbout']; return send(res, 200, saveProfile({ ...profile(), ...Object.fromEntries(Object.entries(b).filter(([k]) => keep.includes(k)).map(([k, v]) => [k, String(v).trim()])), updatedAt: new Date().toISOString() })); }
    if (route === 'POST /api/open-url') {
      // External links open in the default browser as a new tab, so the dashboard tab is never replaced.
      const b = await bodyOf(req); let u;
      try { u = new URL(String(b.url || '')); } catch { throw Object.assign(new Error('Not a valid link'), { code: 400 }); }
      if (!['http:', 'https:'].includes(u.protocol)) throw Object.assign(new Error('Only web links can be opened'), { code: 400 });
      spawn('explorer.exe', [u.href], { detached: true, stdio: 'ignore' }).unref();
      return send(res, 200, { ok: true });
    }
    if (route === 'POST /api/open') {
      const b = await bodyOf(req);
      const target = b.file ? insideApp(b.id, b.file) : b.id ? findApp(b.id) : APPS;
      spawn('explorer.exe', [target], { detached: true, stdio: 'ignore' }).unref();
      return send(res, 200, { ok: true });
    }
    // JCC: start, search, sources, target roles and locations (all through JCC's own API).
    if (route === 'POST /api/jcc/start') { autopilot.startJcc(); return send(res, 200, { ok: true }); }
    if (route === 'POST /api/jcc/run') return send(res, 202, await jccCall('POST', '/api/discovery/run', {}));
    if (route === 'GET /api/jcc/run') return send(res, 200, await jccCall('GET', '/api/discovery/state'));
    if (route === 'POST /api/sources') { const b = await bodyOf(req); if (!b.name || !/^https?:\/\//.test(b.baseUrl || '')) throw Object.assign(new Error('Give the source a name and a full https:// careers or job-board URL'), { code: 400 }); return send(res, 201, await jccCall('POST', '/api/sources', { name: b.name, baseUrl: b.baseUrl, company: b.company || b.name, kind: 'AUTO' })); }
    if (route === 'POST /api/roles') { const b = await bodyOf(req); return send(res, 201, await jccCall('POST', '/api/roles', { family: b.family || 'Custom', phrase: b.phrase })); }
    if (route === 'POST /api/locations') { const b = await bodyOf(req); return send(res, 201, await jccCall('POST', '/api/locations', { country: b.country, city: b.city || null })); }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, Number.isInteger(e.code) && e.code >= 400 ? e.code : 500, { error: e.message });
  }
}).listen(PORT, '127.0.0.1', async () => {
  console.log(`Job Command Centre: http://127.0.0.1:${PORT}`);
  // Nothing runs on its own: JCC and the automation start only when the user clicks Search or Queue.
});

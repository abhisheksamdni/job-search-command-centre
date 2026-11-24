// Automation behind the Search button: JCC discovery, Indeed (official connector), screening of every new
// role, tailoring of every queued application, then Gmail replies and follow-up drafts. No caps: each stage
// works through everything, in focused headless Claude passes so no single session runs out of context.
// It never submits an application or sends an email.
import { writeFileSync, mkdirSync, readdirSync, rmSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { APPS, ENGINE, INBOX, JCC_DIR, JCC_URL, apps, discovery, jccJob, screened, settings, saveSettings, updateApp, setStatus } from './store.mjs';
import { autoApply } from './apply.mjs';

const LOG = join(ENGINE, 'autopilot.log');
const STATE = join(ENGINE, 'autopilot-state.json');
const INDEED_INBOX = join(ENGINE, 'inbox-indeed');
const readState = () => { try { return JSON.parse(readFileSync(STATE, 'utf8')); } catch { return {}; } };
const state = { startedAt: null, detail: '', ...readState(), running: false, phase: 'idle' };
const persist = () => { const { running, phase, ...keep } = state; writeFileSync(STATE, JSON.stringify(keep, null, 2)); };
const log = (msg) => appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`);
const set = (phase, detail = '') => { state.phase = phase; state.detail = detail; log(`${phase}${detail ? ': ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SCREEN_BATCH = 12;

async function jccUp() { try { return (await fetch(`${JCC_URL}/api/health`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; } }
export function startJcc() {
  // Same launch as start-jcc.bat, without the batch file's console checks that fail when run detached.
  spawn('cmd.exe', ['/d', '/s', '/c', 'node src\\server.mjs >> ..\\JCC-Data\\Logs\\server.log 2>&1'], { cwd: JCC_DIR, detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

async function discoverOnce(attempt) {
  if (!(await jccUp())) { set('discovery', attempt > 1 ? `JCC stopped; restarting it (attempt ${attempt})` : 'starting JCC'); startJcc(); for (let i = 0; i < 30 && !(await jccUp()); i++) await sleep(1000); }
  if (!(await jccUp())) throw new Error('JCC did not start');
  set('discovery', `searching job boards${attempt > 1 ? ` (rerun ${attempt - 1})` : ''}`);
  await fetch(`${JCC_URL}/api/discovery/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const deadline = Date.now() + 190 * 60000; // JCC's own limit is 180 minutes (every LinkedIn page)
  await sleep(5000);
  while (Date.now() < deadline) {
    // A failed fetch here means the JCC process died mid-search; the caller restarts and reruns it.
    const s = await (await fetch(`${JCC_URL}/api/discovery/state`, { signal: AbortSignal.timeout(15000) })).json();
    if (!s.running) return s;
    state.detail = `searching: ${s.queriesCompleted || 0}/${s.plannedQueries || '?'} queries, ${s.uniqueJobs || 0} listings, ${s.newCandidates || 0} new`;
    await sleep(10000);
  }
  throw new Error('Discovery did not finish within 190 minutes');
}
// Restart JCC and rerun the search if it crashes, up to 2 reruns, before giving up.
async function runDiscovery() {
  for (let attempt = 1; ; attempt++) {
    try { return await discoverOnce(attempt); }
    catch (e) {
      log(`discovery attempt ${attempt} failed: ${e.message}`);
      if (attempt >= 3 || /did not finish/.test(e.message)) throw new Error(`Search engine failed ${attempt} time(s): ${e.message}`);
      await sleep(5000);
    }
  }
}

const when = (j) => { const d = String(j.posted || j.seen || ''); return +new Date(d.length <= 19 ? d.replace(' ', 'T') + 'Z' : d); };
function fillInbox() {
  rmSync(INBOX, { recursive: true, force: true }); mkdirSync(INBOX, { recursive: true });
  const s = settings(), scr = screened(), queued = new Set(apps().map((a) => a.jccJobId).filter(Boolean));
  const cutoff = Date.now() - s.windowHours * 3600000;
  for (const j of discovery().jobs.filter((x) => !scr[x.id] && !queued.has(x.id) && when(x) >= cutoff)) {
    const d = jccJob(j.id);
    if (!d?.jd || d.jd.length < 300) continue; // nothing to screen against
    writeFileSync(join(INBOX, `${j.id}.md`), `jccJobId: ${j.id}\n# ${d.title}\n${d.company} · ${d.location} · posted ${d.posted || d.seen}\nPosting: ${d.url}\n\n${d.jd.slice(0, 6000)}\n`);
  }
  // Roles the Indeed pass saved (indeed-<id>.md) are screened alongside the JCC ones.
  // Indeed roles are screened alongside JCC's; a copy is archived so 'Tailor anyway' can still use them later.
  if (existsSync(INDEED_INBOX)) { mkdirSync(join(ENGINE, 'indeed-archive'), { recursive: true }); for (const f of readdirSync(INDEED_INBOX).filter((x) => x.endsWith('.md'))) { const body = readFileSync(join(INDEED_INBOX, f)); writeFileSync(join(INBOX, f), body); writeFileSync(join(ENGINE, 'indeed-archive', f), body); } }
  return readdirSync(INBOX).filter((f) => f.endsWith('.md'));
}

// Read and draft only on Gmail; search and read on Indeed. Nothing that sends, archives or deletes.
const GMAIL = ['search_threads', 'get_thread', 'get_message', 'list_drafts', 'create_draft'].map((t) => `mcp__claude_ai_Gmail__${t}`);
const INDEED = ['search_jobs', 'get_job_details'].map((t) => `mcp__claude_ai_Indeed__${t}`);
const ALLOWED = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash(node _engine/build.mjs:*)', 'Bash(node _engine/queue.mjs:*)', ...GMAIL, ...INDEED];
// A token refresh clash between two Claude processes is transient: wait a minute and try once more.
async function claude(prompt, label, timeoutMin = 60) {
  const r = await claudeOnce(prompt, label, timeoutMin);
  if (/Failed to refresh OAuth token|retry in a minute/i.test(r.out)) { log(`${label}: transient sign-in refresh clash, retrying in 60 s`); await sleep(60000); return claudeOnce(prompt, label, timeoutMin); }
  return r;
}
function claudeOnce(prompt, label, timeoutMin) {
  return new Promise((done) => {
    log(`claude -p (${label})`);
    const child = spawn('claude', ['-p', prompt, '--permission-mode', 'acceptEdits', '--allowedTools', ...ALLOWED, '--output-format', 'text'], { cwd: APPS, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const onData = (d) => { const t = d.toString(); out += t; appendFileSync(LOG, t); };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    const killer = setTimeout(() => { log(`${label} timed out after ${timeoutMin} minutes`); child.kill(); }, timeoutMin * 60000);
    child.on('close', (code) => {
      clearTimeout(killer);
      if (/OAuth session expired|Failed to authenticate|not logged in|Please run \/login/i.test(out)) { state.claudeAuth = 'expired'; done({ code, out, auth: false }); return; }
      state.claudeAuth = 'ok'; done({ code, out, auth: true });
    });
    child.on('error', (e) => { clearTimeout(killer); done({ code: -1, out: String(e.message), auth: true }); });
  });
}
const signedOut = () => new Error('Claude Code is signed out. Run "claude" in a terminal and sign in with /login.');

// "Refine with AI" on one application: Claude edits that spec.json and rebuilds, same truth checks.
const refining = new Set();
export async function refine(id, folder, instruction) {
  if (refining.has(id)) throw Object.assign(new Error('Already refining this application'), { code: 409 });
  refining.add(id);
  try {
    const r = await claude(`Follow the rules in CLAUDE.md. Only touch the folder "${folder}". The user asked for this change to the CV and/or cover letter: """${instruction.replace(/"/g, "'")}""". Edit that folder's spec.json accordingly (never adding unsupported facts and never deleting master content; if the request would need either, refuse that part and say why), then run node _engine/build.mjs "${folder}" until it passes. Reply in two sentences: what you changed, and anything you refused.`, `refine ${id}`, 30);
    return { ok: r.code === 0 && r.auth, reply: r.out.trim().split('\n').slice(-6).join('\n') };
  } finally { refining.delete(id); }
}
export const isRefining = (id) => refining.has(id);

export async function run({ discover = true, reason = 'manual' } = {}) {
  if (state.running) return status();
  state.running = true; state.startedAt = new Date().toISOString(); state.lastError = null;
  const before = new Set(apps().filter((a) => a.status === 'ready').map((a) => a.id));
  const summary = { indeed: 0, screened: 0, queued: 0, tailored: 0, failed: [] };
  log(`=== run (${reason}) ===`);
  try {
    // 1. Boards: JCC (LinkedIn, every role, every page) and Indeed through the official connector.
    if (discover) {
      await runDiscovery();
      rmSync(INDEED_INBOX, { recursive: true, force: true }); mkdirSync(INDEED_INBOX, { recursive: true });
      set('indeed', 'searching Indeed through the connector');
      const r = await claude('Follow CLAUDE.md, Step 0 only (Indeed), then finish.', 'indeed', 45);
      if (!r.auth) throw signedOut();
      summary.indeed = readdirSync(INDEED_INBOX).length;
    }
    // 2. Screen every new role, in batches so each Claude pass stays focused. A run started by the user
    //    queuing or adding one role skips this, so their role is tailored straight away; Search screens.
    const files = reason === 'queue' ? [] : fillInbox();
    for (let i = 0; i < files.length; i += SCREEN_BATCH) {
      const batch = files.slice(i, i + SCREEN_BATCH);
      set('screening', `roles ${i + 1}-${i + batch.length} of ${files.length}`);
      const r = await claude(`Follow CLAUDE.md, Step 1 only, for exactly these inbox files: ${batch.map((f) => `_engine/inbox/${f}`).join(', ')}. Do not tailor anything in this pass.`, `screen ${i + 1}-${i + batch.length}`, 40);
      if (!r.auth) throw signedOut();
      summary.screened += batch.length;
    }
    // 3. Tailor every queued application, one fresh Claude pass each. The queue is re-read after each
    //    one, so roles queued while the run is going (Queue button, + Add job) are tailored in this run too.
    const tried = new Set();
    for (let next; (next = apps().find((a) => a.status === 'queued' && !tried.has(a.id))); ) {
      tried.add(next.id); summary.queued = tried.size;
      const left = apps().filter((a) => a.status === 'queued' && !tried.has(a.id)).length;
      set('tailoring', `${next.company}, ${next.role} (${tried.size} done or in progress, ${left} waiting)`);
      const r = await claude(`Follow CLAUDE.md, Step 2, for this one application only: folder "${next.folder}". Tailor it, build it until it passes or you have tried 3 times, then finish.`, `tailor ${next.id}`, 30);
      if (!r.auth) throw signedOut();
      const after = apps().find((x) => x.id === next.id);
      if (after?.status === 'ready') summary.tailored++; else summary.failed.push(next.id);
    }
    // 4. Auto mode only: submit every ready package the engine can (Greenhouse, Lever, Ashby forms).
    //    Anything it cannot finish truthfully is left for the user with the reason on the card.
    if (settings().applyMode === 'auto') {
      const toApply = apps().filter((a) => a.status === 'ready' && !a.applyAttempt);
      for (const [n, a] of toApply.entries()) {
        set('applying', `${n + 1} of ${toApply.length}: ${a.company}, ${a.role}`);
        await applyOne(a.id);
      }
      summary.applied = apps().filter((a) => a.applyAttempt?.status === 'submitted' && toApply.some((t) => t.id === a.id)).length;
    }
    // 5. Replies and follow-up drafts for everything already sent.
    if (apps().some((a) => ['sent', 'screening', 'interview'].includes(a.status))) {
      set('replies', 'checking Gmail for replies and due follow-ups');
      const r = await claude('Follow CLAUDE.md, Step 3 only (replies and follow-ups), then finish.', 'replies', 20);
      if (!r.auth) throw signedOut();
    }
    const nowReady = apps().filter((a) => a.status === 'ready' && !before.has(a.id)).map((a) => a.id);
    state.lastRun = { at: new Date().toISOString(), reason, ok: true, ...summary, newlyReady: nowReady };
    set('idle', `done: ${summary.screened} screened (${summary.indeed} from Indeed), ${summary.tailored} tailored, ${nowReady.length} new package(s) ready`);
  } catch (e) {
    state.lastError = e.message; state.lastRun = { at: new Date().toISOString(), reason, ok: false, error: e.message, ...summary };
    set('idle', `failed: ${e.message}`);
  } finally {
    state.running = false; rmSync(INBOX, { recursive: true, force: true }); persist();
  }
  return status();
}

// One application through the auto-apply engine; a confirmed submission marks it sent (follow-ups start).
export async function applyOne(id, { dryRun = false } = {}) {
  log(`auto-apply ${id}${dryRun ? ' (dry run)' : ''}`);
  const r = await autoApply(id, { dryRun });
  log(`auto-apply ${id}: ${r.status}: ${r.reason}`);
  updateApp(id, (j) => { j.applyAttempt = r; });
  if (r.status === 'submitted') setStatus(id, 'sent', { note: `Auto-applied: ${r.reason}` });
  return r;
}

export function status() {
  return { ...state, settings: settings(), logTail: existsSync(LOG) ? readFileSync(LOG, 'utf8').split('\n').slice(-40).join('\n') : '' };
}
export const configure = (patch) => { saveSettings(patch); return status(); };

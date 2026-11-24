// CLI used by the autopilot's headless Claude run.
//   node _engine/queue.mjs <jccJobId>                         queue a JCC job, prints the new folder
//   node _engine/queue.mjs --screen <jccJobId> <VERDICT> "<reason>"   record a role as screened out
//   node _engine/queue.mjs --status <APP-id> <status> ["note"]  mark tailoring / draft (never sent)
import { readFileSync } from 'node:fs';
import { queueFromJcc, queueManual, recordScreen, seenExternal, updateApp } from './store.mjs';

const [a, b, c, ...rest] = process.argv.slice(2);
const VERDICTS = ['STRONG MATCH', 'GOOD MATCH', 'STRETCH', 'WEAK MATCH', 'DO NOT APPLY'];
function withScreen(app, verdict, reason) {
  const v = String(verdict || '').toUpperCase();
  if (!VERDICTS.includes(v) || app.screenVerdict) return app;
  return updateApp(app.id, (j) => { j.screenVerdict = v; j.screenReason = reason || ''; if (!j.verdict) j.verdict = v; });
}
try {
  if (a === '--screen') {
    if (!b || !c) throw new Error('usage: --screen <jccJobId> <VERDICT> "<reason>"');
    const r = recordScreen(Number(b), c.toUpperCase(), rest.join(' '));
    console.log(`SCREENED ${b} ${r.verdict}: ${r.reason}`);
  } else if (a === '--status') {
    // Only pipeline states; sending is always the user's own action in the dashboard.
    if (!['tailoring', 'draft', 'queued'].includes(c)) throw new Error('status must be tailoring, draft or queued');
    const app = updateApp(b, (j) => { j.status = c; (j.history ||= []).push({ status: c, at: new Date().toISOString(), ...(rest.length ? { note: rest.join(' ') } : {}) }); });
    console.log(`${app.id} -> ${app.status}`);
  } else if (a === '--reply') {
    // An employer replied to a sent application (found in Gmail by the autopilot).
    if (!['screening', 'interview', 'rejected'].includes(c)) throw new Error('reply status must be screening, interview or rejected');
    const app = updateApp(b, (j) => {
      if (!['sent', 'screening', 'interview'].includes(j.status)) throw new Error(`${b} is ${j.status}; replies only apply to sent applications`);
      for (const f of j.followUps || []) if (!f.done) f.done = 'superseded';
      j.status = c; (j.history ||= []).push({ status: c, at: new Date().toISOString(), note: `Email: ${rest.join(' ')}` });
    });
    console.log(`${app.id} -> ${app.status}`);
  } else if (a === '--drafted') {
    // A follow-up email was saved as a Gmail draft (never sent).
    const app = updateApp(b, (j) => { const f = (j.followUps || []).find((x) => x.n === Number(c)); if (!f) throw new Error(`No follow-up ${c}`); f.drafted = new Date().toISOString(); });
    console.log(`${app.id} follow-up ${c} drafted`);
  } else if (a === '--file') {
    // Queue a role saved as a file (e.g. found through the Indeed connector). Header lines, a blank line, then the JD:
    //   key: indeed:<id> / title: / company: / location: / url: / posted:
    const raw = readFileSync(b, 'utf8'), [head, ...body] = raw.split(/\r?\n\r?\n/);
    const h = Object.fromEntries(head.split(/\r?\n/).map((l) => l.match(/^(\w+):\s*(.*)$/)).filter(Boolean).map((m) => [m[1].toLowerCase(), m[2].trim()]));
    const app = withScreen(queueManual({ company: h.company, role: h.title, location: h.location, url: h.url, postedAt: h.posted || null, jd: body.join('\n\n'), source: h.key?.startsWith('indeed:') ? 'Indeed' : 'Manual', externalKey: h.key || null }), c, rest[0]);
    console.log(`QUEUED ${app.id} "${app.folder}"`);
  } else if (a === '--screen-ext') {
    // --screen-ext <indeed:id> <VERDICT> "<reason>" "<title>" "<company>"
    const [reason, title, company] = rest;
    const r = recordScreen(b, String(c).toUpperCase(), reason || '', { title, company, source: 'Indeed' });
    console.log(`SCREENED ${b} ${r.verdict}: ${r.reason}`);
  } else if (a === '--seen') {
    console.log(seenExternal(b) ? 'SEEN' : 'NEW');
  } else if (/^\d+$/.test(a || '')) {
    // node _engine/queue.mjs <jccJobId> ["<VERDICT>" "<reason>"]: the screening verdict is kept on the card.
    const app = withScreen(queueFromJcc(Number(a)), b, c);
    console.log(`QUEUED ${app.id} "${app.folder}"`);
  } else {
    throw new Error('usage: queue.mjs <jccJobId> | --screen <id> <VERDICT> "<reason>" | --status <APP-id> <status>');
  }
} catch (e) { console.error(e.message); process.exit(1); }

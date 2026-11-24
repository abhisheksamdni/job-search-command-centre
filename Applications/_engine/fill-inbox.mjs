// Writes the screening inbox (_engine/inbox/<jccId>.md) for roles not yet screened or queued, the same way
// the Search button does. Used when screening runs in an interactive Claude session instead of headless.
import { writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { INBOX, apps, discovery, jccJob, screened, settings } from './store.mjs';

const when = (j) => { const d = String(j.posted || j.seen || ''); return +new Date(d.length <= 19 ? d.replace(' ', 'T') + 'Z' : d); };
rmSync(INBOX, { recursive: true, force: true }); mkdirSync(INBOX, { recursive: true });
const s = settings(), scr = screened(), queued = new Set(apps().map((a) => a.jccJobId).filter(Boolean));
const cutoff = Date.now() - s.windowHours * 3600000;
for (const j of discovery().jobs.filter((x) => !scr[x.id] && !queued.has(x.id) && when(x) >= cutoff)) {
  const d = jccJob(j.id);
  if (!d?.jd || d.jd.length < 300) continue;
  writeFileSync(join(INBOX, `${j.id}.md`), `jccJobId: ${j.id}\n# ${d.title}\n${d.company} · ${d.location} · posted ${d.posted || d.seen}\nPosting: ${d.url}\n\n${d.jd.slice(0, 6000)}\n`);
}
console.log(`${readdirSync(INBOX).length} roles written to ${INBOX}`);

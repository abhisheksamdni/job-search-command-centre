// Auto-apply: fills and submits a ready application on a supported company application form.
// Supported: Greenhouse, Lever and Ashby forms (no login), including LinkedIn postings that link out to them.
// It only uses facts from the master CV and the user's own Profile answers, never guesses a required
// answer, and stops (handing the application back to the user) on a login wall, a CAPTCHA, an unknown
// required question, or a submission it cannot confirm. Evidence screenshots go to <folder>/submitted.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { APPS, JCC_DIR, findApp, profile } from './store.mjs';

const ATS = [
  ['greenhouse', /(^|\.)greenhouse\.io$/i], ['lever', /(^|\.)lever\.co$/i], ['ashby', /(^|\.)ashbyhq\.com$/i],
];
const testHosts = () => String(process.env.APPLY_TEST_HOSTS || '').split(',').filter(Boolean);
export function atsOf(url) {
  let host; try { host = new URL(url).hostname; } catch { return null; }
  if (testHosts().includes(host)) return 'test';
  return ATS.find(([, rx]) => rx.test(host))?.[0] || null;
}
// What the dashboard shows before any attempt: can this posting be auto-applied at all?
export function applyRoute(url = '') {
  if (atsOf(url)) return { auto: true, via: atsOf(url) };
  if (/linkedin\.com\/jobs\/view/i.test(url)) return { auto: 'maybe', via: 'linkedin', note: 'Auto-applies only if the posting links out to Greenhouse, Lever or Ashby; Easy Apply needs your LinkedIn login.' };
  if (/indeed\./i.test(url)) return { auto: false, via: 'indeed', note: 'Indeed applications need your Indeed login.' };
  if (/myworkdayjobs|workday/i.test(url)) return { auto: false, via: 'workday', note: 'Workday needs an account you create and sign into.' };
  return { auto: false, via: 'other', note: 'This site is not one the auto-apply engine supports.' };
}

async function browser() {
  const { chromium } = await import(pathToFileURL(join(JCC_DIR, 'node_modules', 'playwright', 'index.mjs')).href);
  return chromium.launch({ headless: true });
}

// LinkedIn guest postings carry the company's own apply link in a hidden "applyUrl" element when the
// job is applied for off-site. Easy Apply jobs have none (they need the user's LinkedIn login).
async function resolveLinkedIn(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  const raw = await page.evaluate(() => document.querySelector('code#applyUrl')?.innerHTML || '');
  const m = raw.match(/https?:[^"'<>\s]+/);
  if (!m) return null;
  let target = m[0].replace(/&amp;/g, '&');
  try { const u = new URL(target); if (u.searchParams.get('url')) target = u.searchParams.get('url'); } catch {}
  return target;
}

const formUrl = (ats, url) => ats === 'lever' && !/\/apply\/?$/.test(url) ? url.replace(/\/?$/, '/apply') : ats === 'ashby' && !/\/application\/?$/.test(url) ? url.replace(/\/?$/, '/application') : url;

// Label-driven answers. Each returns a string to type/choose, or null when the user must answer.
function answerFor(label, p, job) {
  const l = label.toLowerCase(), uk = /\b(uk|united kingdom|britain|england|london)\b/i.test(label) || /united kingdom|london|\buk\b/i.test(job.location || '');
  const yn = (v) => (/^y/i.test(v || '') ? 'Yes' : /^n/i.test(v || '') ? 'No' : null);
  if (/first name|given name|forename/.test(l)) return p.firstName || null;
  if (/last name|surname|family name/.test(l)) return p.lastName || null;
  if (/^(full )?name\b|your name|legal name/.test(l)) return [p.firstName, p.lastName].filter(Boolean).join(' ') || null;
  if (/e-?mail/.test(l)) return p.email || null;
  if (/phone|mobile|telephone/.test(l)) return p.phone || null;
  if (/linkedin/.test(l)) return p.linkedin || null;
  if (/(current |your )?(location|city)|where are you (based|located)/.test(l)) return p.city || null;
  if (/sponsor/.test(l)) return yn(uk ? p.sponsorshipUK : p.sponsorshipOther);
  if (/authori[sz]ed|right to work|eligible to work|legally (able|permitted)/.test(l)) return yn(uk ? p.authorisedUK : p.authorisedOther);
  if (/notice period|when can you start|start date|availability/.test(l)) return p.noticePeriod || null;
  if (/salary|compensation|pay expectation/.test(l)) return (uk ? p.salaryUK : p.salaryEU) || null;
  if (/how did you hear|where did you (hear|find)|source/.test(l)) return p.heardAbout || 'Job board';
  if (/relocat/.test(l)) return yn(p.relocation) || (p.relocation ? 'Yes' : null);
  if (/gender|race|ethnic|veteran|disabilit|sexual orientation|pronoun|hispanic/.test(l)) return '__DECLINE__';
  return null;
}

// testUrl / testProfile exist only for the local mock-form test; real runs use the job's URL and Profile.
export async function autoApply(id, { dryRun = false, testUrl = null, testProfile = null } = {}) {
  const folder = findApp(id), job = JSON.parse(readFileSync(join(folder, 'job.json'), 'utf8')), p = testProfile || profile();
  if (testUrl) job.url = testUrl;
  const out = join(folder, 'submitted'); mkdirSync(out, { recursive: true });
  const result = (status, reason, extra = {}) => ({ status, reason, at: new Date().toISOString(), ...extra });
  const cvPdf = job.documents?.cv?.pdf && join(folder, job.documents.cv.pdf), letterPdf = job.documents?.letter?.pdf && join(folder, job.documents.letter.pdf);
  if (!cvPdf || !existsSync(cvPdf)) return result('needs-you', 'No built CV to attach.');
  const missing = ['firstName', 'lastName', 'email', 'phone'].filter((k) => !p[k]);
  if (missing.length) return result('needs-you', `Fill these in Profile & CV first: ${missing.join(', ')}.`);
  const route = applyRoute(job.url);
  if (route.auto === false) return result('needs-you', route.note);

  const b = await browser();
  try {
    const page = await (await b.newContext({ locale: 'en-GB' })).newPage();
    let url = job.url, ats = atsOf(url);
    if (!ats && route.via === 'linkedin') {
      const target = await resolveLinkedIn(page, url);
      if (!target) return result('needs-you', 'LinkedIn Easy Apply: needs your LinkedIn login.');
      url = target; ats = atsOf(url);
      if (!ats) return result('needs-you', `Applies on ${new URL(url).hostname}, which the engine does not support.`, { applyUrl: url });
    }
    await page.goto(formUrl(ats, url), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);
    if (await page.locator('input[type=password]').count()) return result('needs-you', 'The form asks you to sign in.', { applyUrl: url });

    // Fill every field we can answer; remember the required ones we cannot.
    const letterText = (() => { try { return JSON.parse(readFileSync(join(folder, 'spec.json'), 'utf8')).coverLetter.paragraphs.join('\n\n'); } catch { return ''; } })();
    const fields = await page.evaluate(() => {
      const labelOf = (el) => {
        if (el.type === 'radio') {
          // The question, not the option: climb to the element holding every radio of this group.
          let g = el.parentElement; const n = document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`).length;
          while (g && g.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`).length < n) g = g.parentElement;
          const q = g?.querySelector('legend') || g?.parentElement?.querySelector('legend,label:not(:has(input)),.label,p');
          return (g?.getAttribute('aria-label') || q?.innerText || el.name || '').replace(/\s+/g, ' ').trim();
        }
        const id = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        const own = el.closest('label'), fs = el.closest('fieldset')?.querySelector('legend');
        const near = el.closest('div,li,fieldset')?.querySelector('label,legend,.label,.application-label');
        return (id?.innerText || el.getAttribute('aria-label') || own?.innerText || fs?.innerText || near?.innerText || el.placeholder || el.name || '').replace(/\s+/g, ' ').trim();
      };
      return [...document.querySelectorAll('input,textarea,select')].filter((el) => !['hidden', 'submit', 'button'].includes(el.type) && el.offsetParent !== null || el.type === 'file')
        .map((el, i) => { el.setAttribute('data-ap', String(i)); return { i, tag: el.tagName.toLowerCase(), type: el.type || '', name: el.name || '', label: labelOf(el), combo: el.getAttribute('role') === 'combobox' || el.hasAttribute('aria-autocomplete'), required: el.required || el.getAttribute('aria-required') === 'true' || /\*\s*$/.test(labelOf(el)), options: el.tagName === 'SELECT' ? [...el.options].map((o) => o.text.trim()) : [] }; });
    });
    const unanswered = [], filled = [], doneRadio = new Set();
    for (const f of fields) {
      const sel = `[data-ap="${f.i}"]`, el = page.locator(sel), L = f.label.toLowerCase();
      if (f.type === 'file') {
        if (/cover/i.test(L) || /cover/i.test(f.name)) { if (letterPdf && existsSync(letterPdf)) { await el.setInputFiles(letterPdf); filled.push('Cover letter (file)'); } }
        else if (/resume|cv|attach/i.test(L + f.name)) { await el.setInputFiles(cvPdf); filled.push('CV (file)'); }
        else if (f.required) unanswered.push(f.label || f.name);
        continue;
      }
      if (f.tag === 'textarea' && /cover letter|why|additional information|anything else/i.test(L)) { if (letterText) { await el.fill(letterText); filled.push(f.label); } else if (f.required) unanswered.push(f.label); continue; }
      const ans = answerFor(f.label || f.name, p, job);
      if (f.type === 'checkbox') { if (f.required && /agree|consent|privacy|terms|confirm/i.test(L)) unanswered.push(`${f.label} (a declaration you should tick yourself)`); continue; }
      if (f.type === 'radio') {
        if (doneRadio.has(f.name)) continue; doneRadio.add(f.name);
        if (!ans) { if (f.required) unanswered.push(f.label); continue; }
        const pick = await page.evaluate(({ name, ans }) => { const rs = [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(name)}"]`)]; const txt = (r) => (document.querySelector(`label[for="${CSS.escape(r.id)}"]`)?.innerText || r.closest('label')?.innerText || r.value || '').trim(); const want = ans === '__DECLINE__' ? /decline|prefer not|don.?t wish/i : new RegExp(`^${ans}`, 'i'); const r = rs.find((x) => want.test(txt(x))); if (r) { r.click(); return true; } return false; }, { name: f.name, ans });
        if (pick) filled.push(f.label); else if (f.required) unanswered.push(f.label);
        continue;
      }
      if (f.tag === 'select') {
        if (!ans) { if (f.required) unanswered.push(f.label); continue; }
        const opt = f.options.find((o) => (ans === '__DECLINE__' ? /decline|prefer not|don.?t wish/i : new RegExp(`^${ans}`, 'i')).test(o));
        if (opt) { await el.selectOption({ label: opt }); filled.push(f.label); } else if (f.required) unanswered.push(f.label);
        continue;
      }
      if (f.combo) {
        // Searchable dropdowns (Greenhouse, Ashby): type the answer, then pick the highlighted option.
        if (!ans) { if (f.required) unanswered.push(f.label); continue; }
        await el.fill(ans === '__DECLINE__' ? 'Decline' : ans); await page.waitForTimeout(400); await el.press('Enter');
        filled.push(f.label); continue;
      }
      if (ans && ans !== '__DECLINE__') { await el.fill(ans); filled.push(f.label); }
      else if (f.required) unanswered.push(f.label || f.name);
    }
    await page.screenshot({ path: join(out, 'auto-apply 1 filled.png'), fullPage: true });
    if (unanswered.length) return result('needs-you', `Required questions it would not guess: ${unanswered.slice(0, 6).join('; ')}`, { applyUrl: url, filled });
    if (await page.locator('iframe[src*="hcaptcha"], iframe[title*="challenge" i], .h-captcha').count()) return result('needs-you', 'The form shows a CAPTCHA.', { applyUrl: url, filled });
    if (dryRun) return result('dry-run', 'Filled every field; not submitted (dry run).', { applyUrl: url, filled });

    const submit = page.locator('button[type=submit], input[type=submit], button:has-text("Submit application"), button:has-text("Submit")').first();
    await submit.click();
    const ok = await page.waitForFunction(() => /thank you|application (has been )?(received|submitted)|we('| ha)ve received your application|successfully submitted/i.test(document.body.innerText), null, { timeout: 25000 }).then(() => true).catch(() => false);
    await page.screenshot({ path: join(out, 'auto-apply 2 after submit.png'), fullPage: true });
    if (await page.locator('iframe[title*="challenge" i], iframe[src*="hcaptcha"]').count()) return result('needs-you', 'A CAPTCHA appeared on submit; finish it yourself.', { applyUrl: url, filled });
    if (!ok) return result('unconfirmed', 'Clicked submit but saw no confirmation. Check your email or the site before marking it sent.', { applyUrl: url, filled });
    writeFileSync(join(out, 'auto-apply confirmation.txt'), `${new Date().toISOString()}\n${page.url()}\n\n${(await page.innerText('body')).slice(0, 3000)}`);
    return result('submitted', `Submitted on ${ats === 'test' ? 'the test form' : ats}, confirmation page captured.`, { applyUrl: url, filled, ats });
  } catch (e) {
    return result('needs-you', `Auto-apply stopped: ${e.message.split('\n')[0]}`);
  } finally { await b.close().catch(() => {}); }
}

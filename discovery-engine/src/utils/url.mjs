const DROP_PARAMS = new Set([
  'utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid','trk','trackingId','ref','source'
]);

export function canonicalizeUrl(raw) {
  if (!raw) return '';
  let u;
  const decoded=String(raw).trim().replace(/&amp;/gi,'&');
  try { u = new URL(decoded); } catch { return decoded; }
  u.hash = '';
  if (/(?:^|\.)linkedin\.com$/i.test(u.hostname) && /^\/jobs\/view\//i.test(u.pathname)) {
    u.hostname='linkedin.com';
    u.search='';
  }
  for (const key of [...u.searchParams.keys()]) if (DROP_PARAMS.has(key)) u.searchParams.delete(key);
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  u.pathname = u.pathname.replace(/\/+$/, '') || '/';
  const params = [...u.searchParams.entries()].sort(([a],[b]) => a.localeCompare(b));
  u.search = '';
  for (const [k,v] of params) u.searchParams.append(k,v);
  return u.toString();
}

export function bestApplicationUrl(job) {
  return job.applicationUrl || job.canonicalJobUrl || job.sourceUrl || '';
}

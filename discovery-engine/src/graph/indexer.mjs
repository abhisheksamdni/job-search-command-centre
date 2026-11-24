import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { paths } from '../paths.mjs';

const WIKI_RE = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
const GROUPS = new Map([
  ['candidate', 'Candidate / CV'], ['cv_version', 'Candidate / CV'], ['submitted_cv', 'Candidate / CV'],
  ['skill', 'Skills'], ['agent', 'Agents'], ['job', 'Jobs'], ['analysis', 'Jobs'], ['company', 'Jobs'],
  ['application', 'Applications'], ['source', 'Sources / Adapters'], ['adapter', 'Sources / Adapters'],
  ['contact', 'Contacts'], ['interview', 'Interviews / Follow-ups'], ['followup', 'Interviews / Follow-ups'],
  ['architecture', 'Architecture'], ['index', 'Architecture'], ['home', 'Architecture'],
  ['decision-log', 'Decisions'], ['failure-log', 'Failures / Fixes'], ['release-log', 'Releases'], ['runbook', 'Runbooks']
]);
const FOLDER_GROUPS = new Map([
  ['Candidate','Candidate / CV'],['CV','Candidate / CV'],['Skills','Skills'],['Agents','Agents'],['Jobs','Jobs'],
  ['Companies','Jobs'],['Applications','Applications'],['Sources','Sources / Adapters'],['Contacts','Contacts'],
  ['Interviews','Interviews / Follow-ups'],['Followups','Interviews / Follow-ups'],['Architecture','Architecture'],
  ['Decisions','Decisions'],['Failures','Failures / Fixes'],['Releases','Releases'],['Runbooks','Runbooks']
]);
const BASE_SIZE = new Map([
  ['home', 11], ['architecture', 8], ['job', 8], ['application', 9], ['submitted_cv', 8], ['cv_version', 7],
  ['skill', 8], ['agent', 6], ['source', 7], ['adapter', 6], ['interview', 8], ['followup', 6], ['contact', 5],
  ['analysis', 6], ['company', 6], ['release-log', 8], ['decision-log', 6], ['failure-log', 6], ['runbook', 5], ['index', 5]
]);

function listMarkdown(root) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === '.obsidian' || entry.name.startsWith('.')) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...listMarkdown(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) out.push(full);
  }
  return out.sort((a,b)=>a.localeCompare(b));
}

function scalar(raw = '') {
  const v = raw.trim();
  if (!v) return '';
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null') return null;
  if (/^-?\d+(?:\.\d+)?$/.test(v)) return Number(v);
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    try { return JSON.parse(v); } catch { return v.slice(1,-1); }
  }
  return v;
}

export function parseFrontmatter(text = '') {
  if (!text.startsWith('---\n')) return {};
  const end = text.indexOf('\n---', 4);
  if (end < 0) return {};
  const lines = text.slice(4, end).split(/\r?\n/);
  const out = {};
  let arrayKey = null;
  for (const line of lines) {
    const item = line.match(/^\s+-\s+(.+)$/);
    if (item && arrayKey) { out[arrayKey].push(scalar(item[1])); continue; }
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) { arrayKey = null; continue; }
    const [, key, raw] = m;
    if (!raw.trim()) { out[key] = []; arrayKey = key; }
    else { out[key] = scalar(raw); arrayKey = null; }
  }
  return out;
}

function heading(text, fallback) {
  return text.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback;
}
function normalizeRel(file) { return path.relative(paths.knowledgeRoot, file).replace(/\\/g,'/'); }
function nodeId(rel) { return `note:${rel.replace(/\.md$/i,'').toLowerCase()}`; }
function groupFor(front, rel) {
  if (GROUPS.has(front.type)) return GROUPS.get(front.type);
  const folder = rel.split('/')[0];
  return FOLDER_GROUPS.get(folder) || 'Other';
}
function numericJobId(v) {
  const m = String(v || '').match(/JOB-(\d+)/i); return m ? Number(m[1]) : null;
}
function routeFor(front) {
  const jobId = numericJobId(front.job_id);
  if (jobId && ['job','application','interview','followup','submitted_cv','analysis'].includes(front.type)) return `/?job=${jobId}`;
  if (front.type === 'cv_version' && front.cv_version) return `/?cv=${encodeURIComponent(front.cv_version)}`;
  if (front.type === 'source' && front.source_id) return `/?source=${front.source_id}`;
  return null;
}
function safeMeta(front) {
  const allow = ['type','job_id','application_id','cv_version','source_id','company','title','status','stage','adapter','score','verdict','recruiter_match','ats_exact','created','applied','active','master','tags'];
  const out = {};
  for (const k of allow) if (front[k] !== undefined) out[k] = front[k];
  return out;
}
function hashGraph(graph) {
  return crypto.createHash('sha256').update(JSON.stringify({nodes:graph.nodes,links:graph.links})).digest('hex');
}

export function buildGraphIndex({ knowledgeRoot = paths.knowledgeRoot, outputPath = paths.graphIndex } = {}) {
  const files = listMarkdown(knowledgeRoot);
  const notes = files.map(file => {
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(knowledgeRoot,file).replace(/\\/g,'/');
    const front = parseFrontmatter(text);
    const label = heading(text,path.basename(file,'.md'));
    const refs = [...text.matchAll(WIKI_RE)].map(m=>m[1].trim()).filter(Boolean);
    return { file, rel, text, front, label, refs };
  });
  const alias = new Map();
  for (const n of notes) {
    const id = nodeId(n.rel);
    for (const key of [n.label,path.basename(n.rel,'.md'),n.rel.replace(/\.md$/i,'')]) if (key) alias.set(String(key).toLowerCase(), id);
  }
  const nodes = notes.map(n => ({
    id: nodeId(n.rel), label: n.label, group: groupFor(n.front,n.rel), type: n.front.type || 'note',
    path: n.rel, route: routeFor(n.front), meta: safeMeta(n.front), val: BASE_SIZE.get(n.front.type) || 4
  }));
  const nodeSet = new Set(nodes.map(n=>n.id));
  const linkKeys = new Set(); const links = [];
  for (const n of notes) {
    const source = nodeId(n.rel);
    for (const ref of n.refs) {
      const target = alias.get(ref.toLowerCase());
      if (!target || target === source || !nodeSet.has(target)) continue;
      const key = `${source}->${target}`;
      if (linkKeys.has(key)) continue;
      linkKeys.add(key); links.push({ source, target });
    }
  }
  const degree = new Map();
  for (const l of links) { degree.set(l.source,(degree.get(l.source)||0)+1); degree.set(l.target,(degree.get(l.target)||0)+1); }
  for (const n of nodes) n.val = Math.min(18, n.val + Math.sqrt(degree.get(n.id)||0));
  const groups = [...new Set(nodes.map(n=>n.group))].sort();
  const graph = { version: 1, generatedAt: new Date().toISOString(), nodes, links, groups };
  graph.hash = hashGraph(graph);
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const tmp = `${outputPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(graph), 'utf8');
    fs.renameSync(tmp, outputPath);
  }
  return graph;
}

// Deterministic text hygiene. Keep semantic Unicode (for example ZWNJ/ZWJ,
// variation selectors and no-break spaces) unless a caller explicitly asks to
// normalize layout spaces. The default pass removes only artifacts that are
// safe for ordinary candidate-facing prose.
const SAFE_INVISIBLE=/[\u00ad\u200b\u2060\ufeff\u202a-\u202e\u2066-\u2069]/g;
const NO_BREAK=/[\u00a0\u2007\u202f]/g;

const META_LINE_PATTERNS=[
  /^\s*(?:here is|here's) (?:the|a) (?:revised|polished|updated|humanized) version:?\s*$/i,
  /^\s*below is (?:a|the) (?:revised|polished|updated|comprehensive) .+?:?\s*$/i,
  /^\s*based on (?:your|the) instructions[:,]?.*$/i,
  /^\s*as (?:an ai|a language model)[:,]?.*$/i,
  /^\s*(?:certainly|absolutely|of course)!?\s*$/i
];

const AUDIT_PATTERNS=[
  ['generic_opening',/\b(?:in today(?:'s|’s)|when it comes to|it is important to (?:note|understand|remember)|at its core)\b/i],
  ['generic_wrapup',/\b(?:in conclusion|to summarize|in summary|the key takeaway|final thoughts)\b/i],
  ['corporate_filler',/\b(?:unlock value|meaningful impact|actionable insights|holistic approach|robust framework|seamless experience|evolving landscape|drive synergies|best-in-class|value-added)\b/i],
  ['promotional_language',/\b(?:game[- ]changing|transformative|revolutionary|world[- ]class|unparalleled|cutting[- ]edge)\b/i],
  ['inflated_significance',/\b(?:pivotal|instrumental|profoundly|underscores the importance)\b/i],
  ['vague_attribution',/\b(?:experts say|research suggests|it is widely believed|many believe)\b/i],
  ['canned_transition',/\b(?:moreover|furthermore|additionally|that said|with that being said)\b/i],
  ['negative_parallelism',/\bnot only\b[\s\S]{0,90}\bbut also\b/i],
  ['generic_job_enthusiasm',/\b(?:incredibly excited|thrilled to contribute|uniquely suited|strong interest in this opportunity)\b/i],
  ['tool_residue',/\b(?:as an ai|language model|based on your instructions|the user asked|requested tone)\b/i],
  ['placeholder',/\[(?:company name|your name|insert [^\]]+|specific [^\]]+)\]|\bTODO\b/i]
];

function normalizeLines(text=''){
  return String(text).replace(/\r\n?/g,'\n').split('\n');
}

export function mechanicalSanitizeText(text='',{normalizeNoBreakSpaces=false}={}){
  let out=String(text).replace(SAFE_INVISIBLE,'');
  if(normalizeNoBreakSpaces)out=out.replace(NO_BREAK,' ');
  return out.replace(/[ \t]+$/gm,'').replace(/\n{4,}/g,'\n\n\n');
}

export const cleanTextArtifacts=mechanicalSanitizeText;

export function stripGeneratedResidue(text=''){
  const lines=normalizeLines(text);
  return lines.filter(line=>!META_LINE_PATTERNS.some(re=>re.test(line))).join('\n');
}

function plainProfessionalReplacements(text,domain){
  let out=text;
  if(domain==='COVER_LETTER'||domain==='APPLICATION_ANSWER'||domain==='OUTREACH'||domain==='FOLLOW_UP'){
    out=out
      .replace(/\bI am writing to express my strong interest in\b/gi,'I am applying for')
      .replace(/\bI would be thrilled to\b/gi,'I would like to')
      .replace(/\bI am incredibly excited (?:about|to)\b/gi,'I am interested in')
      .replace(/\bI hope this message finds you well\.?\s*/gi,'');
  }
  return out;
}

export function humanizeGeneratedText(text='',{domain='GENERAL',normalizeNoBreakSpaces=false}={}){
  let out=mechanicalSanitizeText(text,{normalizeNoBreakSpaces});
  out=stripGeneratedResidue(out);
  out=plainProfessionalReplacements(out,String(domain).toUpperCase());
  out=out.replace(/[ \t]{2,}/g,' ').replace(/\n{3,}/g,'\n\n').trim();
  return out?`${out}\n`:'';
}

export function auditHumanWriting(text=''){
  const source=String(text);
  const findings=[];
  for(const [code,re] of AUDIT_PATTERNS){if(re.test(source))findings.push(code);}
  const invisible=(source.match(SAFE_INVISIBLE)||[]).length;
  if(invisible)findings.push('invisible_unicode');
  return {ok:findings.length===0,findings:[...new Set(findings)]};
}

export function protectFactsSnapshot(text=''){
  const source=String(text);
  return {
    numbers:[...source.matchAll(/\b(?:£|\$|€)?\d+(?:[.,]\d+)?%?\b/g)].map(m=>m[0]),
    emails:[...source.matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)].map(m=>m[0]),
    urls:[...source.matchAll(/https?:\/\/[^\s)]+/gi)].map(m=>m[0]),
    references:[...source.matchAll(/\[[^\]\n]{1,80}\]|\([^\)\n]{1,120}\)/g)].map(m=>m[0])
  };
}

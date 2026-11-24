// Layer A cleaning ported from watermarks-remover (service/scripts/text_unicode.py):
// strips invisible format characters, bidi controls, tag characters and variation
// selectors, and maps exotic spaces to U+0020. Deterministic and safe for CV prose.

const STRIP = new Set([
  0x00ad, 0x034f, 0x061c, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x180b, 0x180c, 0x180d, 0x180e, 0x180f,
  0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
  0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0x2066, 0x2067, 0x2068, 0x2069,
  0x206a, 0x206b, 0x206c, 0x206d, 0x206e, 0x206f, 0xfeff, 0x3164, 0xffa0, 0xfff9, 0xfffa, 0xfffb,
]);
const SPACES = new Set([0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x202f, 0x205f, 0x3000]);
const isStripped = (cp) => STRIP.has(cp) || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0000 && cp <= 0xe007f) || (cp >= 0xe0100 && cp <= 0xe01ef);

export function cleanText(text = '') {
  let removed = 0, replaced = 0, out = '';
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    if (isStripped(cp)) { removed++; continue; }
    if (SPACES.has(cp)) { replaced++; out += ' '; continue; }
    out += ch;
  }
  return { text: out.replace(/[ \t]{2,}/g, ' ').trim(), removed, replaced };
}

// Phrases that read as machine-written or as filler to a recruiter.
const TELLS = [
  ['ai_vocabulary', /\b(?:delve|tapestry|testament to|leverag(?:e|ed|ing)|spearhead(?:ed|ing)?|showcas(?:e|ed|ing)|synerg(?:y|ies)|utili[sz](?:e|ed|ing)|seamless(?:ly)?|robust|cutting[- ]edge|pivotal|holistic|myriad|plethora)\b/i],
  ['empty_enthusiasm', /\b(?:passionate|passion for|thrilled|incredibly excited|excited to apply|dream (?:job|role)|perfect fit|uniquely (?:suited|positioned))\b/i],
  ['cliche', /\b(?:proven track record|results[- ]driven|fast[- ]paced|go[- ]getter|hit the ground running|team player|think outside the box|hard[- ]working|detail[- ]oriented)\b/i],
  ['canned_transition', /\b(?:moreover|furthermore|additionally|in conclusion|in today's|when it comes to|it is worth noting)\b/i],
  ['stock_opening', /\b(?:I am writing to (?:express|apply)|I hope this (?:email|letter|message) finds you)\b/i],
  ['not_only_but_also', /\bnot only\b[\s\S]{0,90}\bbut also\b/i],
  ['em_dash', /—/],
  ['placeholder', /\[(?:[A-Z][^\]]{0,40})\]|\bTODO\b|\bXX+\b/],
];

export function lintProse(text = '') {
  return TELLS.filter(([, re]) => re.test(text)).map(([code, re]) => ({ code, match: String(text).match(re)[0] }));
}

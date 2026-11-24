import { detectGreenhouse } from '../../adapters/greenhouse.mjs';
import { detectAshby } from '../../adapters/ashby.mjs';
import { detectLever } from '../../adapters/lever.mjs';
import { detectWorkday } from '../../adapters/workday.mjs';
import { detectPublicAts } from '../../adapters/publicAts.mjs';

const DIRECT_PUBLIC=new Set(['smartrecruiters','recruitee','personio','breezy']);
export function detectAdapter(url='',kind='AUTO'){
  const k=String(kind||'AUTO').toUpperCase();
  if(k==='RSS')return 'rss';if(k==='SITEMAP')return 'sitemap';if(k==='WORKDAY')return 'workday';
  if(detectGreenhouse(url))return 'greenhouse';if(detectAshby(url))return 'ashby';if(detectLever(url))return 'lever';if(detectWorkday(url))return 'workday';
  const ats=detectPublicAts(url);if(ats)return DIRECT_PUBLIC.has(ats.adapter)?ats.adapter:'public-ats';
  if(/(?:rss|feed)(?:[/?#]|$)/i.test(url))return 'rss';if(/sitemap.*\.xml(?:[?#]|$)/i.test(url))return 'sitemap';return 'playwright';
}

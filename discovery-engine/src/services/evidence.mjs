import { sha256Text } from '../utils/hash.mjs';
import { evidenceRecords } from './professionalFit.mjs';

function categoryFor(e){if(e.section==='EDUCATION')return'education';if(/certif|cisi|epat|cfa|frm|licen[cs]e/i.test(e.exactSourceText))return'certification';if(e.tools?.length)return'tool';if(e.assetClasses?.length||e.products?.length)return'product';if(e.metric?.length)return'metric';return e.domain==='FINANCE'?'financial_experience':'experience';}
export function buildEvidenceLedger(cvText='',meta={}){
 return evidenceRecords(cvText,meta).map(e=>{
   const source={lineNumber:e.lineNumber,section:e.section,employer:e.employer,title:e.title||e.role,startDate:e.startDate,endDate:e.endDate,durationMonths:e.durationMonths,dates:e.dates,function:e.function||e.functions||[],domain:e.domain,domains:e.domains||[],assetClasses:e.assetClasses||[],products:e.products||[],tools:e.tools||[],skills:e.skills||[],leadershipEvidence:e.leadershipEvidence||[],metric:e.metric,sourceCvVersionId:e.sourceCvVersionId,sourceDocumentSha:e.sourceDocumentSha,sourceDocumentName:e.sourceDocumentName,sourceFingerprint:e.sourceFingerprint};
   const fingerprint=e.sourceFingerprint||sha256Text(JSON.stringify({text:e.exactSourceText.toLowerCase(),sourceDocumentSha:e.sourceDocumentSha||'',lineNumber:e.lineNumber}));
   return {category:categoryFor(e),claim:e.exactSourceText,sourceText:e.exactSourceText,sourceRef:JSON.stringify(source),fingerprint,...source};
 });
}

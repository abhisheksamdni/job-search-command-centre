import fs from 'node:fs';
import path from 'node:path';
import { createAtsDocx,createAtsPdf,fileSha256 } from './cvRenderer.mjs';
import { createTemplatePreservedDocx,convertTemplateDocxToPdf } from './docxTemplate.mjs';

export async function createTailoredCvOutputsPreservingTemplate({text,basePath,sourcePath=null,keyTerms=[],lineChanges=[]}){
 const previewPath=`${basePath}.md`;fs.mkdirSync(path.dirname(previewPath),{recursive:true});fs.writeFileSync(previewPath,String(text||''),'utf8');const preview={path:previewPath,sha256:fileSha256(previewPath),format:'MD',mimeType:'text/markdown',renderer:'text'};
 const warnings=[];let docx,templatePreserved=false;const docxPath=`${basePath}.docx`,pdfPath=`${basePath}.pdf`;
 if(sourcePath&&path.extname(sourcePath).toLowerCase()==='.docx'&&fs.existsSync(sourcePath)){
  try{docx=createTemplatePreservedDocx({sourcePath,outPath:docxPath,keyTerms,lineChanges});if(docx.unappliedChanges?.length){warnings.push(`Master DOCX template could not apply ${docx.unappliedChanges.length} verified content change(s); used ATS renderer instead.`);try{fs.rmSync(docxPath,{force:true});}catch{}docx=null;}else templatePreserved=true;}catch(e){warnings.push(`Master DOCX template preservation failed; used ATS renderer: ${e.message}`);}
 }
 if(!docx){docx=await createAtsDocx({text,outPath:docxPath});if(docx.warning)warnings.push(docx.warning);}
 let pdf;
 if(templatePreserved){try{pdf=await convertTemplateDocxToPdf({docxPath,pdfPath});}catch(e){warnings.push(`${e.message}; generated ATS PDF fallback while keeping the template-preserved DOCX.`);}}
 if(!pdf){pdf=await createAtsPdf({text,outPath:pdfPath});if(pdf.warning)warnings.push(pdf.warning);}
 const files=[docx,pdf,preview];const templateSha256=sourcePath&&fs.existsSync(sourcePath)?fileSha256(sourcePath):null;return {preview,docx,pdf,primary:docx,files,warnings,templateSource:sourcePath||null,templatePreserved,pdfTemplatePreserved:['microsoft-word-template','libreoffice-template'].includes(pdf.renderer),renderer:pdf.renderer,renderDelta:{docxSha256:docx.sha256,pdfSha256:pdf.sha256,templateSha256,docxChangedFromTemplate:Boolean(templateSha256&&templateSha256!==docx.sha256)}};
}

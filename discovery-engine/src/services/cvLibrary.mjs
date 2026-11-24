import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { paths } from '../paths.mjs';
import { safeJoin, slugify } from '../security.mjs';
import { buildEvidenceLedger } from './evidence.mjs';
import { syncCvKnowledge } from '../knowledgeVault.mjs';

export const PDF_EXTRACTION_MESSAGE='Could not read this PDF. The file was received, but text extraction failed.';

async function extractPdf(buffer){
  let parser;
  try{
    const { PDFParse }=await import('pdf-parse');
    if(typeof PDFParse!=='function')throw new TypeError('pdf-parse implementation did not export PDFParse');
    parser=new PDFParse({data:buffer});
    const result=await parser.getText();
    const text=result?.text||'';
    if(!text.trim())throw new Error('PDF contains no extractable text');
    return text;
  }catch(cause){
    console.error(`[cvLibrary] PDF text extraction failed: ${cause?.stack||cause?.message||String(cause)}`);
    const error=new Error(PDF_EXTRACTION_MESSAGE,{cause});
    error.code='CV_PDF_EXTRACTION_FAILED';
    throw error;
  }finally{
    await parser?.destroy();
  }
}
async function extractDocx(buffer){const m=await import('mammoth');return (await m.extractRawText({buffer})).value||'';}
function mimeFor(ext){return ext==='.pdf'?'application/pdf':ext==='.docx'?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':ext==='.md'?'text/markdown':'text/plain';}
export async function extractText(buffer,filename){const ext=path.extname(filename).toLowerCase();if(ext==='.pdf')return extractPdf(buffer);if(ext==='.docx')return extractDocx(buffer);if(['.txt','.md'].includes(ext))return buffer.toString('utf8');throw new Error('Only PDF, DOCX, TXT, and MD are supported');}

export async function importCv(db,{buffer,filename,isMaster=true,isActive=true}){
  fs.mkdirSync(paths.cvMaster,{recursive:true});const hash=crypto.createHash('sha256').update(buffer).digest('hex');const ext=path.extname(filename).toLowerCase();const text=await extractText(buffer,filename);const candidateStored=safeJoin(paths.cvMaster,`${Date.now()}__${slugify(path.basename(filename,ext))}${ext}`);
  let wroteStored=false,committed=false,doc,versionId,label;
  db.exec('BEGIN');
  try{
    doc=db.prepare('SELECT * FROM cv_documents WHERE sha256=?').get(hash);
    if(!doc){fs.writeFileSync(candidateStored,buffer);wroteStored=true;const r=db.prepare('INSERT INTO cv_documents(original_filename,stored_path,sha256,mime_type,extracted_text) VALUES (?,?,?,?,?)').run(filename,candidateStored,hash,mimeFor(ext),text);doc=db.prepare('SELECT * FROM cv_documents WHERE id=?').get(Number(r.lastInsertRowid));}
    if(isActive)db.prepare('UPDATE cv_versions SET is_active=0').run();
    label=`CV-${new Date().toISOString().replace(/[:.]/g,'-')}`;const r=db.prepare('INSERT INTO cv_versions(document_id,version_label,is_master,is_active) VALUES (?,?,?,?)').run(doc.id,label,isMaster?1:0,isActive?1:0);versionId=Number(r.lastInsertRowid);
    db.prepare('INSERT OR IGNORE INTO cv_version_files(cv_version_id,format,path,sha256,mime_type,is_primary) VALUES (?,?,?,?,?,1)').run(versionId,ext.slice(1).toUpperCase()||'SOURCE',doc.stored_path,doc.sha256,doc.mime_type);
    const ins=db.prepare('INSERT OR IGNORE INTO evidence_ledger(cv_version_id,category,claim,source_text,source_ref,fingerprint) VALUES (?,?,?,?,?,?)');
    for(const e of buildEvidenceLedger(text,{cvVersionId:versionId,documentSha:doc.sha256,documentName:doc.original_filename}))ins.run(versionId,e.category,e.claim,e.sourceText,e.sourceRef,e.fingerprint);
    db.exec('COMMIT');committed=true;
  }catch(e){if(!committed){try{db.exec('ROLLBACK');}catch{}}if(wroteStored){try{fs.rmSync(candidateStored,{force:true});}catch{}}throw e;}
  syncCvKnowledge(db,versionId);return {documentId:doc.id,versionId,label,textLength:text.length,storedPath:doc.stored_path};
}
export function activeCv(db){return db.prepare(`SELECT v.*,d.original_filename,d.stored_path,d.extracted_text,d.sha256,d.mime_type FROM cv_versions v JOIN cv_documents d ON d.id=v.document_id WHERE v.is_active=1 ORDER BY v.id DESC LIMIT 1`).get();}
export function activeMasterCv(db){return db.prepare(`SELECT v.*,d.original_filename,d.stored_path,d.extracted_text,d.sha256,d.mime_type FROM cv_versions v JOIN cv_documents d ON d.id=v.document_id WHERE v.is_master=1 AND v.is_active=1 ORDER BY v.id DESC LIMIT 1`).get()||db.prepare(`SELECT v.*,d.original_filename,d.stored_path,d.extracted_text,d.sha256,d.mime_type FROM cv_versions v JOIN cv_documents d ON d.id=v.document_id WHERE v.is_master=1 ORDER BY v.id DESC LIMIT 1`).get();}
export function activeMasterTemplate(db){
 const configured=Number(db.prepare("SELECT value FROM settings WHERE key='master_template_cv_version_id'").get()?.value||0);if(configured){const row=db.prepare(`SELECT v.*,d.original_filename,d.stored_path,d.sha256,d.mime_type FROM cv_versions v JOIN cv_documents d ON d.id=v.document_id WHERE v.id=? AND v.is_master=1`).get(configured);if(row&&/\.docx$/i.test(row.original_filename||row.stored_path||''))return row;}
 return db.prepare(`SELECT v.*,d.original_filename,d.stored_path,d.sha256,d.mime_type FROM cv_versions v JOIN cv_documents d ON d.id=v.document_id WHERE v.is_master=1 AND lower(d.original_filename) LIKE '%.docx' ORDER BY v.is_active DESC,v.id DESC LIMIT 1`).get()||null;
}
export function setMasterTemplate(db,cvVersionId){const row=db.prepare(`SELECT v.*,d.original_filename,d.stored_path FROM cv_versions v JOIN cv_documents d ON d.id=v.document_id WHERE v.id=? AND v.is_master=1`).get(Number(cvVersionId));if(!row)throw new Error('Master CV version not found');if(!/\.docx$/i.test(row.original_filename||row.stored_path||''))throw new Error('Formatting template must be a Master DOCX version');db.prepare(`INSERT INTO settings(key,value) VALUES ('master_template_cv_version_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP`).run(String(row.id));return row;}

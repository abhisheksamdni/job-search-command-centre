import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync=promisify(execFile);

const EOCD=0x06054b50, CENTRAL=0x02014b50, LOCAL=0x04034b50;
const CRC_TABLE=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
function crc32(buf){let c=0xffffffff;for(const b of buf)c=CRC_TABLE[(c^b)&0xff]^(c>>>8);return (c^0xffffffff)>>>0;}
function fileHash(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function findEocd(buf){const min=Math.max(0,buf.length-0xffff-22);for(let i=buf.length-22;i>=min;i--)if(buf.readUInt32LE(i)===EOCD)return i;throw new Error('DOCX ZIP end record not found');}
function decodeXml(s=''){return String(s).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');}

export function readZipEntries(buffer){
 const eocd=findEocd(buffer);const total=buffer.readUInt16LE(eocd+10);let off=buffer.readUInt32LE(eocd+16);const entries=[];
 for(let i=0;i<total;i++){
  if(buffer.readUInt32LE(off)!==CENTRAL)throw new Error('Invalid DOCX central directory');
  const flags=buffer.readUInt16LE(off+8),method=buffer.readUInt16LE(off+10),compressed=buffer.readUInt32LE(off+20),size=buffer.readUInt32LE(off+24),nameLen=buffer.readUInt16LE(off+28),extraLen=buffer.readUInt16LE(off+30),commentLen=buffer.readUInt16LE(off+32),localOffset=buffer.readUInt32LE(off+42);const name=buffer.subarray(off+46,off+46+nameLen).toString('utf8');
  if(flags&1)throw new Error('Encrypted DOCX entries are not supported');
  if(buffer.readUInt32LE(localOffset)!==LOCAL)throw new Error(`Invalid local ZIP entry: ${name}`);const localNameLen=buffer.readUInt16LE(localOffset+26),localExtraLen=buffer.readUInt16LE(localOffset+28);const start=localOffset+30+localNameLen+localExtraLen;const packed=buffer.subarray(start,start+compressed);let data;if(method===0)data=Buffer.from(packed);else if(method===8)data=zlib.inflateRawSync(packed);else throw new Error(`Unsupported DOCX compression method ${method}: ${name}`);if(data.length!==size)throw new Error(`DOCX entry size mismatch: ${name}`);entries.push([name,data]);off+=46+nameLen+extraLen+commentLen;
 }
 return entries;
}
function dosDateTime(date=new Date()){const year=Math.max(1980,date.getFullYear());return {time:(date.getHours()<<11)|(date.getMinutes()<<5)|(date.getSeconds()>>1),day:((year-1980)<<9)|((date.getMonth()+1)<<5)|date.getDate()};}
export function writeZipStore(entries){const locals=[],central=[];let offset=0;const {time,day}=dosDateTime();for(const [name,value] of entries){const filename=Buffer.from(name,'utf8'),data=Buffer.isBuffer(value)?value:Buffer.from(value),crc=crc32(data);const local=Buffer.alloc(30);local.writeUInt32LE(LOCAL,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0,6);local.writeUInt16LE(0,8);local.writeUInt16LE(time,10);local.writeUInt16LE(day,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(filename.length,26);locals.push(local,filename,data);const cen=Buffer.alloc(46);cen.writeUInt32LE(CENTRAL,0);cen.writeUInt16LE(20,4);cen.writeUInt16LE(20,6);cen.writeUInt16LE(0,8);cen.writeUInt16LE(0,10);cen.writeUInt16LE(time,12);cen.writeUInt16LE(day,14);cen.writeUInt32LE(crc,16);cen.writeUInt32LE(data.length,20);cen.writeUInt32LE(data.length,24);cen.writeUInt16LE(filename.length,28);cen.writeUInt32LE(offset,42);central.push(cen,filename);offset+=30+filename.length+data.length;}const cb=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(EOCD,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(cb.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,cb,end]);}

function paragraphText(xml=''){return decodeXml([...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m=>m[1]).join('')).replace(/\s+/g,' ').trim();}
function encodeXml(s=''){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
function replaceParagraphText(xml,newText){const matches=[...xml.matchAll(/<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>/g)];if(!matches.length)return xml;const lens=matches.map(m=>Math.max(1,decodeXml(m[2]).length)),total=lens.reduce((a,b)=>a+b,0);let used=0,cursor=0,out='';for(let i=0;i<matches.length;i++){const m=matches[i];out+=xml.slice(cursor,m.index);const remaining=String(newText).length-used,share=i===matches.length-1?remaining:Math.max(0,Math.min(remaining,Math.round(String(newText).length*lens[i]/total)));const part=String(newText).slice(used,used+share);used+=share;let attrs=m[1]||'';if(/^\s|\s$/.test(part)&&!/xml:space=/i.test(attrs))attrs+=' xml:space="preserve"';out+='<w:t'+attrs+'>'+encodeXml(part)+'</w:t>';cursor=m.index+m[0].length;}return out+xml.slice(cursor);}
export function applyTemplateLineChanges(documentXml,lineChanges=[]){let xml=documentXml;const applied=[],unapplied=[];for(const change of lineChanges||[]){const before=String(change?.before||change?.source||'').replace(/^\s*[•●▪◦*-]\s+/,'').replace(/\s+/g,' ').trim(),after=String(change?.after||'').replace(/^\s*[•●▪◦*-]\s+/,'').trim();if(!before||!after||before===after)continue;const matches=[...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)],hit=matches.find(m=>paragraphText(m[0])===before);if(!hit){unapplied.push(change);continue;}const replacement=replaceParagraphText(hit[0],after);xml=xml.slice(0,hit.index)+replacement+xml.slice(hit.index+hit[0].length);applied.push(change);}return{xml,applied,unapplied};}
function bulletLike(xml=''){return /<w:numPr\b/i.test(xml)||/^[•●▪◦*-]\s+/.test(paragraphText(xml));}
function datedHeading(text=''){return /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}\s*(?:[-–—]|to)\s*(?:Present|Current|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4})\b/i.test(text);}
function employerAnchor(paras,index){const current=paras[index],previous=paras[index-1];if(!current||!previous||!bulletLike(current.xml)||bulletLike(previous.xml))return false;const text=current.text.trim();return datedHeading(previous.text)&&text.length>1&&text.length<130&&!/[.!?]$/.test(text);}
function score(text,keyTerms){const lower=text.toLowerCase();return (keyTerms||[]).reduce((n,k)=>n+(lower.includes(String(k).toLowerCase())?1:0),0);}
export function reorderTemplateBullets(documentXml,keyTerms=[]){
 const re=/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;const matches=[...documentXml.matchAll(re)];if(!matches.length)return {xml:documentXml,reorderedGroups:0};let cursor=0;const segments=[];for(const m of matches){segments.push(documentXml.slice(cursor,m.index),m[0]);cursor=m.index+m[0].length;}segments.push(documentXml.slice(cursor));
 const paras=[];for(let i=1;i<segments.length;i+=2)paras.push({segmentIndex:i,xml:segments[i],text:paragraphText(segments[i])});let groups=0;
 for(let i=0;i<paras.length;){if(!bulletLike(paras[i].xml)||employerAnchor(paras,i)){i++;continue;}let j=i;while(j<paras.length&&bulletLike(paras[j].xml)&&!employerAnchor(paras,j))j++;if(j-i>1){const sorted=paras.slice(i,j).map((p,index)=>({...p,index,s:score(p.text,keyTerms)})).sort((a,b)=>b.s-a.s||a.index-b.index);for(let k=0;k<sorted.length;k++)segments[paras[i+k].segmentIndex]=sorted[k].xml;groups++;}i=j;}
 return {xml:segments.join(''),reorderedGroups:groups};
}

export function createTemplatePreservedDocx({sourcePath,outPath,keyTerms=[],lineChanges=[]}){
 if(path.extname(sourcePath||'').toLowerCase()!=='.docx')throw new Error('Template preservation requires a DOCX Master CV');
 const entries=readZipEntries(fs.readFileSync(sourcePath));const idx=entries.findIndex(([name])=>name==='word/document.xml');if(idx<0)throw new Error('Master DOCX has no word/document.xml');const original=entries[idx][1].toString('utf8');const applied=applyTemplateLineChanges(original,lineChanges);const changed=reorderTemplateBullets(applied.xml,keyTerms);entries[idx]=['word/document.xml',Buffer.from(changed.xml,'utf8')];fs.mkdirSync(path.dirname(outPath),{recursive:true});fs.writeFileSync(outPath,writeZipStore(entries));return {path:outPath,sha256:fileHash(outPath),format:'DOCX',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',renderer:'master-template-openxml',templateSource:sourcePath,reorderedGroups:changed.reorderedGroups,appliedChanges:applied.applied.length,unappliedChanges:applied.unapplied};
}

async function convertWithWord(docxPath,pdfPath){
 if(process.platform!=='win32')throw new Error('Microsoft Word conversion is Windows-only');
 const q=s=>`'${String(s).replace(/'/g,"''")}'`;const script=`$ErrorActionPreference='Stop'; $w=New-Object -ComObject Word.Application; $w.Visible=$false; try { $d=$w.Documents.Open(${q(path.resolve(docxPath))},$false,$true); $d.ExportAsFixedFormat(${q(path.resolve(pdfPath))},17); $d.Close($false) } finally { $w.Quit() }`;
 await execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{timeout:60000,windowsHide:true,maxBuffer:1024*1024});if(!fs.existsSync(pdfPath)||fs.statSync(pdfPath).size<1000)throw new Error('Microsoft Word did not create a valid PDF');return {path:pdfPath,sha256:fileHash(pdfPath),format:'PDF',mimeType:'application/pdf',renderer:'microsoft-word-template'};
}
async function convertWithLibreOffice(docxPath,pdfPath){
 const outDir=path.dirname(pdfPath),target=path.join(outDir,`${path.basename(docxPath,path.extname(docxPath))}.pdf`);let last;for(const exe of ['soffice','libreoffice']){try{await execFileAsync(exe,['--headless','--convert-to','pdf','--outdir',outDir,docxPath],{timeout:60000,windowsHide:true,maxBuffer:1024*1024});if(fs.existsSync(target)){if(target!==pdfPath)fs.renameSync(target,pdfPath);return {path:pdfPath,sha256:fileHash(pdfPath),format:'PDF',mimeType:'application/pdf',renderer:'libreoffice-template'};}}catch(e){last=e;}}throw last||new Error('LibreOffice unavailable');
}
export async function convertTemplateDocxToPdf({docxPath,pdfPath}){try{return await convertWithWord(docxPath,pdfPath);}catch(wordError){try{return await convertWithLibreOffice(docxPath,pdfPath);}catch(loError){throw new Error(`Template PDF conversion unavailable: ${wordError.message}; ${loError.message}`);}}}

import fs from 'node:fs';
import path from 'node:path';
import { ensureApplication } from './applicationTracker.mjs';
import { humanizeGeneratedText,auditHumanWriting } from './textHumanizer.mjs';
import { verifyDraftFacts } from './integrity.mjs';
import { sha256File } from '../utils/hash.mjs';
import { currentConfirmationFacts,applicationCvCandidate } from './readyGate.mjs';

function safe(v=''){return String(v??'').trim();}
function write(file,content){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content,'utf8');return file;}
function latestAnalysis(db,jobId,type){const r=db.prepare('SELECT * FROM job_analysis WHERE job_id=? AND analysis_type=? ORDER BY id DESC LIMIT 1').get(jobId,type);if(!r)return null;try{return {...r,payload:JSON.parse(r.payload_json||'{}')};}catch{return {...r,payload:{}};}}
function context(db,jobId){
  const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);if(!job)throw new Error('Job not found');
  const jd=db.prepare('SELECT * FROM job_jd_versions WHERE job_id=? ORDER BY id DESC LIMIT 1').get(jobId);
  const selected=applicationCvCandidate(db,jobId),cv=selected?db.prepare('SELECT v.*,d.extracted_text,d.original_filename,d.sha256,d.stored_path,d.mime_type FROM cv_versions v JOIN cv_documents d ON d.id=v.document_id WHERE v.id=?').get(selected.cvVersionId):null
    ||db.prepare('SELECT v.*,d.extracted_text,d.original_filename,d.sha256 FROM cv_versions v JOIN cv_documents d ON d.id=v.document_id WHERE v.is_master=1 AND v.is_active=1 ORDER BY v.id DESC LIMIT 1').get()
    ||db.prepare('SELECT v.*,d.extracted_text,d.original_filename,d.sha256 FROM cv_versions v JOIN cv_documents d ON d.id=v.document_id WHERE v.is_active=1 ORDER BY v.id DESC LIMIT 1').get();
  const profile=db.prepare('SELECT * FROM candidate_profile WHERE id=1').get()||{};
  const requirements=db.prepare("SELECT category,text FROM requirements WHERE job_id=? ORDER BY CASE category WHEN 'MANDATORY' THEN 0 WHEN 'CORE' THEN 1 WHEN 'IMPORTANT' THEN 2 ELSE 3 END,id").all(jobId);
  return {job,jd,cv,applicationCv:selected,profile,requirements,recruiter:latestAnalysis(db,jobId,'RECRUITER'),ats:latestAnalysis(db,jobId,'ATS_EXACT')};
}
function stageReviewCv(ctx,folder){
  const files=ctx.applicationCv?.files?.length?ctx.applicationCv.files:(ctx.cv?.stored_path?[{path:ctx.cv.stored_path,format:path.extname(ctx.cv.stored_path).slice(1).toUpperCase(),sha256:ctx.cv.sha256}]:[]),staged=[];
  for(const file of files){if(!file?.path||!fs.existsSync(file.path))continue;const ext=path.extname(file.path).toLowerCase()||'.'+String(file.format||'source').toLowerCase(),dest=path.join(folder,'CV','review-cv'+ext);fs.copyFileSync(file.path,dest);staged.push({path:dest,sourcePath:file.path,sha256:file.sha256||sha256File(file.path),format:file.format||ext.slice(1).toUpperCase()});}
  if(staged.length)write(path.join(folder,'CV','review-cv-manifest.json'),JSON.stringify({cvVersionId:ctx.cv?.id||null,mode:ctx.applicationCv?.mode||'MASTER_FALLBACK',files:staged},null,2)+'\n');
  return staged;
}
function words(s=''){return[...new Set(String(s).toLowerCase().replace(/[^a-z0-9+.# ]/g,' ').split(/\s+/).filter(x=>x.length>3))];}
function cvStructuralLine(line=''){
  const value=safe(line);
  if(!value)return false;
  if(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}\s*(?:[-–—]|to)\s*(?:Present|Current|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4})\b/i.test(value))return true;
  if(/\b(?:Ltd\.?|Limited|LLP|LLC|PLC|Inc\.?|Capital|Bank|University|Partners?|Group|Consulting|Management)\b/i.test(value)&&value.length<120&&!/[.!?]$/.test(value))return true;
  if(/\b(?:Analyst|Associate|Trader|Manager|Director|Consultant|Intern|Engineer|Researcher|Specialist|Officer)\b/i.test(value)&&value.length<140&&!/[.!?]$/.test(value))return true;
  return false;
}
function cvEvidenceUnits(cvText=''){
  const lines=String(cvText||'').replace(/\r\n?/g,'\n').split('\n'),bullets=[],prose=[];let current='';
  const flush=()=>{const value=cleanEvidence(current);if(value.length>=30)bullets.push(value);current='';};
  for(const raw of lines){const line=safe(raw);if(!line){flush();continue;}if(/^(?:profile|summary|professional summary|work experience|experience|employment|education|skills|certifications?|certificates|projects?|research experience(?: and projects?)?|achievements?|awards?|languages?|extracurricular activities)$/i.test(line)){flush();continue;}if(/^[•●▪◦*-]\s+/.test(line)){flush();current=line.replace(/^[•●▪◦*-]\s+/,'');continue;}if(current){if(cvStructuralLine(line)){flush();continue;}current+=' '+line;continue;}if(/[.!?]$/.test(line)&&line.length>=50)prose.push(cleanEvidence(line));}
  flush();return [...new Set(bullets.length?bullets:prose)];
}
function cvTechnicalUnits(cvText=''){const explicit=/\b(?:python|sql|excel|vba|c\+\+|matlab|bloomberg|reuters|refinitiv|power bi|tableau)\b/i,lines=String(cvText||'').replace(/\r\n?/g,'\n').split('\n').map(cleanEvidence).filter(x=>x.length>=12&&x.length<=360&&explicit.test(x));return [...new Set([...cvEvidenceUnits(cvText),...lines])];}
function roleEvidenceBonus(job,line=''){const family=safe(job?.role_family).toUpperCase(),text=line.toLowerCase();if(family==='TRADING'){let score=/\b(?:execut(?:e|ed|ion)|trad(?:e|ed|ing)|p&l|order-book|liquidity|portfolio exposure|risk checks?)\b/i.test(text)?5:0;score+=/\b(?:market|derivatives?|futures?|options?|portfolio|risk)\b/i.test(text)?2:0;score-=/\b(?:factory|android|inventory|production|purchasing|delivery)\b/i.test(text)?8:0;score-=/^mentored\b/i.test(text)?2:0;return score;}if(family.includes('INVESTMENT')||family.includes('RESEARCH'))return /\b(?:investment|research|valuation|portfolio|market|analysis|model)\b/i.test(text)?3:0;return 0;}
function topEvidence(cvText,jdText,max=4,job=null){const keys=words(jdText);return cvEvidenceUnits(cvText).map((line,i)=>({line,i,score:keys.reduce((n,k)=>n+(line.toLowerCase().includes(k)?1:0),0)+roleEvidenceBonus(job,line)})).sort((a,b)=>b.score-a.score||a.i-b.i).slice(0,max).map(x=>x.line);}
function recruiterEvidence(ctx){const strengths=ctx.recruiter?.payload?.topStrengths||[],units=cvEvidenceUnits(ctx.cv?.extracted_text),out=[];for(const item of strengths){const fragment=cleanEvidence(item?.evidenceText||item?.evidence||'').toLowerCase();if(!fragment)continue;const line=units.find(x=>x.toLowerCase().includes(fragment)||fragment.includes(x.toLowerCase()));if(line&&!out.includes(line))out.push(line);}return out;}
function contactForJob(db,jobId,contactId=null){if(contactId)return db.prepare('SELECT c.* FROM contacts c JOIN job_contacts jc ON jc.contact_id=c.id WHERE jc.job_id=? AND c.id=?').get(jobId,contactId);return db.prepare('SELECT c.* FROM contacts c JOIN job_contacts jc ON jc.contact_id=c.id WHERE jc.job_id=? ORDER BY c.id DESC LIMIT 1').get(jobId);}
function contactConfirmed(c){if(!c?.name)return false;if(c.relationship!=='AUTO_DISCOVERED_UNCONFIRMED')return true;try{const n=JSON.parse(c.notes||'{}');return n.confirmed===true&&['USER_CONFIRMED','SOURCE_CONFIRMED'].includes(n.confirmationState);}catch{return false;}}
function evidenceText({job,jd,cv,profile,contact=null,extra='',recruiter=null,ats=null}){return[job?.company,job?.title,job?.location_raw,jd?.jd_clean,cv?.extracted_text,profile?.name,contact?.name,contact?.role,extra,JSON.stringify(recruiter?.payload||{}),JSON.stringify(ats?.payload||{})].filter(Boolean).join('\n');}
function finalize(raw,domain,evidence){
  const text=humanizeGeneratedText(raw,{domain});const audit=auditHumanWriting(text);const blocking=audit.findings.filter(x=>['tool_residue','placeholder','invisible_unicode'].includes(x));
  if(blocking.length)throw new Error('Writing hygiene failed: '+blocking.join(', '));
  const facts=verifyDraftFacts({draftText:text,evidenceText:evidence});if(facts.integrity!=='PASS')throw new Error('Writing integrity failed: '+facts.unsupportedClaims.map(x=>x.reason).join('; '));
  return {text,verification:{...facts,humanizerAudit:audit,verifierRanAfterHumanizer:true}};
}
function cleanEvidence(line=''){return safe(line).replace(/^[•●▪◦*-]\s*/,'').replace(/([A-Za-z])-\s+([A-Za-z])/g,'$1-$2').replace(/[.!?]+$/,'');}
function gerundEvidence(line=''){
  const s=cleanEvidence(line),verbs=[['Executed','executing'],['Traded','trading'],['Managed','managing'],['Analysed','analysing'],['Analyzed','analysing'],['Monitored','monitoring'],['Developed','developing'],['Built','building'],['Improved','improving'],['Processed','processing'],['Mentored','mentoring'],['Contributed','contributing'],['Supported','supporting'],['Prepared','preparing'],['Reconciled','reconciling'],['Identified','identifying'],['Demonstrated','demonstrating'],['Implemented','implementing'],['Converted','converting'],['Collaborated','collaborating'],['Designed','designing'],['Performed','performing']];
  if(/^(?:extending|designing|building|using|developing|creating|preparing|monitoring|analysing|analyzing|managing)\b/i.test(s))return s.charAt(0).toLowerCase()+s.slice(1);
  for(const pair of verbs)if(s.startsWith(pair[0]+' '))return pair[1]+' '+s.slice(pair[0].length+1);
  return s?'work involving '+s.charAt(0).toLowerCase()+s.slice(1):'relevant work documented in the selected CV';
}
function focusPhrase(value=''){const s=cleanEvidence(value),verbs=[['Support','supporting'],['Coordinate','coordinating'],['Assist','assisting'],['Work','working'],['Contribute','contributing'],['Evaluate','evaluating'],['Perform','performing'],['Prepare','preparing'],['Manage','managing'],['Monitor','monitoring'],['Oversee','overseeing'],['Optimise','optimising'],['Optimize','optimising'],['Develop','developing'],['Execute','executing'],['Analyse','analysing'],['Analyze','analysing']];for(const [verb,gerund] of verbs)if(s.startsWith(verb+' '))return gerund+' '+s.slice(verb.length+1);return s?s.charAt(0).toLowerCase()+s.slice(1):s;}
function usableRoleFocus(value=''){const s=safe(value);if(s.length<12||s.length>220)return false;return !/\b(?:excellent|exciting|unique|fantastic) opportunity\b|\bjoin (?:a|an|the) (?:highly regarded|leading|dynamic|growing)\b|^(?:this is|we are|our client is|about (?:us|the company)|company overview)\b/i.test(s);}
function roleFocus(ctx,max=2){const inventory=ctx.recruiter?.payload?.jdMasterKeywordInventory||[],ranked=inventory.filter(x=>x.candidateRelevant!==false&&x.informationClass==='CORE_JOB_ACTIVITY'&&['CORE','IMPORTANT'].includes(x.category)).sort((a,b)=>Number(/responsibil/i.test(b.sourceSection||''))-Number(/responsibil/i.test(a.sourceSection||''))||Number(b.importance||0)-Number(a.importance||0)).map(x=>safe(x.cleanText||x.originalText)).filter(usableRoleFocus);if(ranked.length)return [...new Set(ranked)].slice(0,max);const rows=(ctx.requirements||[]).filter(x=>['CORE','IMPORTANT'].includes(x.category)).map(x=>safe(x.text)).filter(usableRoleFocus);if(rows.length)return rows.slice(0,max);return safe(ctx.jd?.jd_clean).split(/\n|[.;]/).map(x=>safe(x)).filter(x=>x.length>=20&&x.length<=180&&usableRoleFocus(x)).slice(0,max);}
function candidateName(ctx){const configured=safe(ctx.profile?.name);if(configured)return configured;const headings=/^(?:profile|summary|work experience|experience|education|skills|certifications?|projects?|languages?)$/i;for(const raw of safe(ctx.cv?.extracted_text).split(/\r?\n/).slice(0,6)){const line=safe(raw);if(!line||headings.test(line)||line.includes('@')||/\d/.test(line))continue;if(/^[\p{L}][\p{L}'’-]+(?:\s+[\p{L}][\p{L}'’-]+){1,4}$/u.test(line))return line;}return '';}
function firstPersonEvidence(line=''){
  const source=cleanEvidence(line);if(!source)return 'I have relevant experience documented in the selected CV.';
  return source.split(/(?<=[.!?])\s+/).filter(Boolean).map(value=>{const s=safe(value);if(/^I\b/i.test(s))return /[.!?]$/.test(s)?s:s+'.';const body=s.charAt(0).toLowerCase()+s.slice(1).replace(/[.!?]*$/,'');if(/^(?:designing|building|using|extending|developing|creating|preparing|monitoring|analysing|analyzing|managing)\b/i.test(s))return 'I am '+body+'.';if(/^trading professional\b/i.test(s))return 'My background includes '+body+'.';return 'I '+body+'.';}).join(' ');
}
function explicitCoverLimit(jdText=''){const source=safe(jdText),m=source.match(/cover\s+letter[\s\S]{0,160}?\b(?:maximum|max(?:imum)?|limit(?:ed)?\s+to|no\s+more\s+than|under)?\s*(\d{2,4})\s+words?\b/i);if(!m)return null;const n=Number(m[1]);return n>=80&&n<=1500?n:null;}
function countWords(s=''){return safe(s).split(/\s+/).filter(Boolean).length;}
function coverLetterDraft(ctx,evidence){
  const job=ctx.job,name=candidateName(ctx),focus=roleFocus(ctx,2),brief=value=>{const terms=safe(value).split(/\s+/).filter(Boolean);return terms.length>22?terms.slice(0,22).join(' '):safe(value);},f1=focusPhrase(brief(focus[0]))||'the role’s core trading responsibilities',f2=focusPhrase(brief(focus[1]))||'research, analysis and disciplined execution',s1=firstPersonEvidence(evidence[0]),s2=firstPersonEvidence(evidence[1]||evidence[0]),s3=evidence[2]?firstPersonEvidence(evidence[2]):null;
  const paragraphs=[
    'I am applying for the '+job.title+' role at '+job.company+'. The role’s focus on '+f1+', alongside '+f2+', aligns with my practical background in trading, market analysis and risk-aware decision-making. I am particularly interested in a trading role where I can contribute established experience while continuing to develop within a structured environment.',
    'My experience provides relevant evidence for these responsibilities. '+s1+' '+s2+' This work required timely judgement, attention to market conditions and disciplined handling of risk and execution considerations. It also gave me experience translating market observations into decisions and communicating the reasoning behind them.',
    (s3?s3+' ':'')+'Alongside my trading experience, my CV documents analytical and technical work that supports research-led decision-making. I have used market data, structured analysis and technology-enabled research to examine trading ideas and changing market conditions. This background is relevant to the role’s combination of desk support, analysis and development of trading opportunities.',
    'I would bring a grounded understanding of financial markets, a willingness to take ownership and a clear appreciation of the controls required around trading activity. I would also approach the role with the discipline to distinguish between what I already know and what I still need to learn, which I believe is important in an early-career trading position.',
    'I would welcome the opportunity to discuss how my experience relates to the '+job.title+' position. Thank you for considering my application.'
  ];
  const compose=selected=>'# Cover Letter — '+job.company+' / '+job.title+'\n\nDear Hiring Team,\n\n'+selected.join('\n\n')+'\n\nKind regards'+(name?'\n'+name:''),limit=explicitCoverLimit(ctx.jd?.jd_clean);let selected=paragraphs;if(limit&&limit<250)selected=[paragraphs[0],paragraphs[1],paragraphs[4]];if(!limit&&countWords(compose(selected))>400){const candidates=[[paragraphs[0],paragraphs[1],paragraphs[2],paragraphs[4]],[paragraphs[0],paragraphs[1],paragraphs[3],paragraphs[4]],[paragraphs[0],paragraphs[1],paragraphs[4]]];selected=candidates.find(x=>{const n=countWords(compose(x));return n>=250&&n<=400;})||candidates[0];}let body=selected.join('\n\n');
  if(limit&&countWords(body)>limit){const ps=selected.slice();while(ps.length>2&&countWords(ps.join('\n\n'))>limit)ps.splice(ps.length-2,1);body=ps.join('\n\n');}
  return '# Cover Letter — '+job.company+' / '+job.title+'\n\nDear Hiring Team,\n\n'+body+'\n\nKind regards'+(name?'\n'+name:'');
}
function riskSections(db){
  const values=currentConfirmationFacts(db).values,marker='USER CONFIRMATION REQUIRED',answer=(key)=>values[key]||marker;
  return '## Work authorisation / sponsorship\nWork authorisation: '+answer('workAuthorisation')+'\nSponsorship: '+answer('sponsorship')+'\n\n## Salary expectations\n'+answer('salary')+'\n\n## Notice period\n'+answer('noticePeriod')+'\n\n## Start date / relocation\nStart date: '+answer('startDate')+'\nRelocation: '+answer('relocation');
}
function applicationAnswersDraft(db,ctx,evidence){
  const job=ctx.job,focus=roleFocus(ctx,2),f1=focusPhrase(focus[0])||'the role’s core trading responsibilities',f2=focusPhrase(focus[1]),relevant=evidence.slice(0,3),cvLines=cvTechnicalUnits(ctx.cv?.extracted_text),technical=[...new Set([...evidence,...cvLines])].map((line,index)=>({line,index,score:(/\b(?:python|sql|excel|vba|c\+\+|matlab|bloomberg|reuters|refinitiv|power bi|tableau)\b/i.test(line)?6:0)+(/\btechnical skills?\s*:/i.test(line)?2:0)+(/\b(?:systematic|automation|backtest|model|technology)\b/i.test(line)?3:0)+(/\bdata\b/i.test(line)?1:0)-(/\b(?:certificat|course|bootcamp|simulation|forage|udemy)\b/i.test(line)?6:0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,2).map(x=>x.line),trading=evidence.filter(x=>/\b(?:trad(?:e|ed|ing)|market|equity|equities|futures|options|derivatives|portfolio|investment|execution|risk)\b/i.test(x)).slice(0,3);
  const why='The '+job.title+' role is relevant to my documented trading experience. '+firstPersonEvidence(relevant[0]||evidence[0])+' I am also drawn to its emphasis on '+f1+', where I can apply existing market experience while continuing to develop.';
  const company='My interest in '+job.company+' is specific to this '+job.title+' opening. The role combines '+f1+(f2?' with '+f2:'')+', which matches the areas of the opportunity I want to pursue without assuming facts about the employer beyond the job description.';
  const relevantText=relevant.length?relevant.map(x=>'- '+cleanEvidence(x)).join('\n'):'USER CONFIRMATION REQUIRED',technicalText=technical.length?technical.map(x=>'- '+cleanEvidence(x)).join('\n'):'USER CONFIRMATION REQUIRED',tradingText=trading.length?trading.map(x=>'- '+cleanEvidence(x)).join('\n'):'USER CONFIRMATION REQUIRED';
  return '# Application Answers\n\n## Why this role?\n'+why+'\n\n## Why this company?\n'+company+'\n\n## Relevant experience\n'+relevantText+'\n\n## Technical experience\n'+technicalText+'\n\n## Trading / investment experience\n'+tradingText+'\n\n'+riskSections(db);
}
function applicationEventRecorded(app){return Boolean(app?.applied_at);}
function outreachDraft({ctx,evidence,contact,confirmed,applied}){
  const job=ctx.job,greeting=confirmed?'Hello '+contact.name+',':'Hello,',state=applied?'I have submitted an application for the '+job.title+' role at '+job.company+'.':'I am considering the '+job.title+' role at '+job.company+'.',proof=evidence[0]?' My background includes '+gerundEvidence(evidence[0])+'.':'';
  return '# Outreach Draft\n\n'+greeting+'\n\n'+state+proof+' The role’s focus in the stored job description is relevant to that experience, so I wanted to introduce myself and ask whether you are the right person to speak with about the position.\n\nKind regards\n'+safe(ctx.profile?.name);
}
function eventRecord(db,applicationId,type){return db.prepare('SELECT * FROM audit_events WHERE entity_type=? AND entity_id=? AND event_type=? ORDER BY id DESC LIMIT 1').get('application',applicationId,type);}
function submittedDocument(db,applicationId,kind){return db.prepare('SELECT * FROM application_documents WHERE application_id=? AND kind=? AND immutable=1 ORDER BY id DESC LIMIT 1').get(applicationId,kind);}
function readRequiredDocument(db,applicationId,kind){
  const doc=submittedDocument(db,applicationId,kind);if(!doc||!fs.existsSync(doc.path))throw new Error('Interview prep requires immutable '+kind+' from the submitted application');
  if(doc.sha256&&sha256File(doc.path)!==doc.sha256)throw new Error('Immutable '+kind+' hash mismatch');
  return {doc,text:fs.readFileSync(doc.path,'utf8')};
}
function analysisSnapshot(text=''){try{return JSON.parse(text||'{}');}catch{return {};}}
function answerHighlights(text=''){return String(text).split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!x.startsWith('#')&&!/^USER CONFIRMATION REQUIRED$/.test(x)).slice(0,8);}
function latestStatusHistory(text=''){try{const rows=JSON.parse(text);return Array.isArray(rows)?rows.slice(-6):[];}catch{return [];}}

export function prepareApplicationPackage(db,jobId,{coverLetter=true,answers=true,outreach=true,contactId=null}={}){
  const app=ensureApplication(db,jobId),ctx=context(db,jobId),job=ctx.job,jd=ctx.jd,cv=ctx.cv,jdText=safe(jd?.jd_clean),cvText=safe(cv?.extracted_text);
  if(!jdText)throw new Error('A stored job description is required before preparing a package');if(!cvText)throw new Error('An active or job-tailored CV is required before preparing a package');
  const focusText=[job.title,...roleFocus(ctx,8)].join(' '),ranked=topEvidence(cvText,focusText,6,job),evidence=[...new Set([...ranked,...recruiterEvidence(ctx)])].filter(x=>roleEvidenceBonus(job,x)>=0).slice(0,4),artifacts={reviewCv:stageReviewCv(ctx,app.application_folder)},verification={},allEvidence=evidenceText(ctx);
  if(coverLetter){
    const final=finalize(coverLetterDraft(ctx,evidence),'COVER_LETTER',allEvidence);verification.coverLetter=final.verification;verification.coverLetter.wordCount=countWords(final.text);
    const explicit=explicitCoverLimit(jdText);if(!explicit&&(verification.coverLetter.wordCount<250||verification.coverLetter.wordCount>400))throw new Error('Cover letter default length outside 250–400 words: '+verification.coverLetter.wordCount);if(explicit&&verification.coverLetter.wordCount>explicit+12)throw new Error('Cover letter exceeds the employer word limit');
    artifacts.coverLetter=write(path.join(app.application_folder,'Cover-Letter','cover-letter.md'),final.text);
  }
  if(answers){const final=finalize(applicationAnswersDraft(db,ctx,evidence),'APPLICATION_ANSWER',allEvidence);verification.applicationAnswers=final.verification;artifacts.applicationAnswers=write(path.join(app.application_folder,'Application-Answers','answers.md'),final.text);}
  if(outreach){
    const c=contactForJob(db,jobId,contactId),confirmed=contactConfirmed(c),draft=outreachDraft({ctx,evidence,contact:c,confirmed,applied:applicationEventRecorded(app)}),final=finalize(draft,'OUTREACH',evidenceText({...ctx,contact:confirmed?c:null}));
    verification.outreach=final.verification;artifacts.outreach=write(path.join(app.application_folder,'Outreach','messages.md'),final.text);
  }
  return {applicationId:app.id,folder:app.application_folder,cvVersionId:cv?.id||null,evidenceUsed:evidence,verification,artifacts};
}
export function prepareOutreach(db,jobId,{contactId=null}={}){return prepareApplicationPackage(db,jobId,{coverLetter:false,answers:false,outreach:true,contactId});}
export function prepareFollowup(db,applicationId,{contactId=null,kind='APPLICATION'}={}){
  const app=db.prepare('SELECT * FROM applications WHERE id=?').get(applicationId);if(!app)throw new Error('Application not found');
  const ctx=context(db,app.job_id),job=ctx.job,profile=ctx.profile,c=contactForJob(db,app.job_id,contactId),confirmed=contactConfirmed(c),greeting=confirmed?'Hello '+c.name+',':'Hello,',k=String(kind||'APPLICATION').toUpperCase();let event;
  if(k==='APPLICATION'){if(!app.applied_at)throw new Error('Follow-up blocked: no manually recorded application event exists');event='my application for the '+job.title+' role at '+job.company;}
  else if(k==='INTERVIEW'){const interview=db.prepare('SELECT * FROM interviews WHERE application_id=? ORDER BY id DESC LIMIT 1').get(applicationId);if(!interview||String(interview.status||'').toUpperCase()!=='COMPLETED')throw new Error('Follow-up blocked: no completed interview event is recorded');event='my completed interview for the '+job.title+' role at '+job.company;}
  else if(k==='ASSESSMENT'){if(!eventRecord(db,applicationId,'ASSESSMENT_COMPLETED'))throw new Error('Follow-up blocked: no completed assessment event is recorded');event='the assessment I completed for the '+job.title+' role at '+job.company;}
  else if(k==='REQUESTED_INFORMATION'){if(!eventRecord(db,applicationId,'REQUESTED_INFORMATION_SENT'))throw new Error('Follow-up blocked: no requested-information-sent event is recorded');event='the information I sent for the '+job.title+' role at '+job.company;}
  else throw new Error('Unsupported follow-up event kind');
  const draft='# Follow-up Draft — '+job.company+' / '+job.title+'\n\n'+greeting+'\n\nI am following up on '+event+'. I remain interested in the position and would appreciate any update you can share.\n\nKind regards'+(profile?.name?'\n'+profile.name:''),final=finalize(draft,'FOLLOW_UP',evidenceText({...ctx,contact:confirmed?c:null,extra:event})),file=write(path.join(app.application_folder,'Outreach','follow-up-'+k.toLowerCase()+'.md'),final.text);
  return {applicationId:app.id,file,verification:final.verification,event:k};
}
export function prepareInterview(db,jobId){
  const app=db.prepare('SELECT * FROM applications WHERE job_id=?').get(jobId);if(!app?.submitted_cv_version_id||!app.applied_at)throw new Error('Interview prep requires a manually recorded submitted application');
  const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId),cv=db.prepare('SELECT v.*,d.extracted_text,d.original_filename,d.sha256 FROM cv_versions v JOIN cv_documents d ON d.id=v.document_id WHERE v.id=?').get(app.submitted_cv_version_id);if(!cv)throw new Error('Submitted CV version is missing');
  const submitted=readRequiredDocument(db,app.id,'SUBMITTED_CV');if(Number(submitted.doc.cv_version_id)!==Number(cv.id))throw new Error('Submitted CV snapshot does not match the recorded CV version');
  const jd=readRequiredDocument(db,app.id,'SUBMITTED_JD'),cover=readRequiredDocument(db,app.id,'SUBMITTED_COVER_LETTER'),answers=readRequiredDocument(db,app.id,'SUBMITTED_APPLICATION_ANSWERS'),recruiter=readRequiredDocument(db,app.id,'SUBMITTED_RECRUITER_ANALYSIS'),ats=readRequiredDocument(db,app.id,'SUBMITTED_ATS_ANALYSIS'),history=readRequiredDocument(db,app.id,'SUBMITTED_HISTORY');
  const reqEvidence=topEvidence(cv.extracted_text,jd.text,4),recruiterData=analysisSnapshot(recruiter.text),atsData=analysisSnapshot(ats.text),answerLines=answerHighlights(answers.text),historyRows=latestStatusHistory(history.text),recruiterVerdict=recruiterData.verdict||recruiterData.payload?.verdict||'recorded at submission',atsScore=atsData.score??atsData.payload?.score??'recorded at submission';
  const raw='# Interview Prep — '+job.company+' / '+job.title+'\n\n## Submitted application baseline\nCV version ID: '+cv.id+'\nSubmitted CV SHA-256: '+submitted.doc.sha256+'\nRecruiter assessment at submission: '+recruiterVerdict+'\nATS assessment at submission: '+atsScore+'\n\n## Evidence to prepare\n'+(reqEvidence.map(x=>'- '+x).join('\n')||'- Use only examples present in the submitted CV.')+'\n\n## What the submitted application already said\n'+(answerLines.map(x=>'- '+x).join('\n')||'- Review the immutable submitted application answers.')+'\n\n## Preparation\nUse the submitted cover letter and application answers as commitments already made to the employer. Prepare concise examples for the core requirements in the submitted JD, and keep every example within the scope of the submitted CV. Where the submitted materials used USER CONFIRMATION REQUIRED, confirm the current fact before answering rather than guessing. Review the Recruiter and ATS analysis that existed at submission for strengths, gaps and wording the interviewer may probe.\n\n## Application history\n'+(historyRows.map(x=>'- '+(x.created_at||'')+': '+(x.old_status||'—')+' → '+(x.new_status||'')+' — '+(x.note||'')).join('\n')||'- Submitted application event recorded.')+'\n\n## Questions to ask\n- How will success in this role be assessed during the first months?\n- Which responsibilities in the submitted job description take the greatest share of the team’s time?\n- How does the team manage risk, escalation and decision ownership for this role?\n';
  const source=[cv.extracted_text,jd.text,cover.text,answers.text,recruiter.text,ats.text,history.text,'CV version ID: '+cv.id,'Submitted CV SHA-256: '+submitted.doc.sha256,job.company,job.title].join('\n'),final=finalize(raw,'INTERVIEW',source),file=write(path.join(app.application_folder,'Interview','interview-prep.md'),final.text);
  return {applicationId:app.id,file,submittedCvVersionId:cv.id,submittedCvSha256:submitted.doc.sha256,jdSnapshot:jd.doc.path,coverLetterSnapshot:cover.doc.path,answersSnapshot:answers.doc.path,recruiterSnapshot:recruiter.doc.path,atsSnapshot:ats.doc.path,historySnapshot:history.doc.path,evidenceUsed:reqEvidence,verification:final.verification};
}

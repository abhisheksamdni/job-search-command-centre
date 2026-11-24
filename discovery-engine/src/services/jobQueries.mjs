import { visibleJobPredicate } from './jobVisibility.mjs';

export function listJobs(db,{scope='active',status=null,country=null,role=null,q=null,limit=500}={}){
  const clauses=[],args=[],visible=visibleJobPredicate('j');
  if(scope==='archived')clauses.push("j.status='ARCHIVED'");
  else if(scope==='visible-all')clauses.push(`(j.status='ARCHIVED' OR ${visible})`);
  else if(scope!=='all'){clauses.push("j.status!='ARCHIVED'");clauses.push(visible);}
  for(const [value,col] of [[status,'j.status'],[country,'j.country_code'],[role,'j.role_classification']])if(value){clauses.push(`${col}=?`);args.push(value);}if(q){clauses.push('(j.title LIKE ? OR j.company LIKE ?)');args.push(`%${q}%`,`%${q}%`);}const where=clauses.length?'WHERE '+clauses.join(' AND '):'';
  return db.prepare(`SELECT j.*, (SELECT score FROM job_analysis a WHERE a.job_id=j.id AND a.analysis_type='RECRUITER' ORDER BY a.id DESC LIMIT 1) recruiter_score,(SELECT verdict FROM job_analysis a WHERE a.job_id=j.id AND a.analysis_type='RECRUITER' ORDER BY a.id DESC LIMIT 1) recruiter_verdict,(SELECT score FROM job_analysis a WHERE a.job_id=j.id AND a.analysis_type='ATS_EXACT' ORDER BY a.id DESC LIMIT 1) ats_score,(SELECT payload_json FROM job_analysis a WHERE a.job_id=j.id AND a.analysis_type='POST_TAILOR' ORDER BY a.id DESC LIMIT 1) post_tailor_json,(SELECT status FROM applications ap WHERE ap.job_id=j.id LIMIT 1) application_status,(SELECT id FROM applications ap WHERE ap.job_id=j.id LIMIT 1) application_id FROM jobs j ${where} ORDER BY COALESCE(j.employer_published_at,j.source_published_at,j.posted_at,j.first_seen_at) DESC LIMIT ?`).all(...args,Math.max(1,Math.min(5000,Number(limit)||500))).map(r=>({...r,post_tailor:r.post_tailor_json?JSON.parse(r.post_tailor_json):null}));
}

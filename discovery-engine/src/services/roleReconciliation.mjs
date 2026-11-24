import { classifyRole } from './roleGate.mjs';

export function reconcileStoredJobRoles(db){
  const roles=db.prepare('SELECT * FROM target_roles WHERE enabled=1').all();
  const jobs=db.prepare('SELECT id,title,role_classification,role_family FROM jobs').all();
  const update=db.prepare('UPDATE jobs SET role_classification=?,role_family=? WHERE id=?');
  const result={examined:jobs.length,changed:0,matched:0,related:0,rejected:0};
  db.exec('BEGIN IMMEDIATE');
  try{
    for(const job of jobs){
      const next=classifyRole(job.title,roles);
      if(next.classification==='ROLE_MATCH')result.matched++;
      else if(next.classification==='ROLE_RELATED')result.related++;
      else result.rejected++;
      const family=next.family||null;
      if(job.role_classification!==next.classification||(job.role_family||null)!==family){
        update.run(next.classification,family,job.id);
        result.changed++;
      }
    }
    db.exec('COMMIT');
    return result;
  }catch(error){
    db.exec('ROLLBACK');
    throw error;
  }
}

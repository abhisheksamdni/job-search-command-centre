import { processQueueItem,validateQueuePackage } from './workQueue.mjs';

const RECOVERY_MARKER='RECOVERED_STALE_PROCESSING';

export function reconcileTerminalJobStatuses(db){
  const changed=db.prepare(`UPDATE jobs SET status='SAVED'
    WHERE status='QUEUED_FOR_WORK'
      AND EXISTS (SELECT 1 FROM application_work_queue q WHERE q.job_id=jobs.id AND q.state IN ('BLOCKED','FAILED'))
      AND NOT EXISTS (SELECT 1 FROM application_work_queue q WHERE q.job_id=jobs.id AND q.state IN ('QUEUED','PROCESSING','READY_FOR_REVIEW','NEEDS_CONFIRMATION','APPROVED'))`).run();
  return Number(changed.changes||0);
}

export function recoverStaleProcessing(db,{staleMs=0}={}){
  const seconds=Math.max(0,Math.ceil(Number(staleMs)/1000));
  const rows=db.prepare("SELECT * FROM application_work_queue WHERE state='PROCESSING' AND datetime(updated_at)<=datetime('now',?) ORDER BY id").all(`-${seconds} seconds`);const recovered=[];
  for(const item of rows){
    try{validateQueuePackage(db,item);const app=db.prepare('SELECT * FROM applications WHERE job_id=?').get(item.job_id);if(app&&app.status!=='SAVED')throw new Error('RECOVERY_APPLICATION_NOT_SAVED');if(app&&db.prepare("SELECT 1 FROM application_documents WHERE application_id=? AND kind LIKE 'SUBMITTED_%' LIMIT 1").get(app.id))throw new Error('RECOVERY_SUBMITTED_ARTIFACT_PRESENT');const changed=db.prepare("UPDATE application_work_queue SET state='QUEUED',last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND state='PROCESSING'").run(RECOVERY_MARKER,item.id);if(Number(changed.changes)===1){recovered.push(item.id);db.prepare("INSERT INTO audit_events(entity_type,entity_id,event_type,payload_json) VALUES ('job',?,'WORK_QUEUE_STALE_RECOVERED',?)").run(item.job_id,JSON.stringify({queueId:item.id,attemptCount:item.attempt_count}));}}
    catch(e){db.prepare("UPDATE application_work_queue SET state='BLOCKED',last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND state='PROCESSING'").run(`STALE_PROCESSING_RECOVERY_BLOCKED: ${e.message}`,item.id);}
  }
  return recovered;
}

export class ApplicationQueueRunner{
  constructor(db,{process=processQueueItem,maxConcurrent=1,pollMs=1000,staleMs=0}={}){this.db=db;this.process=process;this.maxConcurrent=Math.max(1,Number(maxConcurrent)||1);this.pollMs=Math.max(25,Number(pollMs)||1000);this.staleMs=Math.max(0,Number(staleMs)||0);this.active=0;this.started=false;this.timer=null;this.pending=null;this.idleWaiters=[];}
  start(){if(this.started)return;this.started=true;recoverStaleProcessing(this.db,{staleMs:this.staleMs});reconcileTerminalJobStatuses(this.db);this.timer=setInterval(()=>this.schedule(),this.pollMs);this.timer.unref?.();this.schedule();}
  enqueue(){this.schedule();}
  schedule(){if(!this.started||this.pending)return;this.pending=Promise.resolve().then(()=>this.drain()).finally(()=>{this.pending=null;if(this.started&&this.active<this.maxConcurrent&&this.next())this.schedule();else this.resolveIdle();});}
  next(){return this.db.prepare("SELECT * FROM application_work_queue WHERE state='QUEUED' ORDER BY queued_at,id LIMIT 1").get()||null;}
  async drain(){while(this.started&&this.active<this.maxConcurrent){const item=this.next();if(!item)break;this.active++;try{await this.process(this.db,item.id,{reuseExistingPackage:item.last_error===RECOVERY_MARKER});}catch(e){this.db.prepare("UPDATE application_work_queue SET state='FAILED',last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND state IN ('QUEUED','PROCESSING')").run(e.message||'QUEUE_RUNNER_UNEXPECTED_ERROR',item.id);reconcileTerminalJobStatuses(this.db);}finally{this.active--;}}
  }
  resolveIdle(){if(this.active||this.pending||this.next())return;for(const resolve of this.idleWaiters.splice(0))resolve();}
  whenIdle(){if(!this.active&&!this.pending&&!this.next())return Promise.resolve();return new Promise(resolve=>this.idleWaiters.push(resolve));}
  async stop({wait=true}={}){this.started=false;if(this.timer)clearInterval(this.timer);this.timer=null;if(wait){await this.pending;while(this.active)await new Promise(resolve=>setTimeout(resolve,10));}this.resolveIdle();}
}

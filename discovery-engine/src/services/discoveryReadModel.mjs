function parseJson(value,fallback={}){try{return typeof value==='string'?JSON.parse(value||'{}'):(value||fallback);}catch{return fallback;}}
function timestamp(value){
  if(typeof value==='number')return value;
  const raw=String(value||'').trim();
  if(!raw)return Number.NaN;
  // SQLite CURRENT_TIMESTAMP is UTC but omits the timezone suffix. JavaScript
  // otherwise interprets that shape as local time, inflating elapsed times.
  const normalized=/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw)
    ? `${raw.replace(' ','T')}Z`
    : raw;
  return Date.parse(normalized);
}
function secondsBetween(a,b=Date.now()){
  const start=timestamp(a),end=timestamp(b);
  return Number.isFinite(start)&&Number.isFinite(end)?Math.max(0,Math.floor((end-start)/1000)):0;
}
function rowWithStats(row){if(!row)return null;const stats=parseJson(row.stats_json,{});return {...row,stats,durationSeconds:row.finished_at?secondsBetween(row.started_at,row.finished_at):secondsBetween(row.started_at)};}

export function discoveryState(db,scheduler={}){
  const run=db.prepare(`SELECT * FROM discovery_runs WHERE status='RUNNING' ORDER BY id DESC LIMIT 1`).get()||db.prepare('SELECT * FROM discovery_runs ORDER BY id DESC LIMIT 1').get()||null;
  const latest=rowWithStats(run);const st=latest?.stats||{};
  const startedAt=latest?.started_at||null;const lastProgressAt=st.lastProgressAt||startedAt;
  const settings=scheduler.settings||{};
  const running=Boolean(scheduler.running||latest?.status==='RUNNING');
  return {
    running,
    cancelRequested:Boolean(scheduler.cancelRequested),
    runId:latest?.id||null,
    runStatus:latest?.status||null,
    startedAt,
    deadlineAt:st.deadlineAt||null,
    elapsedSeconds:startedAt?(running?secondsBetween(startedAt):latest.durationSeconds):0,
    lastProgressAt:lastProgressAt||null,
    secondsSinceProgress:running&&lastProgressAt?secondsBetween(lastProgressAt):0,
    plannedSources:Number(st.plannedSources??st.sourcesAttempted??0),
    sourcesCompleted:Number(st.sourcesCompleted||0),
    currentSourceId:st.currentSourceId??null,
    currentSourceName:st.currentSourceName||null,
    currentQuery:st.currentQuery||null,
    currentQueryIndex:Number(st.currentQueryIndex||0),
    plannedQueries:Number(st.plannedQueries||0),
    queriesCompleted:Number(st.queriesCompleted??st.sourceQueries??0),
    currentLayer:st.currentLayer||null,
    rawJobs:Number(st.rawJobs||0),
    uniqueJobs:Number(st.uniqueJobs||0),
    roleRelevant:Number(st.roleRelevant||0),
    locationMatched:Number(st.locationMatched||0),
    locationUnverified:Number(st.locationUnverified||0),
    locationMismatch:Number(st.locationMismatch||0),
    locationNeedsDetail:Number(st.locationNeedsDetail||0),
    jdsRetrieved:Number(st.jdsRetrieved||0),
    metadataCandidates:Number(st.metadataCandidates||0),
    dedupedBeforeHydration:Number(st.dedupedBeforeHydration||0),
    rejectedByRecency:Number(st.rejectedByRecency||0),
    rejectedByRole:Number(st.rejectedByRole||0),
    rejectedByLocation:Number(st.rejectedByLocation||0),
    rejectedBySeniority:Number(st.rejectedBySeniority||0),
    jevEvaluated:Number(st.jevEvaluated||0),
    newCandidates:Number(st.newCandidates||0),
    unverifiedCandidates:Number(st.unverifiedCandidates||0),
    strong:Number(st.strong||0),
    good:Number(st.good||0),
    errors:Array.isArray(st.errors)?st.errors:[],
    anomalies:Array.isArray(st.anomalies)?st.anomalies:[],
    sourceProgress:Array.isArray(st.sourceProgress)?st.sourceProgress:[],
    statusReason:st.statusReason||latest?.error||null,
    agentReachAvailable:st.agentReachAvailable??null,
    nextRun:scheduler.nextRun||null,
    lastRun:scheduler.lastRun||null,
    lastAutoPrep:scheduler.lastAutoPrep||null,
    mode:settings.mode||'MANUAL',
    auto_enabled:settings.auto_enabled||'0',
    auto_every_hours:settings.auto_every_hours||'3',
    latestRun:latest
  };
}

export function discoveryHistory(db,limit=50){
  const rows=db.prepare('SELECT * FROM discovery_runs ORDER BY id DESC LIMIT ?').all(Math.max(1,Math.min(200,Number(limit)||50)));
  return rows.map(row=>{
    const r=rowWithStats(row),s=r.stats||{};
    const sourceRows=db.prepare('SELECT status,count(*) n FROM discovery_run_sources WHERE run_id=? GROUP BY status').all(row.id);
    const sourceOutcomes=Object.fromEntries(sourceRows.map(x=>[x.status,Number(x.n)]));
    return {...r,sourceOutcomes,sourcesAttempted:Number(s.plannedSources??s.sourcesAttempted??0),sourcesCompleted:Number(s.sourcesCompleted||0),queries:Number(s.queriesCompleted??s.sourceQueries??0),listings:Number(s.rawJobs||0),deduped:Number(s.uniqueJobs||0),dedupedBeforeHydration:Number(s.dedupedBeforeHydration||0),metadataCandidates:Number(s.metadataCandidates||0),rejectedByRecency:Number(s.rejectedByRecency||0),rejectedByRole:Number(s.rejectedByRole||0),rejectedByLocation:Number(s.rejectedByLocation||0),rejectedBySeniority:Number(s.rejectedBySeniority||0),jevEvaluated:Number(s.jevEvaluated||0),roleRelevant:Number(s.roleRelevant||0),locationRelevant:Number(s.locationMatched||0),locationUnverified:Number(s.locationUnverified||0),locationMismatch:Number(s.locationMismatch||0),jds:Number(s.jdsRetrieved||0),newJobs:Number(s.newCandidates||0),unverifiedCandidates:Number(s.unverifiedCandidates||0),strong:Number(s.strong||0),good:Number(s.good||0),anomalyCount:Array.isArray(s.anomalies)?s.anomalies.length:0,anomalies:Array.isArray(s.anomalies)?s.anomalies:[],sourceProgress:Array.isArray(s.sourceProgress)?s.sourceProgress:[],errorCount:Array.isArray(s.errors)?s.errors.length:0};
  });
}

export function discoveryRunDetail(db,id){
  const row=db.prepare('SELECT * FROM discovery_runs WHERE id=?').get(Number(id));if(!row)return null;
  const run=rowWithStats(row);
  const sources=db.prepare(`SELECT drs.*,s.name source_name,s.health source_health FROM discovery_run_sources drs LEFT JOIN sources s ON s.id=drs.source_id WHERE drs.run_id=? ORDER BY drs.id`).all(run.id).map(x=>({...x,stats:parseJson(x.stats_json,{})}));
  const attempts=db.prepare('SELECT * FROM discovery_attempts WHERE run_id=? ORDER BY id').all(run.id);
  return {...run,sources,attempts};
}

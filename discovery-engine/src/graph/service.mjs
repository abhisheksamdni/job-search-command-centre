import fs from 'node:fs';
import { buildGraphIndex } from './indexer.mjs';
import { paths } from '../paths.mjs';
import { jccEvents } from '../events.mjs';

function emptyGraph(error = null) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    nodes: [],
    links: [],
    groups: [],
    hash: 'unavailable',
    ...(error ? { error: String(error.message || error) } : {})
  };
}

export class KnowledgeGraphService {
  constructor({ knowledgeRoot = paths.knowledgeRoot, outputPath = paths.graphIndex, reconcileMs = 60_000, debounceMs = 200 } = {}) {
    this.knowledgeRoot=knowledgeRoot; this.outputPath=outputPath; this.reconcileMs=reconcileMs; this.debounceMs=debounceMs;
    this.clients=new Set(); this.graph=null; this.watcher=null; this.interval=null; this.debounce=null; this.started=false; this.lastError=null;
    this.onKnowledgeChange=()=>this.schedule('jcc-event');
  }
  current(){
    if(!this.graph){
      try{return this.refresh('lazy');}
      catch(e){this.lastError=e;this.graph=emptyGraph(e);}
    }
    return this.graph;
  }
  refresh(reason='manual'){
    const next=buildGraphIndex({knowledgeRoot:this.knowledgeRoot,outputPath:this.outputPath});
    const changed=!this.graph||this.graph.hash!==next.hash; this.graph=next;this.lastError=null;
    if(changed)this.broadcast({reason,graph:next});
    return next;
  }
  safeRefresh(reason='manual'){
    try{return this.refresh(reason);}catch(e){
      this.lastError=e;
      console.error(`Knowledge graph ${reason} refresh failed:`,e.message);
      if(!this.graph)this.graph=emptyGraph(e);
      return this.graph;
    }
  }
  schedule(reason='change'){
    clearTimeout(this.debounce); this.debounce=setTimeout(()=>this.safeRefresh(reason),this.debounceMs);this.debounce.unref?.();
  }
  start(){
    if(this.started)return;this.started=true;this.safeRefresh('startup');jccEvents.on('knowledge:changed',this.onKnowledgeChange);
    try{this.watcher=fs.watch(this.knowledgeRoot,{recursive:true},(_event,filename)=>{if(!filename||String(filename).toLowerCase().endsWith('.md'))this.schedule('filesystem');});}
    catch(e){console.warn(`Knowledge graph filesystem watcher unavailable: ${e.message}`);}
    this.interval=setInterval(()=>this.safeRefresh('periodic'),this.reconcileMs);this.interval.unref?.();
  }
  stop(){
    this.started=false;clearTimeout(this.debounce);if(this.interval)clearInterval(this.interval);this.interval=null;this.watcher?.close();this.watcher=null;jccEvents.off('knowledge:changed',this.onKnowledgeChange);for(const res of this.clients){try{res.end();}catch{}}this.clients.clear();
  }
  subscribe(req,res){
    res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform','connection':'keep-alive','x-accel-buffering':'no'});
    res.write(`event: graph\ndata: ${JSON.stringify({reason:'initial',graph:this.current()})}\n\n`);this.clients.add(res);
    const heartbeat=setInterval(()=>{try{res.write(': heartbeat\n\n');}catch{}},25_000);heartbeat.unref?.();
    const cleanup=()=>{clearInterval(heartbeat);this.clients.delete(res);};req.on('close',cleanup);res.on('close',cleanup);
  }
  broadcast(payload){const data=`event: graph\ndata: ${JSON.stringify(payload)}\n\n`;for(const res of [...this.clients]){try{res.write(data);}catch{this.clients.delete(res);}}}
}

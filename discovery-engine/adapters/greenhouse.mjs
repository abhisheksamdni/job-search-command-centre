export function detectGreenhouse(url='') {
  const m=url.match(/(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/([^/?#]+)/i);
  return m ? { board:m[1], apiUrl:`https://boards-api.greenhouse.io/v1/boards/${m[1]}/jobs?content=true` } : null;
}
export function parseGreenhouse(json, company='') {
  return (json.jobs||[]).map(j=>({externalId:String(j.id??''),company,title:j.title||'',location:j.location?.name||'',sourceUrl:j.absolute_url||'',applicationUrl:j.absolute_url||'',jdRaw:j.content||'',sourceUpdatedAt:j.updated_at||null,postedAt:null,postingDateConfidence:'UNVERIFIED'}));
}
export async function scanGreenhouse({apiUrl,company,fetchImpl=fetch}){
  const res=await fetchImpl(apiUrl,{headers:{accept:'application/json'}}); if(!res.ok) throw new Error(`Greenhouse HTTP ${res.status}`); return parseGreenhouse(await res.json(),company);
}

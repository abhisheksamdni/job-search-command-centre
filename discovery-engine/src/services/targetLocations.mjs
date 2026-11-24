import { normalizeTargetLocationInput } from './locationNormalizer.mjs';
export function upsertTargetLocation(db,input={}){
 const n=normalizeTargetLocationInput(input);
 const existing=db.prepare('SELECT * FROM target_locations WHERE normalized_key=?').get(n.normalizedKey);
 if(existing){db.prepare(`UPDATE target_locations SET display_label=?,country=?,country_name=?,country_code=?,city=?,region=?,enabled=?,origin=? WHERE id=?`).run(n.displayLabel,n.countryName,n.countryName,n.countryCode,n.city,n.region,n.enabled,n.origin,existing.id);return db.prepare('SELECT * FROM target_locations WHERE id=?').get(existing.id);}
 const r=db.prepare(`INSERT INTO target_locations(country,country_name,country_code,city,region,enabled,display_label,normalized_key,origin) VALUES (?,?,?,?,?,?,?,?,?)`).run(n.countryName,n.countryName,n.countryCode,n.city,n.region,n.enabled,n.displayLabel,n.normalizedKey,n.origin);
 return db.prepare('SELECT * FROM target_locations WHERE id=?').get(Number(r.lastInsertRowid));
}
export function setTargetLocationEnabled(db,id,enabled){const r=db.prepare('UPDATE target_locations SET enabled=? WHERE id=?').run(enabled?1:0,Number(id));if(!r.changes)throw new Error('Target location not found');return db.prepare('SELECT * FROM target_locations WHERE id=?').get(Number(id));}
export function listTargetLocations(db){return db.prepare('SELECT * FROM target_locations ORDER BY enabled DESC,display_label,country,city').all();}

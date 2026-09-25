// lib/aria/memoryEngine.js
import pool from'../db';

const clamp=(n,min=0,max=1)=>Math.max(min,Math.min(max,Number.isFinite(Number(n))?Number(n):min));
const json=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const clean=(v,max=4000)=>String(v??'').trim().slice(0,max);

async function tx(client,fn){
 const own=!client,db=client||await pool.connect();
 try{
  if(own)await db.query('BEGIN');
  const result=await fn(db);
  if(own)await db.query('COMMIT');
  return result;
 }catch(e){
  if(own)try{await db.query('ROLLBACK')}catch{}
  throw e;
 }finally{if(own)db.release()}
}

export async function recordPersonMemory({
 organizationId,personId,memoryType,memoryKey=null,content,importance='normal',
 confidence=.8,evidenceKind='human_report',verificationStatus='reported',
 source='human',sourceEventId=null,createdBy=null,actorRole=null,
 validFrom=null,validUntil=null,verifiedAt=null,metadata={}
},client=null){
 if(!organizationId||!personId||!memoryType||!content)throw new Error('organizationId, personId, memoryType and content are required');
 const key=clean(memoryKey||memoryType.toLowerCase().replace(/[^a-z0-9]+/g,'_'),160);
 const safeContent=clean(content);
 return tx(client,async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[String(organizationId),String(personId)+':'+key]);
  const person=await db.query(`SELECT id FROM people WHERE id=$1 AND organization_id=$2 LIMIT 1`,[personId,organizationId]);
  if(!person.rows.length)throw Object.assign(new Error('Person not found'),{status:404});
  const previous=(await db.query(`SELECT * FROM person_memory WHERE organization_id=$1 AND person_id=$2 AND memory_type=$3 AND memory_key=$4 AND is_current=true LIMIT 1 FOR UPDATE`,[organizationId,personId,memoryType,key])).rows[0]||null;
  if(previous&&String(previous.content||'').trim()===safeContent&&previous.verification_status===verificationStatus&&(!validUntil||String(previous.valid_until)===String(validUntil)))return previous;
  if(previous)await db.query(`UPDATE person_memory SET is_current=false,valid_until=COALESCE($1,NOW()),updated_at=NOW() WHERE id=$2`,[validUntil||new Date().toISOString(),previous.id]);
  const r=await db.query(`INSERT INTO person_memory(
   organization_id,person_id,memory_type,memory_key,content,importance,confidence,source_event_id,source,active,metadata,created_at,updated_at,
   is_current,evidence_kind,verification_status,valid_from,valid_until,created_by,actor_role,verified_at,supersedes_id,scope_level
  )VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,NOW(),NOW(),true,$11,$12,COALESCE($13,NOW()),$14,$15,$16,$17,$18,'person') RETURNING *`,
  [organizationId,personId,memoryType,key,safeContent,importance,clamp(confidence),sourceEventId,source,json(metadata),evidenceKind,verificationStatus,validFrom,validUntil,createdBy,actorRole,verifiedAt,previous?.id||null]);
  return r.rows[0];
 });
}

export async function recordOrganizationMemory({
 organizationId,memoryType,memoryKey,value,confidence=.8,evidenceKind='human_report',
 verificationStatus='reported',source='human',sourceEventId=null,createdBy=null,
 actorRole=null,validFrom=null,validUntil=null,verifiedAt=null,metadata={}
},client=null){
 if(!organizationId||!memoryType||!memoryKey)throw new Error('organizationId, memoryType and memoryKey are required');
 const safeValue=json(value);
 return tx(client,async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[String(organizationId),'org:'+memoryType+':'+memoryKey]);
  const previous=(await db.query(`SELECT * FROM organization_memory WHERE organization_id=$1 AND memory_type=$2 AND memory_key=$3 AND is_current=true LIMIT 1 FOR UPDATE`,[organizationId,memoryType,memoryKey])).rows[0]||null;
  if(previous&&JSON.stringify(previous.memory_value)===JSON.stringify(safeValue)&&previous.verification_status===verificationStatus&&(!validUntil||String(previous.valid_until)===String(validUntil)))return previous;
  if(previous)await db.query(`UPDATE organization_memory SET is_current=false,valid_until=COALESCE($1,NOW()),updated_at=NOW() WHERE id=$2`,[validUntil||new Date().toISOString(),previous.id]);
  const r=await db.query(`INSERT INTO organization_memory(
   organization_id,memory_type,memory_key,memory_value,confidence,source,created_at,updated_at,is_current,
   evidence_kind,verification_status,valid_from,valid_until,source_event_id,created_by,verified_at,supersedes_id,metadata
  )VALUES($1,$2,$3,$4,$5,$6,NOW(),NOW(),true,$7,$8,COALESCE($9,NOW()),$10,$11,$12,$13,$14,$15) RETURNING *`,
  [organizationId,memoryType,memoryKey,JSON.stringify(safeValue),clamp(confidence),source,evidenceKind,verificationStatus,validFrom,validUntil,sourceEventId,createdBy,verifiedAt,previous?.id||null,JSON(metadata)]);
  return r.rows[0];
 });
}

export async function recordRelationship({
 organizationId,personId,relatedPersonId,relationshipType,strength=.5,confidence=.5,
 evidence={},evidenceKind='observation',verificationStatus='observed',source='system',
 sourceEventId=null,createdBy=null,validFrom=null,validUntil=null,verifiedAt=null
},client=null){
 if(!organizationId||!personId||!relatedPersonId||!relationshipType)throw new Error('organizationId, personId, relatedPersonId and relationshipType are required');
 if(String(personId)===String(relatedPersonId))throw new Error('A person cannot be related to themselves');
 return tx(client,async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',[String(organizationId),[personId,relatedPersonId,relationshipType].join(':')]);
  const previous=(await db.query(`SELECT * FROM person_relationships WHERE organization_id=$1 AND person_id=$2 AND related_person_id=$3 AND relationship_type=$4 AND is_current=true LIMIT 1 FOR UPDATE`,[organizationId,personId,relatedPersonId,relationshipType])).rows[0]||null;
  if(previous&&Number(previous.strength)===Number(strength)&&Number(previous.confidence)===Number(confidence)&&JSON.stringify(previous.evidence)===JSON.stringify(evidence))return previous;
  if(previous)await db.query(`UPDATE person_relationships SET is_current=false,valid_until=COALESCE($1,NOW()),updated_at=NOW() WHERE id=$2`,[validUntil||new Date().toISOString(),previous.id]);
  const r=await db.query(`INSERT INTO person_relationships(
   organization_id,person_id,related_person_id,relationship_type,strength,evidence,source,active,created_at,updated_at,
   is_current,evidence_kind,verification_status,confidence,source_event_id,created_by,valid_from,valid_until,verified_at
  )VALUES($1,$2,$3,$4,$5,$6,$7,true,NOW(),NOW(),true,$8,$9,$10,$11,$12,COALESCE($13,NOW()),$14,$15) RETURNING *`,
  [organizationId,personId,relatedPersonId,relationshipType,clamp(strength),JSON.stringify(json(evidence)),source,evidenceKind,verificationStatus,clamp(confidence),sourceEventId,createdBy,validFrom,validUntil,verifiedAt]);
  return r.rows[0];
 });
}

export async function getCurrentPersonMemory(organizationId,personId,{limit=30,type=null}={}){
 const n=Math.min(Math.max(Number(limit)||30,1),100),params=[organizationId,personId];
 let where='organization_id=$1 AND person_id=$2 AND is_current=true AND active=true AND(valid_until IS NULL OR valid_until>NOW())';
 if(type){params.push(type);where+=` AND memory_type=$${params.length}`}
 params.push(n);
 return(await pool.query(`SELECT * FROM person_memory WHERE ${where} ORDER BY CASE importance WHEN'permanent'THEN 4 WHEN'important'THEN 3 WHEN'temporary'THEN 2 ELSE 1 END DESC,confidence DESC,updated_at DESC LIMIT $${params.length}`,params)).rows;
}

export async function getCurrentOrganizationMemory(organizationId,{limit=40,memoryType=null}={}){
 const n=Math.min(Math.max(Number(limit)||40,1),100),params=[organizationId];
 let where='organization_id=$1 AND is_current=true AND(valid_until IS NULL OR valid_until>NOW())';
 if(memoryType){params.push(memoryType);where+=` AND memory_type=$${params.length}`}
 params.push(n);
 return(await pool.query(`SELECT * FROM organization_memory WHERE ${where} ORDER BY confidence DESC,updated_at DESC LIMIT $${params.length}`,params)).rows;
}

// lib/aria/memoryEngine.js
import pool from'../db';

const clamp=n=>Math.max(0,Math.min(1,Number(n)||0));
const obj=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};

export async function setPersonMemory({
 organizationId,personId,memoryType,memoryKey=null,content,confidence=.8,
 evidenceKind='human_report',verificationStatus='reported',source='human',
 sourceEventId=null,createdBy=null,actorRole=null,validFrom=null,validUntil=null,importance='temporary',metadata={}
},client=null){
 if(!organizationId||!personId||!memoryType||!content)throw new Error('organizationId, personId, memoryType and content are required');
 const db=client||pool;
 const lockKey='person-memory:'+organizationId+':'+personId+':'+memoryType+':'+(memoryKey||'');
 await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[lockKey]);
 const current=await db.query('SELECT * FROM person_memory WHERE organization_id=$1 AND person_id=$2 AND memory_type=$3 AND COALESCE(memory_key,\'\')=COALESCE($4,\'\') AND is_current=true LIMIT 1',[organizationId,personId,memoryType,memoryKey]);
 const incoming=String(content).trim();
 if(current.rows[0]&&current.rows[0].content===incoming&&Number(current.rows[0].confidence)>=clamp(confidence))return current.rows[0];
 if(current.rows[0])await db.query('UPDATE person_memory SET is_current=false,active=false,valid_until=COALESCE($2,NOW()),updated_at=NOW() WHERE id=$1',[current.rows[0].id,validFrom||null]);
 const result=await db.query('INSERT INTO person_memory(organization_id,person_id,memory_type,memory_key,content,importance,confidence,source_event_id,source,active,metadata,is_current,evidence_kind,verification_status,valid_from,valid_until,created_by,actor_role,verified_at,supersedes_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,$9,true,$10,$11,COALESCE($12,NOW()),$13,$14,$15,$16,$17) RETURNING *',[organizationId,personId,memoryType,memoryKey,incoming,importance==='permanent'?'permanent':importance==='important'?'important':'temporary',clamp(confidence),sourceEventId||null,source,obj(metadata),evidenceKind,verificationStatus,validFrom||null,validUntil||null,createdBy||null,actorRole||null,verificationStatus==='verified'?new Date().toISOString():null,current.rows[0]?.id||null]);
 return result.rows[0];
}

export async function setOrganizationMemory({
 organizationId,memoryType,memoryKey,value={},confidence=.8,evidenceKind='human_report',
 verificationStatus='reported',source='human',sourceEventId=null,createdBy=null,validFrom=null,validUntil=null,importance='temporary',metadata={}
},client=null){
 if(!organizationId||!memoryType||!memoryKey)throw new Error('organizationId, memoryType and memoryKey are required');
 const db=client||pool;
 const lockKey='org-memory:'+organizationId+':'+memoryType+':'+memoryKey;
 await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[lockKey]);
 const current=await db.query('SELECT * FROM organization_memory WHERE organization_id=$1 AND memory_type=$2 AND memory_key=$3 AND is_current=true LIMIT 1',[organizationId,memoryType,memoryKey]);
 const next=obj(value);
 if(current.rows[0]&&JSON.stringify(current.rows[0].memory_value)===JSON.stringify(next)&&Number(current.rows[0].confidence)>=clamp(confidence))return current.rows[0];
 if(current.rows[0])await db.query('UPDATE organization_memory SET is_current=false,valid_until=COALESCE($2,NOW()),updated_at=NOW() WHERE id=$1',[current.rows[0].id,validFrom||null]);
 const result=await db.query('INSERT INTO organization_memory(organization_id,memory_type,memory_key,memory_value,confidence,source,created_at,updated_at,is_current,evidence_kind,verification_status,valid_from,valid_until,source_event_id,created_by,verified_at,supersedes_id,metadata) VALUES($1,$2,$3,$4,$5,$6,NOW(),NOW(),true,$7,$8,COALESCE($9,NOW()),$10,$11,$12,$13,$14,$15) RETURNING *',[organizationId,memoryType,memoryKey,next,clamp(confidence),source,evidenceKind,verificationStatus,validFrom||null,validUntil||null,sourceEventId||null,createdBy||null,verificationStatus==='verified'?new Date().toISOString():null,current.rows[0]?.id||null,obj(metadata)]);
 return result.rows[0];
}

export async function upsertPersonRelationship({
 organizationId,personId,relatedPersonId,relationshipType,strength=0,evidence={},source='inferred',
 evidenceKind='observation',verificationStatus='observed',confidence=.5,sourceEventId=null,createdBy=null,
 validFrom=null,validUntil=null
},client=null){
 if(!organizationId||!personId||!relatedPersonId||!relationshipType)throw new Error('Relationship identifiers are required');
 const db=client||pool;
 await db.query('UPDATE person_relationships SET is_current=false,active=false,valid_until=COALESCE($5,NOW()),updated_at=NOW() WHERE organization_id=$1 AND person_id=$2 AND related_person_id=$3 AND relationship_type=$4 AND is_current=true',[organizationId,personId,relatedPersonId,relationshipType,validUntil||null]);
 const result=await db.query('INSERT INTO person_relationships(organization_id,person_id,related_person_id,relationship_type,strength,evidence,source,active,is_current,evidence_kind,verification_status,confidence,source_event_id,created_by,valid_from,valid_until,verified_at) VALUES($1,$2,$3,$4,$5,$6,$7,true,true,$8,$9,$10,$11,$12,COALESCE($13,NOW()),$14,$15) RETURNING *',[organizationId,personId,relatedPersonId,relationshipType,Number(strength)||0,obj(evidence),source,evidenceKind,verificationStatus,clamp(confidence),sourceEventId||null,createdBy||null,validFrom||null,validUntil||null,verificationStatus==='verified'?new Date().toISOString():null]);
 return result.rows[0];
}
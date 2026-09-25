// lib/aria/eventEmitter.js
import pool from'../db';

export async function emitAriaEvent({
 organizationId,personId=null,type,actorId=null,actorRole=null,source,
 metadata={},eventKey=null,occurredAt=null,evidenceKind='observation',
 confidence=1,verificationStatus='observed',scopeLevel='organization',expiresAt=null,supersedesEventId=null
},client=null){
 if(!organizationId)throw new Error('organizationId is required');
 if(!type)throw new Error('type is required');
 if(!source)throw new Error('source is required');
 const key=eventKey||source+':'+organizationId+':'+type+':'+(personId||'global')+':'+Date.now();
 const db=client||pool;
 const safeConfidence=Math.max(0,Math.min(1,Number(confidence)||0));
 const result=await db.query(
  'INSERT INTO aria_events(organization_id,person_id,type,actor_id,actor_role,source,metadata,event_key,occurred_at,evidence_kind,confidence,verification_status,scope_level,expires_at,supersedes_event_id,processing_status,processing_attempts) VALUES($1::text,$2::uuid,$3::text,$4::uuid,$5::text,$6::text,$7::jsonb,$8::text,COALESCE($9::timestamptz,NOW()),$10::text,$11::numeric,$12::text,$13::text,$14::timestamptz,$15::uuid,\'pending\',0) ON CONFLICT(organization_id,event_key) DO NOTHING RETURNING *',
  [organizationId,personId,type,actorId,actorRole||null,source,metadata&&typeof metadata==='object'?metadata:{},key,occurredAt||null,evidenceKind,safeConfidence,verificationStatus,scopeLevel,expiresAt||null,supersedesEventId||null]
 );
 return result.rows[0]||null;
}
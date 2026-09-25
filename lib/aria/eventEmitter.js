// lib/aria/eventEmitter.js
import pool from'../db';

const clamp=(n,min=0,max=1)=>Math.max(min,Math.min(max,Number.isFinite(Number(n))?Number(n):min));
const VALID_KIND=new Set(['fact','observation','human_report','inference','uncertainty']);
const VALID_STATUS=new Set(['verified','observed','reported','inferred','conflicted','unknown','stale']);
const clean=(v,max=120)=>String(v??'').trim().slice(0,max);

export async function emitAriaEvent({
 organizationId,personId=null,type,actorId=null,source,metadata={},
 eventKey=null,evidenceKind='observation',confidence=1,verificationStatus='observed',
 scopeLevel='organization',expiresAt=null,actorRole=null,supersedesEventId=null,occurredAt=null
},client=null){
 if(!organizationId)throw new Error('organizationId is required');
 if(!type)throw new Error('type is required');
 if(!source)throw new Error('source is required');
 const db=client||pool;
 const key=eventKey||`${source}:${organizationId}:${type}:${personId||'global'}:${Date.now()}`;
 const kind=VALID_KIND.has(evidenceKind)?evidenceKind:'observation';
 const status=VALID_STATUS.has(verificationStatus)?verificationStatus:'observed';
 const result=await db.query(
 `INSERT INTO aria_events(
    organization_id,person_id,type,actor_id,source,event_key,metadata,occurred_at,
    evidence_kind,confidence,verification_status,scope_level,expires_at,actor_role,supersedes_event_id
  )VALUES($1::text,$2::uuid,$3::text,$4::uuid,$5::text,$6::text,$7::jsonb,COALESCE($8::timestamptz,NOW()),
    $9::text,$10::numeric,$11::text,$12::text,$13::timestamptz,$14::text,$15::uuid)
  ON CONFLICT(organization_id,event_key) DO NOTHING
  RETURNING *`,
 [organizationId,personId,type,actorId,source,key,metadata||{},occurredAt,kind,clamp(confidence),status,clean(scopeLevel,40)||'organization',expiresAt,actorRole,supersedesEventId]
 );
 return result.rows[0]||null;
}
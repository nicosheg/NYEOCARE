// lib/aria/eventEmitter.js
import pool from'../db';

export async function emitAriaEvent({organizationId,personId=null,type,actorId=null,source,metadata={},eventKey=null},client=null){
 if(!organizationId)throw new Error('organizationId is required');
 if(!type)throw new Error('type is required');
 if(!source)throw new Error('source is required');

 const key=eventKey||`${source}:${organizationId}:${type}:${personId||'global'}:${Date.now()}`;
 const db=client||pool;

 const result=await db.query(
  `INSERT INTO aria_events(organization_id,person_id,type,actor_id,source,metadata,event_key)
   VALUES($1,$2,$3,$4,$5,$6,$7)
   ON CONFLICT(organization_id,event_key) DO NOTHING
   RETURNING *`,
  [organizationId,personId,type,actorId,source,metadata,key]
 );

 return result.rows[0]||null;
}

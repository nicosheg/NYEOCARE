// lib/aria/personJourney.js
import pool from '../db';

export async function recordJourneyEvent(orgId,personId,eventType,eventData={}){
 if(!orgId||!personId||!eventType)throw new Error('orgId, personId and eventType are required');

 const person=await pool.query(`SELECT id FROM people WHERE id=$1 AND organization_id=$2 LIMIT 1`,[personId,orgId]);
 if(!person.rows.length)throw new Error('Person not found');

 const result=await pool.query(`
  INSERT INTO timeline_events(
   people_id,event_type,title,description,metadata,source,occurred_at,created_at
  )VALUES($1,$2,$3,$4,$5,'aria',NOW(),NOW())
  RETURNING *
 `,[
  personId,
  eventType,
  eventData?.title||eventType,
  eventData?.description||null,
  eventData&&typeof eventData==='object'?eventData:{}
 ]);

 return result.rows[0];
}

export async function getPersonJourney(orgId,personId){
 const result=await pool.query(`
  SELECT id,event_type,title,description,metadata,source,occurred_at,created_at
  FROM timeline_events
  WHERE people_id=$1
    AND COALESCE(metadata->>'privacy_class','standard')='standard'
    AND EXISTS(SELECT 1 FROM people p WHERE p.id=timeline_events.people_id AND p.organization_id=$2)
  ORDER BY occurred_at ASC,created_at ASC
 `,[personId,orgId]);
 return result.rows;
}

export async function getLatestJourneyEvent(orgId,personId){
 const result=await pool.query(`
  SELECT id,event_type,title,description,metadata,source,occurred_at,created_at
  FROM timeline_events
  WHERE people_id=$1
    AND COALESCE(metadata->>'privacy_class','standard')='standard'
    AND EXISTS(SELECT 1 FROM people p WHERE p.id=timeline_events.people_id AND p.organization_id=$2)
  ORDER BY occurred_at DESC,created_at DESC
  LIMIT 1
 `,[personId,orgId]);
 return result.rows[0]||null;
     }

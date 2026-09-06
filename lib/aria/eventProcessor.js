// lib/aria/eventProcessor.js
import pool from'../db';
import{createObservation}from'./observationEngine';
import{updatePeopleIntelligence}from'./peopleIntelligence';
import{updatePersonState}from'./stateManager';

export async function processAriaEvent(event,client=null){
 if(!event)throw new Error('ARIA event is required');

 const{ id:eventId,organization_id:orgId,person_id:personId,type,source,metadata={} }=event;

 if(!eventId||!orgId||!type)throw new Error('ARIA event id, organization_id and type are required');
 if(!personId)return null;

 const owns=!client;
 const db=client||await pool.connect();

 try{
  if(owns)await db.query('BEGIN');

  const existing=await db.query(
   `SELECT id FROM aria_observations
    WHERE organization_id=$1 AND metadata->>'source_event_id'=$2
    LIMIT 1`,
   [orgId,String(eventId)]
  );

  if(existing.rows.length){
   if(owns)await db.query('COMMIT');
   return existing.rows[0].id;
  }

  let observation=null;

  if(type==='PERSON_CREATED'){
   observation={
    type:'NEW_PERSON',
    confidence:Math.max(0,Math.min(1,Number(metadata.confidence??70)/100)),
    severity:'medium',
    urgency:'medium',
    evidence:{
     sources:source?[source]:[],
     facts:['Person became known to the organization'],
     inference:'New person discovered'
    }
   };
  }else if(type==='PERSON_UPDATED'){
   observation={
    type:'PERSON_UPDATE',
    confidence:.9,
    severity:'low',
    urgency:'low',
    evidence:{
     sources:source?[source]:[],
     facts:['Person information changed'],
     inference:'Person context changed'
    }
   };
  }else if(type==='PARTICIPATION_CONFIRMED'){
   observation={
    type:'PARTICIPATION_CONFIRMED',
    confidence:1,
    severity:'low',
    urgency:'low',
    evidence:{
     sources:source?[source]:[],
     facts:['Confirmed participation recorded'],
     inference:'Person participated'
    }
   };
  }else if(type==='CARE_FEEDBACK'){
   observation={
    type:'CARE_FEEDBACK',
    confidence:1,
    severity:'low',
    urgency:'low',
    evidence:{
     sources:source?[source]:[],
     facts:['Human care feedback recorded'],
     inference:'Care approach now has human evidence'
    }
   };
  }else{
   if(owns)await db.query('COMMIT');
   return null;
  }

  const observationId=await createObservation({
   organizationId:orgId,
   personId,
   type:observation.type,
   confidence:observation.confidence,
   severity:observation.severity,
   urgency:observation.urgency,
   evidence:observation.evidence,
   sourceEventId:eventId
  },db);

  await updatePeopleIntelligence(personId,orgId,db);
  await updatePersonState(personId,orgId,db);

  if(owns)await db.query('COMMIT');

  return observationId;
 }catch(err){
  if(owns)try{await db.query('ROLLBACK')}catch{}
  throw err;
 }finally{
  if(owns)db.release();
 }
}

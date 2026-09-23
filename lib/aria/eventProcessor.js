// lib/aria/eventProcessor.js
import pool from'../db';
import{createObservation}from'./observationEngine';
import{updatePeopleIntelligence}from'./peopleIntelligence';
import{updatePersonState}from'./stateManager';import{planActionFromObservation}from'./recommendationEngine';
import{refreshLivingTruth}from'./truthEngine';

export async function processAriaEvent(event,client=null){
 if(!event)throw new Error('ARIA event is required');

 const{ id:eventId,organization_id:orgId,person_id:personId,type,source,metadata={} }=event;

 if(!eventId||!orgId||!type)throw new Error('ARIA event id, organization_id and type are required');
 const globalEvent=!personId;
 if(!globalEvent&&!personId)return null;

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

  if(type==='SCAN_REVIEW_REQUIRED'){observation={type:'SCAN_REVIEW_REQUIRED',confidence:1,severity:'medium',urgency:'high',evidence:{sources:[source||'scan'],facts:['The latest scan contains records that ARIA cannot safely finalize without human review.'],inference:'Human confirmation is required before those records become trusted people.',...metadata}};
  }else if(type==='ATTENDANCE_PROCESSING_FAILED'){observation={type:'ARIA_PROCESSING_FAILURE',confidence:1,severity:'high',urgency:'high',evidence:{sources:[source||'attendance'],facts:['An attendance save completed but ARIA processing did not complete.'],inference:'The attendance record is safe, but ARIA memory may be incomplete until processing is retried.',...metadata}};
  }else if(type==='PERSON_CREATED'){
   observation={
    type:'NEW_PERSON',
    confidence:(()=>{const n=Number(metadata.confidence);return Number.isFinite(n)?Math.max(0,Math.min(1,n/100)):.7})(),
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

  if(personId){await updatePeopleIntelligence(personId,orgId,db);await updatePersonState(personId,orgId,db);if(!client)try{await refreshLivingTruth({organizationId:orgId,personId},db)}catch(truthErr){console.error('[ARIA] truth refresh',truthErr.message)}}
  const policy={SCAN_REVIEW_REQUIRED:{actionType:'REQUEST_REVIEW',priority:'medium',kind:'scan_review_required',summary:'The latest scan has information ARIA needs you to confirm.',suggestion:'Open Review Center and confirm the uncertain records.'},ATTENDANCE_PROCESSING_FAILED:{actionType:'ESCALATE',priority:'high',kind:'aria_processing_failure',summary:'ARIA could not finish understanding the latest attendance.',suggestion:'Retry ARIA processing before relying on attendance-derived follow-up.'},PERSON_CREATED:{actionType:'SEND_MESSAGE',priority:'low',kind:'new_person_welcome',summary:'A new person has been added to NYEOCARE.',suggestion:'Review a gentle welcome when appropriate.'}}[type];if(policy)await planActionFromObservation({organizationId:orgId,personId,observationId,actionType:policy.actionType,priority:policy.priority,actionMetadata:{kind:policy.kind,summary:policy.summary,suggestion:policy.suggestion,requires_human_approval:true,source_event_id:eventId,source_event_type:type,session_id:metadata?.session_id||null},actionKey:`director:${eventId}:${policy.kind}`},db);

  if(owns)await db.query('COMMIT');

  return observationId;
 }catch(err){
  if(owns)try{await db.query('ROLLBACK')}catch{}
  throw err;
 }finally{
  if(owns)db.release();
 }
}

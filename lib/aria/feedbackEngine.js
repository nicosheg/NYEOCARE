// lib/aria/feedbackEngine.js
import pool from'../db';
import{emitAriaEvent}from'./eventEmitter';
import{processAriaEvent}from'./eventProcessor';
import{updatePeopleIntelligence}from'./peopleIntelligence';
import{updatePersonState}from'./stateManager';
import{learnFromFeedback}from'./learningEngine';

const TYPES=new Set(['positive','negative','helpful','ineffective','worked','did_not_work','relationship_strengthened','new_information','timing_wrong','no_response','other']);
const SENTIMENTS=new Set(['positive','negative','neutral','mixed']);
const POSITIVE=new Set(['positive','helpful','worked','relationship_strengthened']);
const NEGATIVE=new Set(['negative','ineffective','did_not_work','timing_wrong']);
const clean=(v,max=3000)=>String(v??'').trim().slice(0,max);

export async function getCareFeedback({organizationId,personId,limit=100,role='user',actorId=null}){
 if(!organizationId||!personId)throw new Error('organizationId and personId are required');
 const safeLimit=Math.min(Math.max(Number(limit)||100,1),200);
 const q=await pool.query(`SELECT * FROM care_feedback WHERE organization_id=$1 AND person_id=$2
  AND (COALESCE(context->>'privacy_class','standard')='standard'
    OR (context->>'privacy_class'='sensitive' AND ($4::text IN('owner','admin','leader') OR context->>'privacy_reporter_id'=$5::text))
    OR (context->>'privacy_class'='restricted' AND ($4::text IN('owner','admin') OR context->>'privacy_reporter_id'=$5::text)))
  ORDER BY observed_at DESC,created_at DESC LIMIT $3`,[organizationId,personId,safeLimit,String(role||'').toLowerCase(),actorId]);
 return{feedback:q.rows,count:q.rows.length};
}

export async function recordCareFeedback({organizationId,personId,feedbackType,sentiment='neutral',note='',actionId=null,actorId=null,actorRole='user',context={},observedAt=null}){
 if(!organizationId||!personId)throw new Error('organizationId and personId are required');
 if(!actorId)throw Object.assign(new Error('An authenticated operator is required to record care feedback.'),{status:403});
 if(!TYPES.has(feedbackType))throw new Error('Invalid feedback type');
 if(!SENTIMENTS.has(sentiment))throw new Error('Invalid sentiment');
 const client=await pool.connect();
 let feedback=null,outcome=null,event=null,sourceEventId=null,actionMetadata={};
 let privacyClass='standard',privacyReporterId=null,consentStatus='unknown',safeContext={},at=observedAt||new Date().toISOString();
 try{
  await client.query('BEGIN');
  const person=await client.query("SELECT id FROM people WHERE id=$1 AND organization_id=$2 AND COALESCE(status,'active')='active' LIMIT 1 FOR SHARE",[personId,organizationId]);
  if(!person.rows.length)throw Object.assign(new Error('Person not found'),{status:404});
  if(actionId){
   const action=await client.query("SELECT id,action_metadata FROM aria_actions WHERE id=$1 AND organization_id=$2 AND person_id=$3 LIMIT 1 FOR SHARE",[actionId,organizationId,personId]);
   if(!action.rows.length)throw Object.assign(new Error('Action not found'),{status:404});
   actionMetadata=action.rows[0].action_metadata||{};
  }
  const actor=(await client.query("SELECT id,role FROM users WHERE id=$1 AND organization_id=$2 AND active=true LIMIT 1 FOR SHARE",[actorId,organizationId])).rows[0];
  if(!actor)throw Object.assign(new Error('Actor not found'),{status:403});
  const role=String(actor.role||actorRole||'').toLowerCase();
  if(!['owner','admin','leader','worker','user'].includes(role))throw Object.assign(new Error('Only active organization operators can record care feedback.'),{status:403});

  safeContext={...(context&&typeof context==='object'&&!Array.isArray(context)?context:{})};
  delete safeContext.privacy_class;
  delete safeContext.privacy_reporter_id;
  delete safeContext.consent_status;
  privacyClass=['standard','sensitive','restricted'].includes(actionMetadata.privacy_class)?actionMetadata.privacy_class:'standard';
  privacyReporterId=actionMetadata.privacy_reporter_id||null;
  consentStatus=['unknown','granted','declined','withdrawn','not_required'].includes(actionMetadata.consent_status)?actionMetadata.consent_status:'unknown';
  const allowed=privacyClass==='standard'||String(actorId)===String(privacyReporterId)||(privacyClass==='sensitive'&&['owner','admin','leader'].includes(role))||(privacyClass==='restricted'&&['owner','admin'].includes(role));
  if(!allowed)throw Object.assign(new Error('You cannot add feedback to this private care record.'),{status:403});
  if(privacyClass!=='standard')Object.assign(safeContext,{privacy_class:privacyClass,privacy_reporter_id:privacyReporterId,consent_status:consentStatus});
  const expiresAt=safeContext.valid_until||safeContext.expires_at||null;

  feedback=(await client.query(
   "INSERT INTO care_feedback(organization_id,person_id,action_id,actor_id,feedback_type,sentiment,note,context,observed_at,evidence_kind,verification_status,confidence,expires_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'human_report','reported',1,$10,NOW(),NOW()) RETURNING *",
   [organizationId,personId,actionId,actorId,feedbackType,sentiment,clean(note),safeContext,at,expiresAt]
  )).rows[0];

  const score=POSITIVE.has(feedbackType)?1:NEGATIVE.has(feedbackType)?0:null;
  outcome=(await client.query(
   "INSERT INTO intelligence_outcomes(organization_id,person_id,action_id,action_type,outcome,outcome_score,evidence,actor_id,feedback_id,observed_at,evidence_kind,verification_status,confidence,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'human_report','reported',1,NOW()) RETURNING *",
   [organizationId,personId,actionId,'care',feedbackType,score,{feedback_type:feedbackType,sentiment,note:feedback.note,context:safeContext},actorId,feedback.id,at]
  )).rows[0];

  if(privacyClass==='standard')await client.query(
   "INSERT INTO timeline_events(people_id,event_type,title,description,metadata,source,occurred_at,created_at) VALUES($1,'care_feedback','Care feedback',COALESCE($2,$3),$4,'human',$5,NOW())",
   [personId,clean(note,1000)||null,`Human feedback: ${feedbackType}`,{feedback_id:feedback.id,action_id,feedback_type:feedbackType,sentiment},at]
  );

  event=await emitAriaEvent({
   organizationId,personId,type:'CARE_FEEDBACK',source:'human',actorId,actorRole:role,
   evidenceKind:'human_report',verificationStatus:'reported',confidence:1,expiresAt,privacyClass,consentStatus,
   metadata:{
    feedback_id:feedback.id,feedback_type:feedbackType,sentiment,
    outcome:{outcome:feedbackType,outcome_score:score,feedback_id:feedback.id,action_id:actionId},
    statement:clean(note,1200),
    memory:feedbackType==='new_information'&&clean(note)
     ?{type:'operator_context',key:'feedback:'+feedback.id,content:clean(note,4000),metadata:{feedback_type:feedbackType,context:safeContext}}
     :null
   },
   eventKey:`feedback:${feedback.id}`
  },client);
  if(!event?.id)throw new Error('The care feedback event could not be linked safely.');
  sourceEventId=event.id;
  await client.query(
   "UPDATE care_feedback SET source_event_id=$1,updated_at=NOW() WHERE id=$2 AND organization_id=$3",
   [sourceEventId,feedback.id,organizationId]
  );
  await client.query(
   "UPDATE intelligence_outcomes SET source_event_id=$1 WHERE id=$2 AND organization_id=$3",
   [sourceEventId,outcome.id,organizationId]
  );
  await client.query('COMMIT');
 }catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  throw error;
 }finally{
  client.release();
 }

 let intelligence=null,state=null,learningPending=false,eventProcessingPending=false;
 try{await processAriaEvent(event);}catch(error){
  eventProcessingPending=true;
  console.error('[ARIA] feedback event processing deferred:',error?.message||error);
 }
 if(privacyClass==='standard'){
  try{
   await learnFromFeedback({organizationId,personId,feedbackId:feedback.id,actionId,feedbackType,sentiment,context:safeContext,actorId});
   intelligence=await updatePeopleIntelligence(personId,organizationId);
   state=await updatePersonState(personId,organizationId);
  }catch(error){
   learningPending=true;
   console.error('[ARIA] feedback intelligence refresh deferred:',error?.message||error);
  }
 }
 return{
  feedback:{...feedback,source_event_id:sourceEventId},
  outcome:{...outcome,source_event_id:sourceEventId},
  event_id:sourceEventId,
  intelligence,
  state,
  learning_pending:learningPending,
  event_processing_pending:eventProcessingPending
 };
}

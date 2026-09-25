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

export async function getCareFeedback({organizationId,personId,limit=100}){
 if(!organizationId||!personId)throw new Error('organizationId and personId are required');
 const safeLimit=Math.min(Math.max(Number(limit)||100,1),200);
 const q=await pool.query("SELECT * FROM care_feedback WHERE organization_id=$1 AND person_id=$2 ORDER BY observed_at DESC,created_at DESC LIMIT $3",[organizationId,personId,safeLimit]);
 return{feedback:q.rows,count:q.rows.length};
}

export async function recordCareFeedback({organizationId,personId,feedbackType,sentiment='neutral',note='',actionId=null,actorId=null,context={},observedAt=null}){
 if(!organizationId||!personId)throw new Error('organizationId and personId are required');
 if(!TYPES.has(feedbackType))throw new Error('Invalid feedback type');
 if(!SENTIMENTS.has(sentiment))throw new Error('Invalid sentiment');
 const person=await pool.query("SELECT id FROM people WHERE id=$1 AND organization_id=$2 AND COALESCE(status,'active')='active' LIMIT 1",[personId,organizationId]);
 if(!person.rows.length)throw Object.assign(new Error('Person not found'),{status:404});
 if(actionId){
  const action=await pool.query("SELECT id FROM aria_actions WHERE id=$1 AND organization_id=$2 AND person_id=$3 LIMIT 1",[actionId,organizationId,personId]);
  if(!action.rows.length)throw Object.assign(new Error('Action not found'),{status:404});
 }
 if(actorId){
  const actor=await pool.query("SELECT id FROM users WHERE id=$1 AND organization_id=$2 AND active=true LIMIT 1",[actorId,organizationId]);
  if(!actor.rows.length)throw Object.assign(new Error('Actor not found'),{status:403});
 }
 const safeContext=context&&typeof context==='object'?context:{};
 const expiresAt=safeContext.valid_until||safeContext.expires_at||null;
 const at=observedAt||new Date().toISOString();
 const feedback=(await pool.query(
  "INSERT INTO care_feedback(organization_id,person_id,action_id,actor_id,feedback_type,sentiment,note,context,observed_at,evidence_kind,verification_status,confidence,expires_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'human_report','reported',1,$10,NOW(),NOW()) RETURNING *",
  [organizationId,personId,actionId,actorId,feedbackType,sentiment,clean(note),safeContext,at,expiresAt]
 )).rows[0];
 const score=POSITIVE.has(feedbackType)?1:NEGATIVE.has(feedbackType)?0:null;
 const outcome=(await pool.query(
  "INSERT INTO intelligence_outcomes(organization_id,person_id,action_id,action_type,outcome,outcome_score,evidence,actor_id,feedback_id,observed_at,evidence_kind,verification_status,confidence,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'human_report','reported',1,NOW()) RETURNING *",
  [organizationId,personId,actionId,'care',feedbackType,score,{feedback_type:feedbackType,sentiment,note:feedback.note,context:safeContext},actorId,feedback.id,at]
 )).rows[0];
 await pool.query(
  "INSERT INTO timeline_events(people_id,event_type,title,description,metadata,source,occurred_at,created_at) VALUES($1,'care_feedback','Care feedback',COALESCE($2,$3),$4,'human',$5,NOW())",
  [personId,clean(note,1000),`Human feedback: ${feedbackType}`,{feedback_id:feedback.id,action_id,feedback_type,sentiment},at]
 );
 let sourceEventId=null;
 try{
  const memory=feedbackType==='new_information'&&clean(note)
   ?{type:'operator_context',key:'feedback:'+feedback.id,content:clean(note,4000),metadata:{feedback_type:feedbackType,context:safeContext}}
   :null;
  const event=await emitAriaEvent({
   organizationId,personId,type:'CARE_FEEDBACK',source:'human',actorId,
   evidenceKind:'human_report',verificationStatus:'reported',confidence:1,expiresAt,
   metadata:{
    feedback_id:feedback.id,feedback_type:feedbackType,sentiment,
    outcome:{outcome:feedbackType,outcome_score:score,feedback_id:feedback.id,action_id:actionId},
    statement:clean(note,1200),
    memory
   },
   eventKey:`feedback:${feedback.id}`
  });
  sourceEventId=event?.id||null;
  if(sourceEventId){
   await pool.query("UPDATE intelligence_outcomes SET source_event_id=$1 WHERE id=$2 AND organization_id=$3",[sourceEventId,outcome.id,organizationId]);
   if(event)await processAriaEvent(event);
  }
 }catch(e){
  console.error('[ARIA] feedback event',e.message);
 }
 await learnFromFeedback({organizationId,personId,feedbackId:feedback.id,actionId,feedbackType,sentiment,context:safeContext,actorId},null);
 const intelligence=await updatePeopleIntelligence(personId,organizationId);
 const state=await updatePersonState(personId,organizationId);
 return{feedback,outcome:{...outcome,source_event_id:sourceEventId||outcome.source_event_id||null},intelligence,state};
}

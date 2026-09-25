// lib/aria/outcomeEngine.js
import pool from '../db';
import{learnFromOutcome}from'./learningEngine';
import{updatePeopleIntelligence}from'./peopleIntelligence';
import{updatePersonState}from'./stateManager';

export async function recordOutcome(orgId,personId,outcomeType,outcomeScore=null,actionId=null,evidence={},actorId=null,feedbackId=null,sourceEventId=null){
 if(!orgId||!personId||!outcomeType)throw new Error('orgId, personId and outcomeType are required');
 if(outcomeScore!==null&&(!Number.isFinite(Number(outcomeScore))||Number(outcomeScore)<0||Number(outcomeScore)>1))throw new Error('outcomeScore must be between 0 and 1');

 const person=await pool.query(`SELECT id FROM people WHERE id=$1 AND organization_id=$2 AND COALESCE(status,'active')='active' LIMIT 1`,[personId,orgId]);
 if(!person.rows.length)throw new Error('Person not found');

 let actionType='care';
 if(actionId){
  const action=await pool.query(`SELECT type FROM aria_actions WHERE id=$1 AND organization_id=$2 AND person_id=$3 LIMIT 1`,[actionId,orgId,personId]);
  if(!action.rows.length)throw new Error('Action does not belong to organization/person');
  actionType=action.rows[0].type;
 }

 if(actorId){
  const actor=await pool.query(`SELECT id FROM users WHERE id=$1 AND organization_id=$2 AND active=true LIMIT 1`,[actorId,orgId]);
  if(!actor.rows.length)throw new Error('Actor does not belong to organization');
 }

 if(feedbackId){
  const feedback=await pool.query(`SELECT id FROM care_feedback WHERE id=$1 AND organization_id=$2 AND person_id=$3 LIMIT 1`,[feedbackId,orgId,personId]);
  if(!feedback.rows.length)throw new Error('Feedback does not belong to organization/person');
 }

 const result=await pool.query(`
  INSERT INTO intelligence_outcomes(
   organization_id,person_id,action_id,action_type,outcome,outcome_score,evidence,actor_id,feedback_id,observed_at,evidence_kind,verification_status,confidence,source_event_id,created_at
  )VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),'observation','observed',COALESCE($10,0.8),$11,NOW())
  RETURNING *
 `,[orgId,personId,actionId,actionType,outcomeType,outcomeScore,evidence&&typeof evidence==='object'?evidence:{},actorId,feedbackId,sourceEventId?1:.8,sourceEventId]);

 const outcome=result.rows[0];

 await learnFromOutcome({
  organizationId:orgId,
  personId,
  actionId,
  outcome:outcomeType,
  outcomeScore,
  evidence
 });

 const intelligence=await updatePeopleIntelligence(personId,orgId);
 const state=await updatePersonState(personId,orgId);

 return{outcome,intelligence,state};
}

export async function getOutcomesForPerson(orgId,personId){
 if(!orgId||!personId)throw new Error('orgId and personId required');
 const result=await pool.query(`
  SELECT *
  FROM intelligence_outcomes
  WHERE organization_id=$1 AND person_id=$2
  ORDER BY observed_at DESC,created_at DESC
 `,[orgId,personId]);
 return result.rows;
}

export async function getOutcomeStats(orgId){
 if(!orgId)throw new Error('orgId required');
 const result=await pool.query(`
  SELECT outcome,COUNT(*)::int AS count,ROUND(AVG(outcome_score),3) AS average_score
  FROM intelligence_outcomes
  WHERE organization_id=$1
  GROUP BY outcome
  ORDER BY count DESC
 `,[orgId]);
 return result.rows;
                                  }

// lib/aria/capabilityEngine.js
import pool from'../db';
import{createCareDraft}from'./draftEngine';
import{getPendingActions,planActionFromObservation}from'./recommendationEngine';
import{getCareOpportunities}from'./careEngine';

const clean=(v,max=4000)=>String(v??'').trim().slice(0,max);
const nameOf=p=>clean(p.display_name||[p.first_name,p.last_name].filter(Boolean).join(' ')||p.first_name||'Unknown',160);

async function findPerson(organizationId,name){
 const q=clean(name,120);
 if(!q)return[];

 const normalized=q.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 const tokens=normalized.split(/\s+/).filter(Boolean);
 if(!tokens.length)return[];

 const pattern=`(^| )${tokens.join(' ')}( |$)`;

 const result=await pool.query(
  `SELECT id,first_name,last_name,display_name,phone,email,type
   FROM people
   WHERE organization_id=$1
     AND COALESCE(status,'active')='active'
     AND(
       lower(regexp_replace(trim(concat_ws(' ',first_name,last_name)),'[^a-z0-9]+',' ','g')) ~ $2
       OR lower(regexp_replace(trim(coalesce(display_name,'')),'[^a-z0-9]+',' ','g')) ~ $2
       OR lower(first_name)=lower($3)
       OR lower(last_name)=lower($3)
     )
   ORDER BY first_name,last_name
   LIMIT 10`,
  [organizationId,pattern,normalized]
 );

 return result.rows;
}

async function personContext(organizationId,personId){
 const[person,intelligence,state,memory,timeline,feedback]=await Promise.all([
  pool.query(`SELECT id,first_name,last_name,display_name,phone,email,type FROM people WHERE id=$1 AND organization_id=$2 AND COALESCE(status,'active')='active' LIMIT 1`,[personId,organizationId]),
  pool.query(`SELECT lifecycle_state,engagement_score,attention_score,next_best_action,action_reason,evidence FROM people_intelligence WHERE person_id=$1 AND organization_id=$2 LIMIT 1`,[personId,organizationId]),
  pool.query(`SELECT * FROM aria_person_state WHERE person_id=$1 AND organization_id=$2 LIMIT 1`,[personId,organizationId]),
  pool.query(`SELECT memory_type,content,importance,confidence FROM person_memory WHERE person_id=$1 AND organization_id=$2 AND active=true ORDER BY updated_at DESC LIMIT 12`,[personId,organizationId]),
  pool.query(`SELECT event_type,title,description,occurred_at FROM timeline_events WHERE people_id=$1 ORDER BY occurred_at DESC,created_at DESC LIMIT 15`,[personId]),
  pool.query(`SELECT feedback_type,sentiment,note,observed_at FROM care_feedback WHERE person_id=$1 AND organization_id=$2 ORDER BY observed_at DESC LIMIT 10`,[personId,organizationId])
 ]);

 if(!person.rows.length)return null;

 return{
  person:person.rows[0],
  intelligence:intelligence.rows[0]||null,
  state:state.rows[0]||null,
  memory:memory.rows,
  timeline:timeline.rows,
  feedback:feedback.rows
 };
}

export async function executeCapability({organizationId,capability,personId=null,personName=null,parameters={},actorId=null}){
 if(!organizationId)throw new Error('organizationId required');

 switch(capability){
  case'find_person':
   return{capability,results:await findPerson(organizationId,personName||parameters.name)};

  case'get_person_context':
  case'explain_person':{
   if(!personId)throw Object.assign(new Error('personId required'),{status:400});
   const context=await personContext(organizationId,personId);
   if(!context)throw Object.assign(new Error('Person not found'),{status:404});
   return{capability,...context};
  }

  case'get_care_recommendations':
   return{capability,recommendations:await getCareOpportunities(organizationId)};

  case'get_pending_actions':
   return{capability,actions:await getPendingActions(organizationId,parameters.limit||20)};

  case'prepare_message':{
   if(!personId)throw Object.assign(new Error('personId required'),{status:400});
   const draft=await createCareDraft({
    organizationId,
    personId,
    actionId:parameters.actionId||null,
    actionType:parameters.actionType||'thoughtful_check_in',
    actorId
   });
   return{capability,requiresApproval:true,requiresHumanSend:true,draft};
  }

  case'prepare_action':{
   if(!personId)throw Object.assign(new Error('personId required'),{status:400});
   const action=await planActionFromObservation({
    organizationId,
    personId,
    actionType:parameters.actionType||'SEND_MESSAGE',
    priority:parameters.priority||'medium',
    actionMetadata:{
     ...(parameters.metadata||{}),
     request:clean(parameters.request||'',1000),
     source:'aria_capability_engine',
     requires_human_approval:true
    }
   });
   return{capability,requiresApproval:true,action};
  }

  default:
   throw Object.assign(new Error(`Unsupported ARIA capability: ${capability}`),{status:400});
 }
}

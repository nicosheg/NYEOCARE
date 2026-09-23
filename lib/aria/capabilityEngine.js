// lib/aria/capabilityEngine.js
import pool from'../db';
import{getOrganizationContext,getOperatorContext}from'./organizationContext';
import{getLivingTruth}from'./truthEngine';
import{getOrganizationChanges,getPersonTimeline}from'./temporalEngine';
import{getAttentionSummary}from'./attentionEngine';
import{createCareDraft}from'./draftEngine';
import{getPendingActions,planActionFromObservation}from'./recommendationEngine';
import{getCareOpportunities}from'./careEngine';

const clean=(v,max=4000)=>String(v??'').trim().slice(0,max);

async function findPerson(organizationId,name){
 const q=clean(name,120);
 if(!q)return[];

 const normalized=q.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 if(!normalized)return[];

 const tokens=normalized.split(/\s+/).filter(Boolean);
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

async function personRecord(organizationId,personId){
 const r=await pool.query("SELECT p.id,p.first_name,p.last_name,p.display_name,p.phone,p.email,p.type,em.last_seen,(SELECT MAX(z.at) FROM(SELECT MAX(pc.occurred_at) AS at FROM person_communications pc WHERE pc.organization_id=p.organization_id AND pc.person_id=p.id AND pc.status IN('completed','sent','delivered','received') UNION ALL SELECT MAX(te.occurred_at) AS at FROM timeline_events te WHERE te.people_id=p.id AND te.source IN('human','conversation_import') AND te.event_type NOT IN('identity_review','aria_draft','scan_review'))z) AS last_interaction_at FROM people p LEFT JOIN engagement_metrics em ON em.organization_id=p.organization_id AND em.person_id=p.id WHERE p.id=$1 AND p.organization_id=$2 AND COALESCE(p.status,'active')='active' LIMIT 1",[personId,organizationId]);
 return r.rows[0]||null;
}

async function personContext(organizationId,personId){
 const person=await personRecord(organizationId,personId);
 if(!person)return null;
 const[intelligence,state,memory,timeline,feedback,livingTruth]=await Promise.all([
  pool.query("SELECT lifecycle_state,engagement_score,attention_score,next_best_action,action_reason,evidence FROM people_intelligence WHERE person_id=$1 AND organization_id=$2 LIMIT 1",[personId,organizationId]),
  pool.query("SELECT * FROM aria_person_state WHERE person_id=$1 AND organization_id=$2 LIMIT 1",[personId,organizationId]),
  pool.query("SELECT memory_type,content,importance,confidence,source,updated_at FROM person_memory WHERE person_id=$1 AND organization_id=$2 AND active=true ORDER BY updated_at DESC LIMIT 12",[personId,organizationId]),
  getPersonTimeline({organizationId,personId,limit:30}),
  pool.query("SELECT feedback_type,sentiment,note,observed_at FROM care_feedback WHERE person_id=$1 AND organization_id=$2 ORDER BY observed_at DESC LIMIT 10",[personId,organizationId]),
  getLivingTruth({organizationId,personId})
 ]);
 return{person,intelligence:intelligence.rows[0]||null,state:state.rows[0]||null,memory:memory.rows,timeline,feedback:feedback.rows,living_truth:livingTruth};
}

async function personTimelineContext(organizationId,personId){
 const person=await personRecord(organizationId,personId);
 if(!person)return null;
 return{person,timeline:await getPersonTimeline({organizationId,personId,limit:60})};
}

async function personEvidenceContext(organizationId,personId){
 const person=await personRecord(organizationId,personId);
 if(!person)return null;
 const[memory,feedback,livingTruth]=await Promise.all([
  pool.query("SELECT memory_type,content,importance,confidence,source,updated_at FROM person_memory WHERE person_id=$1 AND organization_id=$2 AND active=true ORDER BY updated_at DESC LIMIT 20",[personId,organizationId]),
  pool.query("SELECT feedback_type,sentiment,note,observed_at FROM care_feedback WHERE person_id=$1 AND organization_id=$2 ORDER BY observed_at DESC LIMIT 20",[personId,organizationId]),
  getLivingTruth({organizationId,personId})
 ]);
 return{person,living_truth:livingTruth,memory:memory.rows,feedback:feedback.rows};
}

export async function executeCapability({organizationId,capability,personId=null,personName=null,parameters={},actorId=null}){
 if(!organizationId)throw new Error('organizationId required');

 switch(capability){
  case'find_person':
   return{capability,results:await findPerson(organizationId,personName||parameters.name)};

  case'get_organization_context':
   return{capability,...await getOrganizationContext({organizationId,viewerId:actorId})};

  case'get_operator_context':
   return{capability,...await getOperatorContext({organizationId,viewerId:actorId,operatorName:parameters.operator_name||parameters.name||null})};
 
  case'get_organization_changes':
   return{capability,...await getOrganizationChanges(organizationId,{days:parameters.days||30,limit:parameters.limit||25})};

  case'get_attention_summary':
   return{capability,...await getAttentionSummary(organizationId,{limit:parameters.limit||8})};

  case'get_person_timeline':{
   if(!personId)throw Object.assign(new Error('personId required'),{status:400});
   const context=await personTimelineContext(organizationId,personId);
   if(!context)throw Object.assign(new Error('Person not found'),{status:404});
   return{capability,person:context.person,timeline:context.timeline};
  }

  case'get_person_evidence':{
   if(!personId)throw Object.assign(new Error('personId required'),{status:400});
   const context=await personEvidenceContext(organizationId,personId);
   if(!context)throw Object.assign(new Error('Person not found'),{status:404});
   return{capability,person:context.person,living_truth:context.living_truth,memory:context.memory,feedback:context.feedback};
  }

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

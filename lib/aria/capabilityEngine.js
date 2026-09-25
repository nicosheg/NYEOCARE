// lib/aria/capabilityEngine.js
import pool from'../db';
import{getOrganizationContext,getOperatorContext}from'./organizationContext';
import{getLivingTruth}from'./truthEngine';
import{getOrganizationChanges,getPersonTimeline}from'./temporalEngine';
import{getAttentionSummary}from'./attentionEngine';
import{createCareDraft}from'./draftEngine';
import{getPendingActions,planActionFromObservation}from'./recommendationEngine';
import{getCareOpportunities}from'./careEngine';
import{setPersonMemory,setOrganizationMemory,upsertPersonRelationship}from'./memoryEngine';
import{emitAriaEvent}from'./eventEmitter';

const clean=(v,max=4000)=>String(v??'').trim().slice(0,max);

async function requireActor(organizationId,actorId){
 const r=await pool.query("SELECT id,role FROM users WHERE id=$1 AND organization_id=$2 AND active=true LIMIT 1",[actorId,organizationId]);
 if(!r.rows.length)throw Object.assign(new Error('Authenticated organization actor required.'),{status:403});
 return r.rows[0];
}
async function requireAdmin(organizationId,actorId){const actor=await requireActor(organizationId,actorId);if(!['owner','admin'].includes(actor.role))throw Object.assign(new Error('Owner or admin permission required.'),{status:403});return actor;}

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
 const[intelligence,state,memory,timeline,feedback,livingTruth,memberships,roles]=await Promise.all([
  pool.query("SELECT lifecycle_state,engagement_score,attention_score,next_best_action,action_reason,evidence FROM people_intelligence WHERE person_id=$1 AND organization_id=$2 LIMIT 1",[personId,organizationId]),
  pool.query("SELECT * FROM aria_person_state WHERE person_id=$1 AND organization_id=$2 LIMIT 1",[personId,organizationId]),
  pool.query("SELECT memory_type,memory_key,content,importance,confidence,source,evidence_kind,verification_status,valid_until,updated_at FROM person_memory WHERE person_id=$1 AND organization_id=$2 AND active=true AND is_current=true AND(valid_until IS NULL OR valid_until>NOW()) ORDER BY confidence DESC,updated_at DESC LIMIT 12",[personId,organizationId]),
  getPersonTimeline({organizationId,personId,limit:30}),
  pool.query("SELECT feedback_type,sentiment,note,observed_at,evidence_kind,verification_status,confidence,expires_at FROM care_feedback WHERE person_id=$1 AND organization_id=$2 AND(expires_at IS NULL OR expires_at>NOW()) ORDER BY observed_at DESC LIMIT 10",[personId,organizationId]),
  getLivingTruth({organizationId,personId}),
  pool.query("SELECT pm.group_id,g.name,g.group_type,g.description,pm.membership_type,pm.status,pm.role,pm.start_date,pm.end_date FROM person_memberships pm JOIN organization_groups g ON g.id=pm.group_id AND g.organization_id=pm.organization_id WHERE pm.organization_id=$1 AND pm.person_id=$2 AND pm.status='active' AND(g.active=true OR g.active IS NULL) ORDER BY pm.start_date DESC NULLS LAST,g.name LIMIT 30",[organizationId,personId]),
  pool.query("SELECT role,status,start_date,end_date,metadata FROM person_roles WHERE organization_id=$1 AND person_id=$2 AND status='active' ORDER BY start_date DESC NULLS LAST LIMIT 30",[organizationId,personId])
 ]);
 return{person,intelligence:intelligence.rows[0]||null,state:state.rows[0]||null,memory:memory.rows,timeline,feedback:feedback.rows,memberships:memberships.rows,roles:roles.rows,living_truth:livingTruth};
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
  pool.query("SELECT memory_type,memory_key,content,importance,confidence,source,evidence_kind,verification_status,valid_until,updated_at FROM person_memory WHERE person_id=$1 AND organization_id=$2 AND active=true AND is_current=true AND(valid_until IS NULL OR valid_until>NOW()) ORDER BY confidence DESC,updated_at DESC LIMIT 20",[personId,organizationId]),
  pool.query("SELECT feedback_type,sentiment,note,observed_at,evidence_kind,verification_status,confidence,expires_at FROM care_feedback WHERE person_id=$1 AND organization_id=$2 AND(expires_at IS NULL OR expires_at>NOW()) ORDER BY observed_at DESC LIMIT 20",[personId,organizationId]),
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

  case'remember_person_fact':{
   if(!personId)throw Object.assign(new Error('personId required'),{status:400});
   const actor=await requireActor(organizationId,actorId);
   const factual=clean(parameters.content||parameters.fact||'',4000);
   if(!factual)throw Object.assign(new Error('A fact or context statement is required.'),{status:400});
   const memory=await setPersonMemory({organizationId,personId,memoryType:clean(parameters.memoryType||'operator_context',120),memoryKey:clean(parameters.memoryKey||('operator:'+actor.id+':'+Date.now()),160),content:factual,confidence:parameters.confidence??.9,evidenceKind:'human_report',verificationStatus:parameters.verificationStatus||'reported',source:'operator',createdBy:actor.id,actorRole:actor.role,validUntil:parameters.validUntil||null,metadata:parameters.metadata&&typeof parameters.metadata==='object'?parameters.metadata:{}});
   const event=await emitAriaEvent({organizationId,personId,type:'NEW_CONTEXT_ADDED',source:'operator',actorId:actor.id,actorRole:actor.role,evidenceKind:'human_report',verificationStatus:'reported',confidence:parameters.confidence??.9,expiresAt:parameters.validUntil||null,metadata:{memory:{type:memory.memory_type,key:memory.memory_key,content:memory.content,metadata:memory.metadata},statement:clean(parameters.reason,600)},eventKey:'memory:person:'+memory.id});
   return{capability,memory,event_id:event?.id||null,remembered:true};
  }
  case'remember_organization_fact':{
   const actor=await requireAdmin(organizationId,actorId);
   const memoryKey=clean(parameters.memoryKey||parameters.key||'',160);
   if(!memoryKey)throw Object.assign(new Error('memoryKey is required.'),{status:400});
   const value=parameters.value&&typeof parameters.value==='object'?parameters.value:{content:parameters.content||parameters.fact||''};
   if(!Object.keys(value).length || !String(value.content??parameters.content??parameters.fact??'').trim())throw Object.assign(new Error('An organization fact or rule is required.'),{status:400});
   const memory=await setOrganizationMemory({organizationId,memoryType:clean(parameters.memoryType||'organizational_rule',120),memoryKey:clean(parameters.memoryKey||parameters.key||'',160),value:parameters.value&&typeof parameters.value==='object'?parameters.value:{content:parameters.content||parameters.fact||''},confidence:parameters.confidence??.95,evidenceKind:'human_report',verificationStatus:'reported',source:'operator',createdBy:actor.id,validUntil:parameters.validUntil||null,metadata:parameters.metadata&&typeof parameters.metadata==='object'?parameters.metadata:{}});
   const event=await emitAriaEvent({organizationId,type:'ORGANIZATION_RULE_LEARNED',source:'operator',actorId:actor.id,actorRole:actor.role,evidenceKind:'human_report',verificationStatus:'reported',confidence:parameters.confidence??.95,expiresAt:parameters.validUntil||null,metadata:{memory:{type:memory.memory_type,key:memory.memory_key,value:memory.memory_value},statement:clean(parameters.reason,600)},eventKey:'memory:organization:'+memory.id});
   return{capability,memory,event_id:event?.id||null,remembered:true};
  }
  case'remember_relationship':{
   const actor=await requireAdmin(organizationId,actorId);
   if(!personId||!parameters.relatedPersonId)throw Object.assign(new Error('relatedPersonId required'),{status:400});
   const relationship=await upsertPersonRelationship({organizationId,personId,relatedPersonId:parameters.relatedPersonId,relationshipType:clean(parameters.relationshipType||'related_to',120),strength:parameters.strength??.5,confidence:parameters.confidence??.9,evidence:parameters.evidence&&typeof parameters.evidence==='object'?parameters.evidence:{},evidenceKind:'human_report',verificationStatus:'reported',source:'operator',createdBy:actor.id});
   const event=await emitAriaEvent({organizationId,personId,type:parameters.corrected?'RELATIONSHIP_CORRECTED':'RELATIONSHIP_CREATED',source:'operator',actorId:actor.id,actorRole:actor.role,evidenceKind:'human_report',verificationStatus:'reported',confidence:parameters.confidence??.9,metadata:{related_person_id:relationship.related_person_id,relationship_type:relationship.relationship_type,strength:relationship.strength,evidence:relationship.evidence},eventKey:'relationship:'+relationship.id});
   return{capability,relationship,event_id:event?.id||null,remembered:true};
  }
  case'set_event_semantics':{
   const actor=await requireAdmin(organizationId,actorId);
   const sessionId=parameters.sessionId;if(!sessionId)throw Object.assign(new Error('sessionId required'),{status:400});
   const event=await pool.query("UPDATE sessions SET event_kind=COALESCE($3,event_kind),event_scope=COALESCE($4,event_scope),group_id=COALESCE($5,group_id),event_semantics=COALESCE($6::jsonb,event_semantics),expected_population_rule=COALESCE($7::jsonb,expected_population_rule),attendance_interpretation=COALESCE($8,attendance_interpretation),participation_expected=COALESCE($9,participation_expected),optional=COALESCE($10,optional),absence_meaningful=COALESCE($11,absence_meaningful) WHERE id=$1 AND organization_id=$2 RETURNING *",[sessionId,organizationId,parameters.eventKind||null,parameters.eventScope||null,parameters.groupId||null,parameters.eventSemantics?JSON.stringify(parameters.eventSemantics):null,parameters.expectedPopulationRule?JSON.stringify(parameters.expectedPopulationRule):null,parameters.attendanceInterpretation??null,parameters.participationExpected??null,parameters.optional??null,parameters.absenceMeaningful??null]);
   if(!event.rows.length)throw Object.assign(new Error('Event not found'),{status:404});
   const s=event.rows[0];
   const memory=await setOrganizationMemory({organizationId,memoryType:'event_semantics',memoryKey:'session:'+sessionId,value:{session_id:sessionId,name:s.name,service_type:s.service_type,event_kind:s.event_kind,event_scope:s.event_scope,group_id:s.group_id,event_semantics:s.event_semantics,expected_population_rule:s.expected_population_rule,attendance_interpretation:s.attendance_interpretation,participation_expected:s.participation_expected,optional:s.optional,absence_meaningful:s.absence_meaningful},confidence:parameters.confidence??.95,evidenceKind:'human_report',verificationStatus:'reported',source:'operator',createdBy:actor.id});
   const emitted=await emitAriaEvent({organizationId,type:'SERVICE_TYPE_CHANGED',source:'operator',actorId:actor.id,actorRole:actor.role,evidenceKind:'human_report',verificationStatus:'reported',confidence:parameters.confidence??.95,metadata:{session_id:sessionId,statement:'Event semantics were explicitly updated by an authorized operator.',memory:{type:memory.memory_type,key:memory.memory_key,value:memory.memory_value}},eventKey:'session-semantics:'+sessionId+':'+Date.now()});
   return{capability,session:s,memory,event_id:emitted?.id||null,updated:true};
  }

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

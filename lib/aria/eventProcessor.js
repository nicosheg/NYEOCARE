// lib/aria/eventProcessor.js
import pool from'../db';
import{createObservation}from'./observationEngine';
import{updatePeopleIntelligence}from'./peopleIntelligence';
import{updatePersonState}from'./stateManager';
import{planActionFromObservation}from'./recommendationEngine';
import{recordPersonMemory,recordOrganizationMemory,recordRelationship}from'./memoryEngine';

const clamp=(n,min=0,max=1)=>Math.max(min,Math.min(max,Number.isFinite(Number(n))?Number(n):min));
const clean=(v,max=1000)=>String(v??'').trim().slice(0,max);
const OBSERVABLE_EVENTS=new Set(['SCAN_REVIEW_REQUIRED','ATTENDANCE_PROCESSING_FAILED','PERSON_CREATED','PERSON_UPDATED','PERSON_INFORMATION_UPDATED','PARTICIPATION_CONFIRMED','PERSON_NOT_OBSERVED','CARE_FEEDBACK','FOLLOW_UP_RESPONDED_NEGATIVELY','FOLLOW_UP_REQUESTED_HELP','FOLLOW_UP_REQUESTED_NO_CONTACT','ADMIN_CORRECTION']);
const INTELLIGENCE_EVENTS=new Set(['PERSON_CREATED','PERSON_UPDATED','PERSON_INFORMATION_UPDATED','PARTICIPATION_CONFIRMED','CARE_FEEDBACK','PERSON_CONTEXT_ADDED','COMMUNICATION_PREFERENCE_CHANGED']);
const observationSpec=(type,source,metadata={})=>{
 const base={confidence:1,severity:'low',urgency:'low',evidence:{sources:source?[source]:[],facts:[],inference:null}};
 const specs={
  SCAN_REVIEW_REQUIRED:{type:'SCAN_REVIEW_REQUIRED',severity:'medium',urgency:'high',facts:['The latest scan contains records that ARIA cannot safely finalize without human review.'],inference:'Human confirmation is required before uncertain identity records become trusted people.'},
  ATTENDANCE_PROCESSING_FAILED:{type:'ARIA_PROCESSING_FAILURE',severity:'high',urgency:'high',facts:['An attendance save completed but ARIA processing did not complete.'],inference:'Attendance records remain the source of truth; intelligence derived from the session may be incomplete.'},
  PERSON_CREATED:{type:'NEW_PERSON',severity:'medium',urgency:'medium',confidence:Number.isFinite(Number(metadata.confidence))?clamp(Number(metadata.confidence)/100):.7,facts:['Person became known to the organization'],inference:'New person discovered'},
  PERSON_UPDATED:{type:'PERSON_UPDATE',facts:['Person information changed'],inference:'Person context changed'},
  PERSON_INFORMATION_UPDATED:{type:'PERSON_UPDATE',facts:['Person information changed'],inference:'Person context changed'},
  PARTICIPATION_CONFIRMED:{type:'PARTICIPATION_CONFIRMED',facts:['Confirmed participation recorded'],inference:'Person participated'},
  PERSON_NOT_OBSERVED:{type:'PERSON_NOT_OBSERVED',facts:['Person was not observed in a specified event or context.'],inference:'This is an observation only; ARIA does not know the reason.'},
  CARE_FEEDBACK:{type:'CARE_FEEDBACK',facts:['Human care feedback was recorded'],inference:'Care approach now has human evidence'},
  FOLLOW_UP_SENT:{type:'FOLLOW_UP_SENT',facts:['A follow-up communication was recorded as sent.'],inference:'The organization attempted a care interaction.'},
  FOLLOW_UP_DELIVERED:{type:'FOLLOW_UP_DELIVERED',facts:['A follow-up communication was recorded as delivered.'],inference:'The communication reached its delivery endpoint.'},
  FOLLOW_UP_OPENED:{type:'FOLLOW_UP_OPENED',facts:['A follow-up communication was recorded as opened.'],inference:'The communication was opened.'},
  FOLLOW_UP_RECEIVED:{type:'FOLLOW_UP_RECEIVED',facts:['A response to a follow-up was recorded.'],inference:'The person responded to the care interaction.'},
  FOLLOW_UP_IGNORED:{type:'FOLLOW_UP_IGNORED',facts:['A follow-up remained without a recorded response.'],inference:'No response was recorded; ARIA does not infer why.'},
  FOLLOW_UP_REJECTED:{type:'FOLLOW_UP_REJECTED',facts:['A follow-up was rejected or declined.'],inference:'The current approach should not be assumed to be welcome.'},
  FOLLOW_UP_RESPONDED_POSITIVELY:{type:'FOLLOW_UP_RESPONSE_POSITIVE',facts:['A positive follow-up response was recorded.'],inference:'The recent care interaction produced a positive response signal.'},
  FOLLOW_UP_RESPONDED_NEGATIVELY:{type:'FOLLOW_UP_RESPONSE_NEGATIVE',facts:['A negative follow-up response was recorded.'],inference:'The recent care interaction produced a negative response signal.'},
  FOLLOW_UP_REQUESTED_HELP:{type:'FOLLOW_UP_HELP_REQUEST',severity:'medium',urgency:'medium',facts:['The person requested help through follow-up.'],inference:'Human review may be appropriate for the requested help.'},
  FOLLOW_UP_REQUESTED_NO_CONTACT:{type:'FOLLOW_UP_NO_CONTACT',severity:'medium',facts:['The person requested no further contact through follow-up.'],inference:'Future outreach should respect the stated preference.'},
  FOLLOW_UP_INFORMATION_UPDATED:{type:'FOLLOW_UP_INFORMATION_UPDATED',facts:['Follow-up produced new person information.'],inference:'The person context may have changed and should be updated with the supplied evidence.'},
  NEW_RELATIONSHIP:{type:'RELATIONSHIP_CREATED',facts:['A new relationship was recorded between people or an organizational role and a person.'],inference:'The relationship is usable as organizational context with its stored confidence.'},
  RELATIONSHIP_CORRECTED:{type:'RELATIONSHIP_CORRECTED',facts:['A relationship was corrected by an authorized actor.'],inference:'The newer relationship evidence should supersede the previous current relationship.'},
  ORGANIZATIONAL_RULE_LEARNED:{type:'ORGANIZATIONAL_RULE_LEARNED',facts:['An organizational rule or convention was explicitly supplied.'],inference:'The rule can guide future reasoning until it expires or is superseded.'},
  SERVICE_CREATED:{type:'SERVICE_CREATED',facts:['An organizational service or event was created.'],inference:'The event semantics can become organizational memory.'},
  SERVICE_TYPE_CHANGED:{type:'SERVICE_TYPE_CHANGED',facts:['An organizational event or service type changed.'],inference:'Future attendance interpretation should use the newer event semantics.'},
  PERSON_CONTEXT_ADDED:{type:'PERSON_CONTEXT_ADDED',facts:['New person context was explicitly supplied.'],inference:'The supplied context may be useful future memory when its provenance and validity are respected.'},
  ADMIN_CORRECTION:{type:'ADMIN_CORRECTION',facts:['An authorized operator corrected organizational data.'],inference:'The correction should be treated as higher-authority evidence than an unsupported inference.'},
  COMMUNICATION_PREFERENCE_CHANGED:{type:'COMMUNICATION_PREFERENCE_CHANGED',facts:['A communication preference was explicitly changed.'],inference:'Future care should respect the current preference until it expires or is replaced.'}
 };
 const s=specs[type];if(!s)return null;
 return{...base,...s,evidence:{...base.evidence,...s}};
};

async function actorRole(db,actorId,orgId){
 if(!actorId)return null;
 return(await db.query(`SELECT role FROM users WHERE id=$1 AND organization_id=$2 AND active=true LIMIT 1`,[actorId,orgId])).rows[0]?.role||null;
}

async function persistMemoryFromEvent(db,event){
 const m=event.metadata?.memory;
 if(!m||typeof m!=='object')return null;
 const common={organizationId:event.organization_id,source:event.source||'event',sourceEventId:event.id,createdBy:event.actor_id,actorRole:event.actor_role,evidenceKind:event.evidence_kind,verificationStatus:event.verification_status,confidence:event.confidence,validFrom:event.occurred_at,validUntil:event.expires_at,metadata:event.metadata};
 if(event.person_id){
  return recordPersonMemory({personId:event.person_id,memoryType:clean(m.memory_type||event.type.toLowerCase(),120),memoryKey:clean(m.memory_key||`${event.type.toLowerCase()}:${event.id}`,160),content:clean(m.content||m.text||m.statement,4000),importance:m.importance||'normal',...common},db);
 }
 return recordOrganizationMemory({memoryType:clean(m.memory_type||event.type.toLowerCase(),120),memoryKey:clean(m.memory_key||event.type.toLowerCase()+':'+event.id,160),value:m.value??{content:m.content||m.text||m.statement||''},...common},db);
}

async function persistRelationshipFromEvent(db,event){
 const r=event.metadata?.relationship;
 if(!r||!event.person_id||!r.related_person_id)return null;
 return recordRelationship({organizationId:event.organization_id,personId:event.person_id,relatedPersonId:r.related_person_id,relationshipType:clean(r.relationship_type||'related_to',120),strength:r.strength??.5,confidence:event.confidence,evidence:r.evidence||event.metadata,evidenceKind:event.evidence_kind,verificationStatus:event.verification_status,source:event.source||'event',sourceEventId:event.id,createdBy:event.actor_id,validFrom:event.occurred_at,validUntil:event.expires_at,verifiedAt:event.verification_status==='verified'?event.occurred_at:null},db);
}

export async function processAriaEvent(event,client=null){
 if(!event?.id||!event.organization_id||!event.type)throw new Error('ARIA event id, organization_id and type are required');
 const owns=!client;const db=client||await pool.connect();
 try{
  if(owns)await db.query('BEGIN');
  const locked=(await db.query(`SELECT * FROM aria_events WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[event.id,event.organization_id])).rows[0];
  if(!locked){if(owns)await db.query('COMMIT');return null;}
  if(['completed','skipped'].includes(String(locked.processing_status||''))){if(owns)await db.query('COMMIT');return locked.processed_at||locked.id;}
  const role=locked.actor_role||await actorRole(db,locked.actor_id,locked.organization_id);
  const current={...event,...locked,actor_role:role};
  await db.query(`UPDATE aria_events SET processing_status='processing',processing_attempts=processing_attempts+1,last_processing_error=NULL WHERE id=$1 AND organization_id=$2`,[current.id,current.organization_id]);
  let observation=null;
  const spec=observationSpec(current.type,current.source,current.metadata||{});
  if(spec&&OBSERVABLE_EVENTS.has(current.type)){
   const evidence={...spec.evidence,sources:[current.source,...(spec.evidence.sources||[])].filter(Boolean),event_id:current.id,event_type:current.type,...(current.metadata||{})};
   observation=await createObservation({organizationId:current.organization_id,personId:current.person_id,type:spec.type,confidence:spec.confidence??clamp(current.confidence),severity:spec.severity,urgency:spec.urgency,evidence,expiresAt:current.expires_at,sourceEventId:current.id},db);
  }
  if(current.metadata?.memory)await persistMemoryFromEvent(db,current);
  if(current.metadata?.relationship)await persistRelationshipFromEvent(db,current);
  if(current.person_id&&INTELLIGENCE_EVENTS.has(current.type)){
   await updatePeopleIntelligence(current.person_id,current.organization_id,db);
   await updatePersonState(current.person_id,current.organization_id,db);
  }
  if(observation&&current.type==='SCAN_REVIEW_REQUIRED')await planActionFromObservation({organizationId:current.organization_id,personId:current.person_id,observationId:observation,actionType:'REQUEST_REVIEW',priority:'medium',actionMetadata:{kind:'scan_review_required',summary:'The latest scan has information ARIA needs you to confirm.',suggestion:'Open Review Center and confirm the uncertain records.',requires_human_approval:true,source_event_id:current.id}},db);
  if(observation&&current.type==='ATTENDANCE_PROCESSING_FAILED')await planActionFromObservation({organizationId:current.organization_id,personId:current.person_id,observationId:observation,actionType:'ESCALATE',priority:'high',actionMetadata:{kind:'aria_processing_failure',summary:'ARIA could not finish understanding the latest attendance.',suggestion:'Review the processing state before relying on derived care signals.',requires_human_approval:true,source_event_id:current.id}},db);
  if(observation&&current.type==='PERSON_NOT_OBSERVED'&&current.metadata?.care_eligible===true){
   await planActionFromObservation({organizationId:current.organization_id,personId:current.person_id,observationId:observation,actionType:'SEND_MESSAGE',priority:current.metadata.priority||'low',actionMetadata:{kind:'care_first_check_in',reason:'ARIA noticed a change or non-observation and does not know why. The proposed care is about the person, not attendance.',suggestion:'Review a simple personal check-in focused on how they are doing.',knowledge:'Non-observation is evidence of what was seen, not an explanation for why it happened.',requires_human_approval:true,draft_required:true,channel:'whatsapp',source_event_id:current.id}},db);
  }
  if(observation&&current.type==='FOLLOW_UP_REQUESTED_HELP')await planActionFromObservation({organizationId:current.organization_id,personId:current.person_id,observationId:observation,actionType:'REQUEST_REVIEW',priority:'medium',actionMetadata:{kind:'requested_help',reason:'The person requested help in a follow-up interaction.',suggestion:'Review the request and assign an appropriate human response.',requires_human_approval:true,source_event_id:current.id}},db);
  await db.query(`UPDATE aria_events SET processing_status='completed',processed_at=NOW(),last_processing_error=NULL WHERE id=$1 AND organization_id=$2`,[current.id,current.organization_id]);
  if(owns)await db.query('COMMIT');
  return observation||current.id;
 }catch(err){
  if(owns)try{await db.query('ROLLBACK')}catch{}
  try{await pool.query(`UPDATE aria_events SET processing_status='failed',last_processing_error=$3 WHERE id=$1 AND organization_id=$2`,[event.id,event.organization_id,clean(err?.message||String(err),1000)])}catch{}
  throw err;
 }finally{if(owns)db.release()}
}
// lib/aria/eventProcessor.js
import pool from'../db';
import{createObservation}from'./observationEngine';
import{updatePeopleIntelligence}from'./peopleIntelligence';
import{updatePersonState}from'./stateManager';
import{planActionFromObservation}from'./recommendationEngine';
import{recordLearning}from'./learningEngine';
import{setPersonMemory,setOrganizationMemory,upsertPersonRelationship}from'./memoryEngine';

const clamp=n=>Math.max(0,Math.min(1,Number(n)||0));
const OBSERVATION_MAP={
 SCAN_REVIEW_REQUIRED:{observationType:'SCAN_REVIEW_REQUIRED',severity:'medium',urgency:'high',confidence:1,fact:'The latest scan contains records that ARIA cannot safely finalize without human review.',inference:'Human confirmation is required before those records become trusted people.'},
 ATTENDANCE_PROCESSING_FAILED:{observationType:'ARIA_PROCESSING_FAILURE',severity:'high',urgency:'high',confidence:1,fact:'An attendance save completed but ARIA processing did not complete.',inference:'The attendance record is safe, but ARIA memory may be incomplete until processing completes.'},
 PERSON_CREATED:{observationType:'NEW_PERSON',severity:'medium',urgency:'medium',confidence:.7,fact:'Person became known to the organization.',inference:'New person discovered.'},
 PERSON_UPDATED:{observationType:'PERSON_UPDATE',severity:'low',urgency:'low',confidence:.9,fact:'Person information changed.',inference:'Person context changed.'},
 PARTICIPATION_CONFIRMED:{observationType:'PARTICIPATION_CONFIRMED',severity:'low',urgency:'low',confidence:1,fact:'Confirmed participation recorded.',inference:'Person participated.'},
 CARE_FEEDBACK:{observationType:'CARE_FEEDBACK',severity:'low',urgency:'low',confidence:1,fact:'Human care feedback was recorded.',inference:'The care approach now has human outcome evidence.'},
 CARE_OUTCOME_RECORDED:{observationType:'CARE_OUTCOME_RECORDED',severity:'low',urgency:'low',confidence:1,fact:'A care outcome was recorded.',inference:'This outcome is evidence for future care decisions.'},
 RETURNED_AFTER_ABSENCE:{observationType:'RETURNED_AFTER_ABSENCE',severity:'low',urgency:'low',confidence:1,fact:'The person was observed participating after an earlier absence signal.',inference:'The person returned; no reason for the earlier absence is assumed.'},
 ADMIN_CORRECTION:{observationType:'ADMIN_CORRECTION',severity:'low',urgency:'low',confidence:1,fact:'An authorized human corrected organizational information.',inference:'ARIA should prefer the newer verified information for future reasoning.'},
 RELATIONSHIP_CREATED:{observationType:'RELATIONSHIP_CHANGE',severity:'low',urgency:'low',confidence:.8,fact:'A relationship was explicitly recorded.',inference:'The relationship can influence future care routing when evidence supports it.'},
 RELATIONSHIP_CORRECTED:{observationType:'RELATIONSHIP_CORRECTION',severity:'low',urgency:'low',confidence:1,fact:'An authorized human corrected a relationship.',inference:'The newer relationship evidence supersedes the older current projection.'},
 NEW_CONTEXT_ADDED:{observationType:'NEW_CONTEXT',severity:'low',urgency:'low',confidence:.8,fact:'New person or organization context was explicitly supplied.',inference:'The new context may constrain future reasoning until it expires or is superseded.'},
 SERVICE_CREATED:{observationType:'EVENT_CONTEXT_CREATED',severity:'low',urgency:'low',confidence:1,fact:'An organization event was created with explicit event semantics.',inference:'ARIA can use this event context when interpreting participation.'},
 SERVICE_TYPE_CHANGED:{observationType:'EVENT_CONTEXT_CHANGED',severity:'low',urgency:'low',confidence:1,fact:'An organization event type or semantics changed.',inference:'Future interpretation should use the newer event semantics.'},
 SPECIAL_EVENT:{observationType:'SPECIAL_EVENT',severity:'low',urgency:'low',confidence:1,fact:'A special organizational event was recorded.',inference:'Participation in this event should be interpreted using its specific semantics.'},
 COMMUNICATION_PREFERENCE_CHANGED:{observationType:'COMMUNICATION_PREFERENCE_CHANGED',severity:'low',urgency:'low',confidence:1,fact:'Communication preference information changed.',inference:'Future care should respect the latest recorded communication preference.'}
};
const MEMORY_EVENTS=new Set(['ADMIN_CORRECTION','NEW_CONTEXT_ADDED','LEADER_NOTE_ADDED','COMMUNICATION_PREFERENCE_CHANGED','ORGANIZATION_RULE_LEARNED','SERVICE_CREATED','SERVICE_TYPE_CHANGED']);
const LEARNING_EVENTS=new Set(['FOLLOW_UP_SENT','FOLLOW_UP_DELIVERED','FOLLOW_UP_OPENED','FOLLOW_UP_RECEIVED','FOLLOW_UP_IGNORED','FOLLOW_UP_REJECTED','FOLLOW_UP_RESPONDED_POSITIVELY','FOLLOW_UP_RESPONDED_NEGATIVELY','FOLLOW_UP_REQUESTED_HELP','FOLLOW_UP_REQUESTED_NO_CONTACT','FOLLOW_UP_INFORMATION_UPDATED','COMMUNICATION_PREFERENCE_CHANGED']);

async function claimEvent(eventId,db){
 const r=await db.query(
  "UPDATE aria_events SET processing_status='processing',processing_attempts=processing_attempts+1,processing_started_at=NOW(),last_processing_error=NULL WHERE id=$1 AND(processing_status='pending' OR(processing_status='failed' AND(COALESCE(next_attempt_at,NOW())<=NOW()) AND processing_attempts<8) OR(processing_status='processing' AND processing_started_at<NOW()-INTERVAL '5 minutes')) RETURNING *",
  [eventId]
 );
 return r.rows[0]||null;
}

function eventEvidence(event){
 const metadata=event.metadata&&typeof event.metadata==='object'?event.metadata:{};
 return{
  kind:event.evidence_kind||'observation',
  status:event.verification_status||'observed',
  authority:event.actor_role||event.source||'system',
  source:event.source||'system',
  source_id:event.id,
  statement:String(metadata.statement||metadata.summary||event.type).slice(0,1200),
  occurred_at:event.occurred_at||event.created_at,
  confidence:clamp(event.confidence),
  metadata
 };
}

async function applyMemory(event,db){
 const m=event.metadata&&typeof event.metadata.memory==='object'?event.metadata.memory:null;
 if(!m)return;
 const content=String(m.content||m.statement||'').trim();
 if(event.person_id){
  if(!content)return;
  await setPersonMemory({
   organizationId:event.organization_id,personId:event.person_id,
   memoryType:String(m.type||'context'),memoryKey:m.key?String(m.key):null,
   content,confidence:event.confidence,evidenceKind:event.evidence_kind||'human_report',
   verificationStatus:event.verification_status||'reported',source:event.source||'human',
   sourceEventId:event.id,createdBy:event.actor_id||null,actorRole:event.actor_role||null,
   validFrom:event.occurred_at||null,validUntil:event.expires_at||m.valid_until||null,
   metadata:m.metadata||{},importance:m.importance||'temporary'
  },db);
 }else{
  await setOrganizationMemory({
   organizationId:event.organization_id,memoryType:String(m.type||'context'),memoryKey:String(m.key||event.type),
   value:m.value||{statement:content},confidence:event.confidence,
   evidenceKind:event.evidence_kind||'human_report',verificationStatus:event.verification_status||'reported',
   source:event.source||'human',sourceEventId:event.id,createdBy:event.actor_id||null,
   validFrom:event.occurred_at||null,validUntil:event.expires_at||m.valid_until||null,metadata:m.metadata||{}
  },db);
 }
}

async function applyRelationship(event,db){
 const m=event.metadata||{};
 if(!event.person_id||!m.related_person_id||!m.relationship_type)return;
 await upsertPersonRelationship({
  organizationId:event.organization_id,personId:event.person_id,relatedPersonId:m.related_person_id,
  relationshipType:m.relationship_type,strength:m.strength||0,evidence:m.evidence||{statement:m.statement||''},
  source:m.source||event.source||'human',evidenceKind:event.evidence_kind||'human_report',
  verificationStatus:event.verification_status||'reported',confidence:event.confidence,sourceEventId:event.id,
  createdBy:event.actor_id||null,validFrom:event.occurred_at||null,validUntil:event.expires_at||null
 },db);
}

async function learnEvent(event,db){
 if(!LEARNING_EVENTS.has(event.type)||!event.person_id)return;
 const metadata=event.metadata||{};
 await recordLearning({
  organizationId:event.organization_id,personId:event.person_id,
  learningType:'communication_outcome',learningKey:'latest:'+event.type,
  value:{event_type:event.type,outcome:metadata.outcome||null,channel:metadata.channel||null,action_id:metadata.action_id||null,occurred_at:event.occurred_at||event.created_at},
  confidence:event.confidence,sourceType:'event',sourceId:event.id,
  scopeLevel:'personal',scopeKey:'person:'+event.person_id,
  learningDomain:'personalized',learningContext:'communication',privacyClass:'identity_private',evidenceKind:'inference',verificationStatus:event.verification_status||'reported',validUntil:event.expires_at||null,actorId:event.actor_id||null
 },db);
}

async function processClaimed(event,db){
 const map=OBSERVATION_MAP[event.type];
 let observationId=null;
 if(map){
  observationId=await createObservation({
   organizationId:event.organization_id,personId:event.person_id,type:map.observationType,
   confidence:map.confidence,severity:map.severity,urgency:map.urgency,
   evidence:{...eventEvidence(event),facts:[map.fact],inference:map.inference},
   sourceEventId:event.id,expiresAt:event.expires_at||null
  },db);
 }
 if(MEMORY_EVENTS.has(event.type))await applyMemory(event,db);
 if(event.type==='RELATIONSHIP_CREATED'||event.type==='RELATIONSHIP_CORRECTED')await applyRelationship(event,db);
 if(LEARNING_EVENTS.has(event.type))await learnEvent(event,db);
 if(event.person_id&&['PERSON_CREATED','PERSON_UPDATED','PARTICIPATION_CONFIRMED','PERSON_NOT_OBSERVED','RETURNED_AFTER_ABSENCE','CARE_FEEDBACK','CARE_OUTCOME_RECORDED','ADMIN_CORRECTION','NEW_CONTEXT_ADDED'].includes(event.type)){
  await updatePeopleIntelligence(event.person_id,event.organization_id,db);
  await updatePersonState(event.person_id,event.organization_id,db);
 }
 const policy={
  SCAN_REVIEW_REQUIRED:{actionType:'REQUEST_REVIEW',priority:'medium',kind:'scan_review_required',summary:'The latest scan has information ARIA needs you to confirm.',suggestion:'Open Review Center and confirm the uncertain records.'},
  ATTENDANCE_PROCESSING_FAILED:{actionType:'ESCALATE',priority:'high',kind:'aria_processing_failure',summary:'ARIA could not finish understanding the latest attendance.',suggestion:'Review the processing state before relying on attendance-derived follow-up.'},
  PERSON_CREATED:{actionType:'SEND_MESSAGE',priority:'low',kind:'new_person_welcome',summary:'A new person has been added to NYEOCARE.',suggestion:'Review a gentle welcome when appropriate.'}
 }[event.type];
 if(policy&&observationId){
  await planActionFromObservation({
   organizationId:event.organization_id,personId:event.person_id,observationId,
   actionType:policy.actionType,priority:policy.priority,
   actionMetadata:{kind:policy.kind,summary:policy.summary,suggestion:policy.suggestion,requires_human_approval:true,source_event_id:event.id,source_event_type:event.type,session_id:event.metadata?.session_id||null},
   actionKey:'director:'+event.id+':'+policy.kind
  },db);
 }
 return observationId;
}

export async function processAriaEvent(event,client=null){
 if(!event?.id||!event.organization_id||!event.type)throw new Error('ARIA event id, organization_id and type are required');
 const owns=!client,db=client||await pool.connect();
 try{
  if(owns)await db.query('BEGIN');
  const claimed=await claimEvent(event.id,db);
  if(!claimed){
   const current=(await db.query('SELECT processing_status FROM aria_events WHERE id=$1 LIMIT 1',[event.id])).rows[0];
   if(owns)await db.query('COMMIT');
   return current?.processing_status==='completed'?null:false;
  }
  const observationId=await processClaimed(claimed,db);
  await db.query("UPDATE aria_events SET processing_status='completed',processed_at=NOW(),processing_started_at=NULL,last_processing_error=NULL,next_attempt_at=NULL WHERE id=$1",[event.id]);
  if(owns)await db.query('COMMIT');
  return observationId;
 }catch(err){
  const message=String(err?.message||err).slice(0,2000);
  await db.query("UPDATE aria_events SET processing_status=CASE WHEN processing_attempts>=8 THEN 'dead' ELSE 'failed' END,last_processing_error=$2,processed_at=NOW(),next_attempt_at=CASE WHEN processing_attempts>=8 THEN NULL ELSE NOW()+(LEAST(60,POWER(2,GREATEST(processing_attempts-1,0)))||' seconds')::interval END,processing_started_at=NULL WHERE id=$1",[event?.id,message]);
  if(owns)await db.query('COMMIT');
  console.error('[ARIA] event processing failed',event?.id,event?.type,message);
  throw err;
 }finally{if(owns)db.release();}
}

export async function processPendingAriaEvents({organizationId,limit=25}={}){
 const safeLimit=Math.min(Math.max(Number(limit)||25,1),100);
 const rows=await pool.query("SELECT id FROM aria_events WHERE processing_status IN('pending','failed') AND processing_attempts<8 AND(COALESCE(next_attempt_at,occurred_at)<=NOW()) AND($1::text IS NULL OR organization_id=$1) ORDER BY occurred_at ASC,created_at ASC LIMIT $2",[organizationId||null,safeLimit]);
 let succeeded=0,failed=0;
 for(const row of rows.rows){
  try{
   const event=(await pool.query('SELECT * FROM aria_events WHERE id=$1 LIMIT 1',[row.id])).rows[0];
   if(!event)continue;
   const result=await processAriaEvent(event);
   if(result!==false)succeeded++;
  }catch(e){failed++;}
 }
 return{found:rows.rows.length,succeeded,failed};
}

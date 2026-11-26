// lib/aria/communicationOutcome.js
import pool from'../db';
import{getRecordedContactPermission}from'./contactPreference';
import{emitAriaEvent}from'./eventEmitter';
import{processAriaEvent}from'./eventProcessor';
import{recordOutcome}from'./outcomeEngine';

const EVENT_BY_STATUS=Object.freeze({
 sent:'FOLLOW_UP_SENT',
 delivered:'FOLLOW_UP_DELIVERED',
 opened:'FOLLOW_UP_OPENED',
 received:'FOLLOW_UP_RECEIVED',
 ignored:'FOLLOW_UP_IGNORED',
 rejected:'FOLLOW_UP_REJECTED',
 responded_positive:'FOLLOW_UP_RESPONDED_POSITIVELY',
 responded_negative:'FOLLOW_UP_RESPONDED_NEGATIVELY',
 requested_help:'FOLLOW_UP_REQUESTED_HELP',
 requested_no_contact:'FOLLOW_UP_REQUESTED_NO_CONTACT',
 information_updated:'FOLLOW_UP_INFORMATION_UPDATED'
});
const OUTCOME_SCORE={responded_positive:.9,responded_negative:.1,rejected:.1,requested_help:.8,requested_no_contact:.5};

export async function recordCommunicationOutcome({
 organizationId,personId,channel='whatsapp',direction='outbound',status,
 content=null,subject=null,externalId=null,actorId=null,actionId=null,metadata={}
}){
 if(!organizationId||!personId||!status)throw new Error('organizationId, personId and status are required');
 const eventType=EVENT_BY_STATUS[status];
 if(!eventType)throw Object.assign(new Error('Unsupported communication outcome'),{status:400});
 const enforceContactPreference=direction==='outbound'&&['sent','delivered','read','completed'].includes(status);
 const contactGuard=enforceContactPreference?await pool.connect():null;
 try{
  if(contactGuard){
   await contactGuard.query('BEGIN');
   await contactGuard.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['nyeocare:do-not-contact:'+organizationId+':'+personId]);
  }
 const person=await pool.query("SELECT id,phone FROM people WHERE id=$1 AND organization_id=$2 AND COALESCE(status,'active')='active' LIMIT 1",[personId,organizationId]);
 if(!person.rows.length)throw Object.assign(new Error('Person not found'),{status:404});

 let communication=null;
 if(externalId){
  communication=(await pool.query("SELECT * FROM person_communications WHERE organization_id=$1 AND person_id=$2 AND external_id=$3 ORDER BY created_at DESC LIMIT 1",[organizationId,personId,String(externalId)])).rows[0]||null;
 }
 const initiatesContact=direction==='outbound'
   && (!communication||communication.status==='draft')
   && ['sent','delivered','read','completed'].includes(status);
 let actionMetadata={};
 if(actionId){
  const action=(await pool.query(
   "SELECT action_metadata FROM aria_actions WHERE id=$1 AND organization_id=$2 AND person_id=$3 LIMIT 1",
   [actionId,organizationId,personId]
  )).rows[0];
  actionMetadata=action?.action_metadata||{};
 }
 if(initiatesContact){
  const permission=await getRecordedContactPermission(contactGuard||pool,organizationId,personId,actionMetadata);
  if(permission!=='allowed')throw Object.assign(
   new Error(permission==='do_not_contact'
    ?'This person has asked not to be contacted. The outgoing communication is blocked.'
    :'The person’s contact preference is not confirmed as allowed. Verify it before sending.'),
   {status:409,code:permission==='do_not_contact'?'DO_NOT_CONTACT':'CONTACT_PERMISSION_UNKNOWN'}
  );
 }
 const privacyMetadata={
  privacy_class:actionMetadata.privacy_class||metadata?.privacy_class||'standard',
  privacy_reporter_id:actionMetadata.privacy_reporter_id||metadata?.privacy_reporter_id||null,
  consent_status:actionMetadata.consent_status||metadata?.consent_status||'unknown',
  contact_permission:actionMetadata.contact_permission||metadata?.contact_permission||'unknown'
 };
 const savedMetadata={...(metadata&&typeof metadata==='object'?metadata:{}),...privacyMetadata};
 const eventPrivacyClass=actionMetadata.privacy_class||savedMetadata.privacy_class||'standard';
 const eventConsentStatus=actionMetadata.consent_status||savedMetadata.consent_status||'unknown';
 if(!communication){
  communication=(await pool.query(
   "INSERT INTO person_communications(organization_id,person_id,channel,direction,status,subject,content,external_id,metadata,created_by,occurred_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW(),NOW()) RETURNING *",
   [organizationId,personId,channel,direction,status,subject,content,externalId,savedMetadata,actorId]
  )).rows[0];
 }else if(communication.status!==status||content!==null){
  communication=(await pool.query(
   "UPDATE person_communications SET status=$4,content=COALESCE($5,content),metadata=COALESCE(metadata,'{}'::jsonb)||$6::jsonb,updated_at=NOW() WHERE organization_id=$1 AND person_id=$2 AND id=$3 RETURNING *",
   [organizationId,personId,communication.id,status,content,JSON.stringify(savedMetadata)]
  )).rows[0];
 }

 const event=await emitAriaEvent({
  organizationId,personId,type:eventType,source:channel,actorId,
  evidenceKind:direction==='inbound'?'human_report':'observation',
  verificationStatus:direction==='inbound'?'reported':'observed',
  confidence:direction==='inbound'?1:.95,
  privacyClass:eventPrivacyClass,
  consentStatus:eventConsentStatus,
  metadata:{communication_id:communication.id,action_id:actionId,channel,direction,status,external_id:externalId,content:content||null,...(metadata&&typeof metadata==='object'?metadata:{})},
  eventKey:`communication:${communication.id}:${eventType}`
 });
 if(event)await processAriaEvent(event);
 if(eventPrivacyClass==='standard'&&Object.prototype.hasOwnProperty.call(OUTCOME_SCORE,status)){
  await recordOutcome(organizationId,personId,status,OUTCOME_SCORE[status],actionId,{communication_id:communication.id,channel,direction,status},actorId,null,event?.id||null);
 }
 if(contactGuard)await contactGuard.query('COMMIT');
 return{communication,event};
 }catch(error){
  if(contactGuard)await contactGuard.query('ROLLBACK').catch(()=>{});
  throw error;
 }finally{
  if(contactGuard)contactGuard.release();
 }
}

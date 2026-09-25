// lib/aria/communicationOutcome.js
import pool from'../db';
import{emitAriaEvent}from'./eventEmitter';
import{processAriaEvent}from'./eventProcessor';
import{recordOutcome}from'./outcomeEngine';

const STATUS_EVENT={
 sent:'FOLLOW_UP_SENT',delivered:'FOLLOW_UP_DELIVERED',opened:'FOLLOW_UP_OPENED',
 received:'FOLLOW_UP_RECEIVED',ignored:'FOLLOW_UP_IGNORED',rejected:'FOLLOW_UP_REJECTED',
 responded_positive:'FOLLOW_UP_RESPONDED_POSITIVELY',responded_negative:'FOLLOW_UP_RESPONDED_NEGATIVELY',
 requested_help:'FOLLOW_UP_REQUESTED_HELP',requested_no_contact:'FOLLOW_UP_REQUESTED_NO_CONTACT',
 information_updated:'FOLLOW_UP_INFORMATION_UPDATED'
};
const humanStatus=new Set(Object.keys(STATUS_EVENT));
const OUTCOME_SCORE={responded_positive:.9,responded_negative:.1,rejected:.1,requested_help:.8,requested_no_contact:.5};

export async function recordCommunicationOutcome({organizationId,personId,channel='whatsapp',direction='outbound',status,content=null,subject=null,externalId=null,actorId=null,actionId=null,metadata={}}){
 if(!organizationId||!personId||!status)throw new Error('organizationId, personId and status are required');
 if(!humanStatus.has(status))throw new Error('Unsupported communication outcome');
 const person=await pool.query(`SELECT id FROM people WHERE id=$1 AND organization_id=$2 AND COALESCE(status,'active')='active' LIMIT 1`,[personId,organizationId]);
 if(!person.rows.length)throw Object.assign(new Error('Person not found'),{status:404});
 const existing=externalId?(await pool.query(`SELECT * FROM person_communications WHERE organization_id=$1 AND person_id=$2 AND external_id=$3 ORDER BY created_at DESC LIMIT 1`,[organizationId,personId,String(externalId)])).rows[0]:null;
 const communication=existing|| (await pool.query(`INSERT INTO person_communications(organization_id,person_id,channel,direction,status,subject,content,external_id,metadata,created_by,occurred_at,created_at,updated_at)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW(),NOW()) RETURNING *`,[organizationId,personId,channel,direction,status,subject,content,externalId,JSON.stringify({...metadata,action_id:actionId,aria_event_type:STATUS_EVENT[status]}),actorId])).rows[0];
 if(existing&&existing.status!==status)await pool.query(`UPDATE person_communications SET status=$4,content=COALESCE($5,content),metadata=COALESCE(metadata,'{}'::jsonb)||$6::jsonb,updated_at=NOW() WHERE organization_id=$1 AND person_id=$2 AND id=$3`,[organizationId,personId,existing.id,status,content,JSON.stringify({...metadata,action_id:actionId})]);
 const event=await emitAriaEvent({organizationId,personId,type:STATUS_EVENT[status],source:channel,actorId,evidenceKind:direction==='inbound'?'human_report':'observation',verificationStatus:direction==='inbound'?'reported':'observed',confidence:direction==='inbound'?1:.95,metadata:{communication_id:communication.id,action_id:actionId,channel,direction,status,external_id:externalId,content:content||null,...metadata},eventKey:`communication:${communication.id}:${STATUS_EVENT[status]}`});
 if(event)await processAriaEvent(event);
 if(Object.prototype.hasOwnProperty.call(OUTCOME_SCORE,status))await recordOutcome(organizationId,personId,status,OUTCOME_SCORE[status],actionId,{communication_id:communication.id,channel,direction,status,metadata},actorId,null,event?.id||null);
 return{communication,event};
}
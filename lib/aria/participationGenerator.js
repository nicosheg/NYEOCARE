// lib/aria/participationGenerator.js
import pool from'../db';
import{emitAriaEvent}from'./eventEmitter';
import{processAriaEvent}from'./eventProcessor';
import{updateEngagementMetricsForPerson}from'./engagementIntelligence';
import{computeRelationshipScore}from'./relationshipScore';
import{createObservation}from'./observationEngine';
import{updatePersonState}from'./stateManager';
import{planActionFromObservation}from'./recommendationEngine';
import{createCareDraft}from'./draftEngine';

export async function generateParticipationFromSession(sessionId,orgId){
 if(!sessionId||!orgId)throw new Error('sessionId and orgId are required');
 const client=await pool.connect(),records=[];let sessionRow=null;
 try{
  await client.query('BEGIN');
  const session=await client.query(`SELECT id,name,service_type,started_at FROM sessions WHERE id=$1 AND organization_id=$2 LIMIT 1`,[sessionId,orgId]);
  if(!session.rows.length)throw new Error('Session does not belong to organization');
  sessionRow=session.rows[0];
  const attendance=await client.query(`SELECT ar.id,ar.people_id,ar.attendance_date FROM attendance_records ar JOIN people p ON p.id=ar.people_id AND p.organization_id=ar.organization_id WHERE ar.session_id=$1 AND ar.organization_id=$2 AND ar.confirmed=true AND ar.present=true AND COALESCE(p.status,'active')<>'merged'`,[sessionId,orgId]);
  for(const row of attendance.rows){
   const inserted=await client.query(`INSERT INTO participation_records(organization_id,person_id,session_id,participation_type,value,occurred_at) VALUES($1,$2,$3,'attendance',$4,$5) ON CONFLICT(organization_id,person_id,session_id,participation_type) WHERE participation_type='attendance' DO NOTHING RETURNING id`,[orgId,row.people_id,sessionId,JSON.stringify({present:true,source:'attendance_confirmation'}),row.attendance_date]);
   records.push({participationId:inserted.rows[0]?.id||null,personId:row.people_id});
  }
  await client.query('COMMIT');
 }catch(error){try{await client.query('ROLLBACK')}catch{}throw error}finally{client.release()}
 const personIds=[...new Set(records.map(x=>x.personId))],created=records.filter(x=>x.participationId);
 for(const personId of personIds)try{await updateEngagementMetricsForPerson(personId,orgId)}catch(error){console.error('[ARIA] engagement:',error.message)}
 try{await computeRelationshipScore(orgId)}catch(error){console.error('[ARIA] relationship:',error.message)}
 for(const row of created){
  try{const event=await emitAriaEvent({organizationId:orgId,personId:row.personId,type:'PARTICIPATION_CONFIRMED',source:'attendance',metadata:{session_id:sessionId,participation_id:row.participationId},eventKey:`participation:${row.participationId}:confirmed`});if(event)await processAriaEvent(event)}catch(error){console.error('[ARIA] participation event:',error.message)}
 }
 let immediateActions=0,absenceObservations=0;
 if(created.length){
  try{
   const absent=await pool.query(`SELECT p.id,p.first_name,p.last_name,p.display_name,p.phone,p.email FROM people p WHERE p.organization_id=$1 AND p.status='active' AND NOT EXISTS(SELECT 1 FROM attendance_records ar WHERE ar.organization_id=$1 AND ar.people_id=p.id AND ar.session_id=$2 AND ar.present=true AND ar.confirmed=true) AND NOT EXISTS(SELECT 1 FROM aria_care_contexts c WHERE c.organization_id=$1 AND c.person_id=p.id AND c.kind IN('travel','temporary_unavailable','not_attending') AND(c.ends_on IS NULL OR c.ends_on>CURRENT_DATE)) AND NOT EXISTS(SELECT 1 FROM aria_care_contexts c WHERE c.organization_id=$1 AND c.person_id=p.id AND c.kind='preferred_service' AND c.ends_on IS NULL AND c.service_type IS NOT NULL AND c.service_type<>COALESCE(NULLIF($3,''),'weekday:'||EXTRACT(ISODOW FROM $4)::int)) ORDER BY p.first_name,p.last_name`,[orgId,sessionId,sessionRow.service_type||'',sessionRow.started_at]);
   for(const person of absent.rows){
    const sourceEventId=`attendance:${sessionId}:absence:${person.id}`;
    const observationId=await createObservation({organizationId:orgId,personId:person.id,type:'UNUSUAL_ABSENCE',confidence:1,severity:'low',urgency:'low',evidence:{sources:['attendance'],facts:['Person was not recorded as present in this completed session'],inference:'This is an immediate absence signal, not a claim about an established attendance pattern.',session_id:sessionId,session_name:sessionRow.name||null,service_type:sessionRow.service_type||null},sourceEventId});
    absenceObservations++;
    await updatePersonState(person.id,orgId);
    const action=await planActionFromObservation({organizationId:orgId,personId:person.id,observationId,actionType:'SEND_MESSAGE',priority:'low',actionMetadata:{kind:'first_session_check_in',reason:'ARIA noticed this person was not observed in the completed session.',requires_human_approval:true,draft_required:true,channel:'whatsapp',first_session:true,pattern_claim:false}});
    if(action){
     immediateActions++;
     try{await createCareDraft({organizationId:orgId,personId:person.id,actionId:action.id,actionType:'thoughtful_check_in'})}catch(error){console.error('[ARIA] absence draft:',error.message)}
    }
   }
  }catch(error){console.error('[ARIA] immediate absence response:',error.message)}
 }
 return{session_id:sessionId,processed:personIds.length,events:created.length,absence_observations:absenceObservations,immediate_actions:immediateActions};
}

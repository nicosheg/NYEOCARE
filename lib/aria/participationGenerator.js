// lib/aria/participationGenerator.js
import pool from'../db';import{processAriaEvent}from'./eventProcessor';import{updateEngagementMetricsForPeople}from'./engagementIntelligence';import{computeRelationshipScore}from'./relationshipScore';import{createObservation}from'./observationEngine';import{updatePersonState}from'./stateManager';import{planActionFromObservation}from'./recommendationEngine';

const CONCURRENCY=2;
const returnDraft=(name,ctx)=>{const first=name||'there';if(ctx?.reason_note)return 'Welcome back, '+first+'. It was good to see you today. I hope things are going well with what kept you away.';if(ctx?.reason_code==='travel')return 'Welcome back, '+first+'. It is good to have you back. I hope the trip went well.';if(ctx?.reason_code==='work_school')return 'Welcome back, '+first+'. It is good to see you again. I hope work or school is going well.';if(ctx?.reason_code==='family')return 'Welcome back, '+first+'. It is good to see you again. I hope things are settling down well.';if(ctx?.reason_code==='health')return 'Welcome back, '+first+'. It is good to see you again. I hope you are doing well.';return 'Welcome back, '+first+'. It was good to see you today. Hope you had a good week.'};

async function mapConcurrent(items,limit,fn){
 if(!items.length)return[];
 const results=new Array(items.length);let cursor=0;
 async function worker(){while(true){const i=cursor++;if(i>=items.length)return;results[i]=await fn(items[i],i)}}
 await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));
 return results;
}

async function handleReturnAfterAbsence({sessionId,orgId,personId}){
 const ctx=await pool.query('SELECT id,reason_code,reason_note,expected_return_date FROM aria_attendance_contexts WHERE organization_id=$1 AND person_id=$2 AND session_id<>$3 AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 1',[orgId,personId,sessionId]);
 const obs=await pool.query('SELECT id FROM aria_observations WHERE organization_id=$1 AND person_id=$2 AND type=\'UNUSUAL_ABSENCE\' AND status=\'active\' ORDER BY detected_at DESC LIMIT 1',[orgId,personId]);
 if(!ctx.rows.length&&!obs.rows.length)return null;
 if(ctx.rows.length)await pool.query('UPDATE aria_attendance_contexts SET resolved_at=NOW() WHERE id=$1',[ctx.rows[0].id]);
 if(obs.rows.length)await pool.query('UPDATE aria_observations SET status=\'resolved\' WHERE id=$1',[obs.rows[0].id]);
 await pool.query('UPDATE aria_actions SET status=\'cancelled\',failure_reason=\'Person returned; previous absence follow-up is no longer pending.\',updated_at=NOW() WHERE organization_id=$1 AND person_id=$2 AND status IN(\'proposed\',\'approved\') AND action_metadata->>\'kind\'=\'first_session_check_in\'',[orgId,personId]);
 const person=await pool.query('SELECT first_name,last_name FROM people WHERE id=$1 AND organization_id=$2 LIMIT 1',[personId,orgId]);
 const name=[person.rows[0]?.first_name,person.rows[0]?.last_name].filter(Boolean).join(' ');
 const ctxRow=ctx.rows[0]||null,source='attendance:'+sessionId+':return:'+personId;
 const observationId=await createObservation({organizationId:orgId,personId,type:'RETURNED_AFTER_ABSENCE',confidence:1,severity:'low',urgency:'low',evidence:{sources:['attendance'],facts:['Person was recorded as present after a previous absence signal.'],inference:ctxRow?'The person returned after human-provided absence context.':'The person returned after a previous absence signal.',previous_context:ctxRow?{reason_code:ctxRow.reason_code,has_note:Boolean(ctxRow.reason_note),expected_return_date:ctxRow.expected_return_date}:null,session_id:sessionId},sourceEventId:source});
 return planActionFromObservation({organizationId:orgId,personId,observationId,actionType:'SEND_MESSAGE',priority:'low',actionMetadata:{kind:'returned_after_absence',notify_organization:true,requires_human_approval:true,draft_required:true,channel:'whatsapp',personalized:Boolean(ctxRow),draft_message:returnDraft(name,ctxRow),summary:name+' is back after being away.',knowledge:ctxRow?'Human context was provided for the previous absence.':'ARIA only knows this person was previously absent.',suggestion:'Review the suggested personal welcome-back message.'},actionKey:'briefing:return_after_absence:'+sessionId+':'+personId});
}

export async function generateParticipationFromSession(sessionId,orgId){
 if(!sessionId||!orgId)throw new Error('sessionId and orgId are required');
 const totalStart=Date.now(),timings={},client=await pool.connect();let sessionRow=null,records=[];
 try{
  const start=Date.now();await client.query('BEGIN');
  const session=await client.query('SELECT id,name,service_type,started_at,status FROM sessions WHERE id=$1 AND organization_id=$2 LIMIT 1',[sessionId,orgId]);
  if(!session.rows.length)throw new Error('Session does not belong to organization');
  sessionRow=session.rows[0];
  await client.query('UPDATE attendance_records SET confirmed=true WHERE organization_id=$1 AND session_id=$2 AND present=true AND confirmed=false',[orgId,sessionId]);
  const inserted=await client.query(`WITH eligible AS(
    SELECT ar.people_id,ar.attendance_date FROM attendance_records ar JOIN people p ON p.id=ar.people_id AND p.organization_id=ar.organization_id WHERE ar.session_id=$1 AND ar.organization_id=$2 AND ar.confirmed=true AND ar.present=true AND COALESCE(p.status,'active')<>'merged'
  )
  INSERT INTO participation_records(organization_id,person_id,session_id,participation_type,value,occurred_at)
  SELECT $2,e.people_id,$1,'attendance',jsonb_build_object('present',true,'source','attendance_confirmation'),e.attendance_date FROM eligible e
  ON CONFLICT(organization_id,person_id,session_id,participation_type) WHERE participation_type='attendance' DO NOTHING
  RETURNING id,person_id`,[sessionId,orgId]);
  records=inserted.rows;
  await client.query('COMMIT');timings.persistParticipationMs=Date.now()-start;
 }catch(error){try{await client.query('ROLLBACK')}catch{}throw error}finally{client.release()}

 const personIds=[...new Set(records.map(x=>String(x.person_id)).filter(x=>x&&x!=='undefined'))],createdPersonIds=records.map(x=>String(x.person_id)).filter(x=>x&&x!=='undefined'),failures=[];
 const engagedStart=Date.now();try{await updateEngagementMetricsForPeople(personIds,orgId);timings.engagementMs=Date.now()-engagedStart}catch(error){failures.push('engagement:'+error.message);console.error('[ARIA] engagement:',error.message)}
 const relationshipStart=Date.now();try{await computeRelationshipScore(orgId,personIds);timings.relationshipMs=Date.now()-relationshipStart}catch(error){failures.push('relationship:'+error.message);console.error('[ARIA] relationship:',error.message)}

 const eventStart=Date.now();
 const participationIds=records.map(x=>x.id),events=[];
 if(participationIds.length){
  try{
   const created=await pool.query(`INSERT INTO aria_events(organization_id,person_id,type,actor_id,source,event_key,metadata,occurred_at)
    SELECT $1,p.person_id,'PARTICIPATION_CONFIRMED',NULL,'attendance','participation:'||p.participation_id||':confirmed',jsonb_build_object('session_id',$3,'participation_id',p.participation_id),NOW()
    FROM unnest($2::uuid[],$4::uuid[]) AS p(participation_id,person_id)
    ON CONFLICT(organization_id,event_key) DO NOTHING
    RETURNING id,organization_id,person_id,type,actor_id,source,event_key,metadata,occurred_at,created_at`,[orgId,participationIds,sessionId,createdPersonIds]);
   events.push(...created.rows);
  }catch(error){failures.push('events:'+error.message);console.error('[ARIA] event enqueue:',error.message)}
 }
 await mapConcurrent(events,CONCURRENCY,async event=>{try{await processAriaEvent(event)}catch(error){failures.push('event:'+event.person_id+':'+error.message);console.error('[ARIA] event processing:',error.message)}});
 timings.eventsMs=Date.now()-eventStart;

 const returnStart=Date.now();
 await mapConcurrent(personIds,CONCURRENCY,async personId=>{try{await handleReturnAfterAbsence({sessionId,orgId,personId})}catch(error){failures.push('return:'+personId+':'+error.message);console.error('[ARIA] return processing:',error.message)}});
 timings.returnsMs=Date.now()-returnStart;

 let immediateActions=0,absenceObservations=0;
 const absenceStart=Date.now();
 try{
  const absent=await pool.query(`SELECT p.id,p.first_name,p.last_name,p.display_name,p.phone,p.email FROM people p WHERE p.organization_id=$1 AND p.status='active'
   AND NOT EXISTS(SELECT 1 FROM attendance_records ar WHERE ar.organization_id=$1 AND ar.people_id=p.id AND ar.session_id=$2 AND ar.present=true AND ar.confirmed=true)
   AND NOT EXISTS(SELECT 1 FROM aria_attendance_contexts ac WHERE ac.organization_id=$1 AND ac.person_id=p.id AND ac.session_id=$2)
   AND NOT EXISTS(SELECT 1 FROM aria_care_contexts c WHERE c.organization_id=$1 AND c.person_id=p.id AND c.kind IN('travel','temporary_unavailable','not_attending') AND(c.ends_on IS NULL OR c.ends_on>CURRENT_DATE))
   AND NOT EXISTS(SELECT 1 FROM aria_care_contexts c WHERE c.organization_id=$1 AND c.person_id=p.id AND c.kind='preferred_service' AND c.ends_on IS NULL AND c.service_type IS NOT NULL AND c.service_type<>COALESCE(NULLIF($3,''),'weekday:'||EXTRACT(ISODOW FROM $4::timestamptz)::int))
   ORDER BY p.first_name,p.last_name`,[orgId,sessionId,sessionRow.service_type||'',sessionRow.started_at]);
  await mapConcurrent(absent.rows,CONCURRENCY,async person=>{
   try{
    const sourceEventId=`attendance:${sessionId}:absence:${person.id}`;
    const observationId=await createObservation({organizationId:orgId,personId:person.id,type:'UNUSUAL_ABSENCE',confidence:1,severity:'low',urgency:'low',evidence:{sources:['attendance'],facts:['Person was not recorded as present in this completed session'],inference:'This is an immediate absence signal, not a claim about an established attendance pattern.',session_id:sessionId,session_name:sessionRow.name||null,service_type:sessionRow.service_type||null},sourceEventId});
    absenceObservations++;
    await updatePersonState(person.id,orgId);
    const action=await planActionFromObservation({organizationId:orgId,personId:person.id,observationId,actionType:'SEND_MESSAGE',priority:'medium',actionMetadata:{kind:'first_session_check_in',reason:'ARIA noticed this person was not observed in the completed session.',summary:`${person.first_name||'This person'} wasn’t recorded at ${sessionRow.name||'the latest gathering'}.`,knowledge:'This is an immediate absence signal. ARIA does not yet know whether anything is wrong.',suggestion:'A simple check-in is the next useful step.',requires_human_approval:true,draft_required:true,channel:'whatsapp',first_session:true,pattern_claim:false,session_id:sessionId,session_name:sessionRow.name||null,service_type:sessionRow.service_type||null},actionKey:`briefing:first_session_absence:${sessionId}:${person.id}`});
    if(action)immediateActions++;
   }catch(error){failures.push('absence:'+person.id+':'+error.message);console.error('[ARIA] absence processing:',error.message)}
  });
 }catch(error){failures.push('absence-query:'+error.message);console.error('[ARIA] immediate absence response:',error.message)}
 timings.absenceMs=Date.now()-absenceStart;
 timings.totalMs=Date.now()-totalStart;
 console.info('[ARIA] attendance pipeline',JSON.stringify({session_id:sessionId,people:personIds.length,events:events.length,absence_observations:absenceObservations,immediate_actions:immediateActions,timings}));
 if(failures.length)throw new Error(`ARIA processing incomplete: ${failures.slice(0,5).join('; ')}`);
 return{session_id:sessionId,processed:personIds.length,events:events.length,absence_observations:absenceObservations,immediate_actions:immediateActions,timings};
}

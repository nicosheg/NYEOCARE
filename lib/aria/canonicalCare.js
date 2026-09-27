import pool from'../db';
import{emitAriaEvent}from'./eventEmitter';

const clean=(v,max=1000)=>String(v??'').trim().slice(0,max);

export async function resolveCareWorkInTransaction({db,organizationId,actorId,personId,actionId=null,observationId=null,reason='Human context recorded by operator.',source='operator'}){
 if(!organizationId||!actorId||!personId)throw new Error('organizationId, actorId and personId are required');
 const client=db||await pool.connect();
 const ownsClient=!db;
 try{
  await client.query('BEGIN');
  let resolvedObservationId=observationId||null;
  if(actionId){
   const r=await client.query(
    'UPDATE aria_actions SET status=\\'cancelled\\',failure_reason=$1,updated_at=NOW() WHERE id=$2 AND organization_id=$3 AND person_id=$4 AND status IN(\\'proposed\\',\\'approved\\') RETURNING id,observation_id',
    [clean(reason,500),actionId,organizationId,personId]
   );
   if(r.rows[0]?.observation_id)resolvedObservationId=resolvedObservationId||r.rows[0].observation_id;
  }
  const linked=await client.query(
   'SELECT id,observation_id FROM aria_actions WHERE organization_id=$1 AND person_id=$2 AND status IN(\\'proposed\\',\\'approved\\') AND ($3::uuid IS NULL OR observation_id=$3::uuid) FOR UPDATE',
   [organizationId,personId,resolvedObservationId]
  );
  const resolvedActionIds=[];
  for(const row of linked.rows){
   await client.query('UPDATE aria_actions SET status=\\'cancelled\\',failure_reason=$1,updated_at=NOW() WHERE id=$2 AND organization_id=$3 AND status IN(\\'proposed\\',\\'approved\\')',[clean(reason,500),row.id,organizationId]);
   resolvedActionIds.push(String(row.id));
   if(row.observation_id)resolvedObservationId=resolvedObservationId||row.observation_id;
  }
  if(actionId&&!resolvedActionIds.includes(String(actionId)))resolvedActionIds.push(String(actionId));
  if(resolvedObservationId){
   await client.query('UPDATE aria_observations SET status=\\'resolved\\',resolved_at=NOW() WHERE id=$1 AND organization_id=$2 AND person_id=$3 AND status=\\'active\\'',[resolvedObservationId,organizationId,personId]);
  }
  const counts=(await client.query(
   'SELECT (SELECT COUNT(*)::int FROM aria_observations WHERE organization_id=$1 AND person_id=$2 AND status=\\'active\\' AND(expires_at IS NULL OR expires_at>NOW())) open_observations,(SELECT COUNT(*)::int FROM aria_actions WHERE organization_id=$1 AND person_id=$2 AND status IN(\\'proposed\\',\\'approved\\') AND(expires_at IS NULL OR expires_at>NOW())) open_actions',
   [organizationId,personId]
  )).rows[0]||{};
  await client.query(
   'INSERT INTO aria_person_state(person_id,organization_id,open_observation_count,open_action_count,followup_state,updated_at) VALUES($1,$2,$3,$4,$5,NOW()) ON CONFLICT(person_id,organization_id) DO UPDATE SET open_observation_count=EXCLUDED.open_observation_count,open_action_count=EXCLUDED.open_action_count,followup_state=CASE WHEN EXCLUDED.open_action_count=0 AND EXCLUDED.open_observation_count=0 THEN \\'none\\' ELSE aria_person_state.followup_state END,updated_at=NOW()',
   [personId,organizationId,Number(counts.open_observations)||0,Number(counts.open_actions)||0,(Number(counts.open_observations)||0)+(Number(counts.open_actions)||0)>0?'active':'none']
  );
  const sourceIds=[...new Set(resolvedActionIds.concat(resolvedObservationId?[String(resolvedObservationId)]:[]))];
  await client.query(
   'UPDATE aria_daily_queue_items SET status=\\'dismissed\\',completed_at=NOW(),updated_at=NOW() WHERE organization_id=$1 AND status IN(\\'pending\\',\\'deferred\\') AND(source_id=ANY($2::text[]) OR person_id=$3)',
   [organizationId,sourceIds,personId]
  );
  const event=await emitAriaEvent({organizationId,personId,type:'CARE_CONTEXT_RECORDED',source,actorId,evidenceKind:'human_report',verificationStatus:'reported',confidence:.98,metadata:{reason:clean(reason,500),action_id:actionId||null,observation_id:resolvedObservationId||null,resolved_action_ids:resolvedActionIds}},client);
  await client.query('COMMIT');
  return{resolved:true,action_ids:resolvedActionIds,observation_id:resolvedObservationId||null,event_id:event?.id||null,open_observation_count:Number(counts.open_observations)||0,open_action_count:Number(counts.open_actions)||0};
 }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}finally{client.release()}
}


export async function resolveCareWork(args){
 const client=await pool.connect();
 try{await client.query('BEGIN');const result=await resolveCareWorkInTransaction({...args,db:client});await client.query('COMMIT');return result}catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}finally{client.release()}
}

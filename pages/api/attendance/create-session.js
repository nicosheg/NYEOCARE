// pages/api/attendance/create-session.js
// Starting a new attendance session never waits for ARIA.
// session_sections is the canonical section table.

import pool from '../../../lib/db';
import { withAdmin } from '../../../lib/apiHelpers';
import { emitAriaEvent } from '../../../lib/aria/eventEmitter';

export default withAdmin(async function handler(req,res){
  if(req.method!=='POST'){
    res.setHeader('Allow','POST');
    return res.status(405).json({error:'Method not allowed'});
  }

  const{name,sections,service_type=null,event_kind='service',event_scope='organization',group_id=null,event_semantics={},expected_population_rule={},attendance_interpretation='neutral',participation_expected=true,optional=false,absence_meaningful=false}=req.body||{};
  if(typeof name!=='string'||!name.trim()){
    return res.status(400).json({error:'Event name is required.'});
  }

  const normalizedSections=Array.isArray(sections)
    ? [...new Set(sections.filter(s=>typeof s==='string').map(s=>s.trim()).filter(Boolean))]
    : [];
  if(!normalizedSections.length)normalizedSections.push('All');

  const orgId=req.org.id;
  const userId=req.user.id;
  const client=await pool.connect();

  try{
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1::text))",[orgId]);

    const active=await client.query(
      `SELECT id,name,status,started_by,started_at
       FROM sessions
       WHERE organization_id=$1 AND status='active'
       LIMIT 1
       FOR UPDATE`,
      [orgId]
    );

    if(active.rows.length){
      await client.query('ROLLBACK');
      return res.status(409).json({
        success:false,
        blocked:true,
        can_discard:['owner','admin'].includes(req.user.role),
        reason:'active',
        error:'An attendance session is already active.',
        session:active.rows[0]
      });
    }

    const created=await client.query(
      `INSERT INTO sessions(
         organization_id,name,status,service_type,started_by,started_at,
         event_kind,event_scope,group_id,event_semantics,expected_population_rule,attendance_interpretation,participation_expected,optional,absence_meaningful,
         aria_processing_status,aria_processing_stage,aria_processing_progress,
         aria_processing_processed,aria_processing_total
       )
       VALUES($1,$2,'active',$3,$4,NOW(),$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,'idle','idle',0,0,0)
       RETURNING id,name,status,service_type,started_by,started_at,event_kind,event_scope,group_id,event_semantics,expected_population_rule,attendance_interpretation,participation_expected,optional,absence_meaningful,
                 aria_processing_status,aria_processing_stage,aria_processing_progress,
                 aria_processing_processed,aria_processing_total`,
      [orgId,name.trim(),userId,service_type||null,event_kind||'service',event_scope||'organization',group_id||null,JSON.stringify(event_semantics||{}),JSON.stringify(expected_population_rule||{}),attendance_interpretation||'neutral',participation_expected!==false,optional===true,absence_meaningful===true]
    );

    const session=created.rows[0];

    await client.query(
      `INSERT INTO session_users(session_id,user_id)
       VALUES($1,$2)
       ON CONFLICT DO NOTHING`,
      [session.id,userId]
    );

    await client.query(
      `INSERT INTO session_sections(session_id,name,organization_id)
       SELECT $1,x,$2
       FROM unnest($3::text[]) AS t(x)
       ON CONFLICT DO NOTHING`,
      [session.id,orgId,normalizedSections]
    );

    const event=await emitAriaEvent({organizationId:orgId,type:'SERVICE_CREATED',source:'attendance',actorId:userId,actorRole:req.user.role,evidenceKind:'fact',verificationStatus:'verified',confidence:1,metadata:{session_id:session.id,name:session.name,service_type:session.service_type,event_kind:session.event_kind,event_scope:session.event_scope,group_id:session.group_id,event_semantics:session.event_semantics,expected_population_rule:session.expected_population_rule,attendance_interpretation:session.attendance_interpretation,participation_expected:session.participation_expected,optional:session.optional,absence_meaningful:session.absence_meaningful,memory:{type:'event_semantics',key:'session:'+session.id,value:{session_id:session.id,name:session.name,service_type:session.service_type,event_kind:session.event_kind,event_scope:session.event_scope,group_id:session.group_id,event_semantics:session.event_semantics,expected_population_rule:session.expected_population_rule,attendance_interpretation:session.attendance_interpretation,participation_expected:session.participation_expected,optional:session.optional,absence_meaningful:session.absence_meaningful},importance:'important'}},eventKey:'service:'+session.id+':created'},client);
    await client.query('COMMIT');

    return res.status(201).json({
      success:true,
      id:session.id,
      session,
      sections:normalizedSections,
      joined:true,
      can_discard:['owner','admin'].includes(req.user.role),
      background_processing_not_blocking:true
    });
  }catch(err){
    try{await client.query('ROLLBACK')}catch{}
    if(err.code==='23505'){
      return res.status(409).json({
        success:false,blocked:true,
        can_discard:['owner','admin'].includes(req.user.role),
        reason:'active',
        error:'An attendance session is already active.'
      });
    }
    console.error('[ATTENDANCE] Create session error:',err);
    return res.status(500).json({error:'Could not start attendance.'});
  }finally{
    client.release();
  }
});

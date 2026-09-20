// pages/api/attendance/create-session.js
// Starting a new attendance session never waits for ARIA.
// session_sections is the canonical section table.

import pool from '../../../lib/db';
import { withAdmin } from '../../../lib/apiHelpers';

export default withAdmin(async function handler(req,res){
  if(req.method!=='POST'){
    res.setHeader('Allow','POST');
    return res.status(405).json({error:'Method not allowed'});
  }

  const{name,sections}=req.body||{};
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
         organization_id,name,status,started_by,started_at,
         aria_processing_status,aria_processing_stage,aria_processing_progress,
         aria_processing_processed,aria_processing_total
       )
       VALUES($1,$2,'active',$3,NOW(),'idle','idle',0,0,0)
       RETURNING id,name,status,started_by,started_at,
                 aria_processing_status,aria_processing_stage,aria_processing_progress,
                 aria_processing_processed,aria_processing_total`,
      [orgId,name.trim(),userId]
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

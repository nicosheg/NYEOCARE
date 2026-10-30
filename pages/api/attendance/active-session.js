// pages/api/attendance/active-session.js
import pool from '../../../lib/db';
import { withOrg } from '../../../lib/apiHelpers';

export default withOrg(async function handler(req,res){
  if(req.method!=='GET'){
    res.setHeader('Allow','GET');
    return res.status(405).json({error:'Method not allowed'});
  }

  res.setHeader('Cache-Control','no-store');
  const orgId=req.org.id;
  const userId=req.user.id;

  try{
    const result=await pool.query(
      `WITH active_session AS (
         SELECT s.id,s.name,s.status,s.started_by,s.started_at,s.auto_close_at,s.auto_close_reason,s.closure_reason,
                COALESCE(NULLIF(o.settings->>'timezone',''),'Africa/Lagos') AS organization_timezone,
                s.aria_processing_status,s.aria_processing_attempts,
                s.aria_processing_started_at,s.aria_processing_completed_at,s.aria_processing_error,
                s.aria_processing_stage,s.aria_processing_progress,
                s.aria_processing_processed,s.aria_processing_total,
                EXISTS(
                  SELECT 1 FROM session_users su
                  WHERE su.session_id=s.id AND su.user_id=$2
                ) joined,
                (SELECT COUNT(*) FROM session_users su2 WHERE su2.session_id=s.id) participant_count
         FROM sessions s
         JOIN organizations o ON o.id=s.organization_id
         WHERE s.organization_id=$1 AND s.status='active'
         LIMIT 1
       ),
       background AS (
         SELECT s.id,s.name,s.status,s.started_at,s.closed_at,s.auto_close_at,s.auto_close_reason,s.closure_reason,
                COALESCE(NULLIF(o.settings->>'timezone',''),'Africa/Lagos') AS organization_timezone,
                s.aria_processing_status,s.aria_processing_attempts,
                s.aria_processing_started_at,s.aria_processing_completed_at,s.aria_processing_error,
                s.aria_processing_stage,s.aria_processing_progress,
                s.aria_processing_processed,s.aria_processing_total
         FROM sessions s
         JOIN organizations o ON o.id=s.organization_id
         WHERE s.organization_id=$1
           AND s.status='closed'
           AND s.aria_processing_status IN('pending','processing','needs_attention')
         ORDER BY COALESCE(s.closed_at,s.started_at) DESC
         LIMIT 1
       ),
       last_closed AS (
         SELECT s.id,s.started_at,s.closed_at,s.auto_close_at,s.auto_close_reason,s.closure_reason
         FROM sessions s
         WHERE s.organization_id=$1 AND s.status='closed'
         ORDER BY COALESCE(s.closed_at,s.started_at) DESC
         LIMIT 1
       )
       SELECT
         (SELECT row_to_json(a) FROM active_session a) AS active_session,
         (SELECT row_to_json(b) FROM background b) AS background_session,
         (SELECT row_to_json(c) FROM last_closed c) AS last_closed_session`,
      [orgId,userId]
    );

    const active=result.rows[0]?.active_session||null;
    const background=result.rows[0]?.background_session||null;
    const lastClosed=result.rows[0]?.last_closed_session||null;

    if(!active){
      const latest=background||lastClosed||null;
      return res.status(200).json({
        active:false,
        recoverable:Boolean(background),
        can_start_new_session:['owner','admin'].includes(String(req.user.role||'').toLowerCase()),
        blocked_reason:null,
        session_id:latest?.id||null,
        name:latest?.name||null,
        status:latest?.status||null,
        started_by:null,
        started_at:latest?.started_at||null,
        closed_at:latest?.closed_at||null,
        auto_close_at:latest?.auto_close_at||null,
        auto_close_reason:latest?.auto_close_reason||null,
        closure_reason:latest?.closure_reason||null,
        organization_timezone:latest?.organization_timezone||'Africa/Lagos',
        last_closed_session_id:lastClosed?.id||null,
        last_closed_at:lastClosed?.closed_at||null,
        last_closed_reason:lastClosed?.closure_reason||null,
        joined:false,
        participant_count:0,
        can_discard:false,
        processing_status:background?.aria_processing_status||null,
        processing_attempts:Number(background?.aria_processing_attempts)||0,
        processing_started_at:background?.aria_processing_started_at||null,
        processing_completed_at:background?.aria_processing_completed_at||null,
        processing_error:null,
        processing_stage:background?.aria_processing_stage||null,
        processing_progress:Number(background?.aria_processing_progress)||0,
        processing_processed:Number(background?.aria_processing_processed)||0,
        processing_total:Number(background?.aria_processing_total)||0,
        blocking_count:0,
        background_processing:background?{
          session_id:background.id,name:background.name,status:background.status,
          processing_status:background.aria_processing_status,
          stage:background.aria_processing_stage,
          progress:Number(background.aria_processing_progress)||0,
          processed:Number(background.aria_processing_processed)||0,
          total:Number(background.aria_processing_total)||0,
          started_at:background.aria_processing_started_at,
          completed_at:background.aria_processing_completed_at
        }:null
      });
    }

    return res.status(200).json({
      active:true,
      recoverable:false,
      can_start_new_session:false,
      blocked_reason:'active',
      session_id:active.id,
      name:active.name,
      status:active.status,
      started_by:active.started_by,
      started_at:active.started_at,
      auto_close_at:active.auto_close_at,
      auto_close_reason:active.auto_close_reason,
      closure_reason:active.closure_reason,
      organization_timezone:active.organization_timezone,
      last_closed_session_id:lastClosed?.id||null,
      last_closed_at:lastClosed?.closed_at||null,
      last_closed_reason:lastClosed?.closure_reason||null,
      closed_at:null,
      joined:active.joined,
      participant_count:Number(active.participant_count)||0,
      can_discard:['owner','admin'].includes(req.user.role),
      processing_status:active.aria_processing_status||null,
      processing_attempts:Number(active.aria_processing_attempts)||0,
      processing_started_at:active.aria_processing_started_at||null,
      processing_completed_at:active.aria_processing_completed_at||null,
      processing_error:active.aria_processing_error||null,
      processing_stage:active.aria_processing_stage||'idle',
      processing_progress:Number(active.aria_processing_progress)||0,
      processing_processed:Number(active.aria_processing_processed)||0,
      processing_total:Number(active.aria_processing_total)||0,
      blocking_count:0,
      background_processing:background?{
        session_id:background.id,name:background.name,status:background.status,
        processing_status:background.aria_processing_status,
        stage:background.aria_processing_stage,
        progress:Number(background.aria_processing_progress)||0,
        processed:Number(background.aria_processing_processed)||0,
        total:Number(background.aria_processing_total)||0,
        started_at:background.aria_processing_started_at,
        completed_at:background.aria_processing_completed_at
      }:null
    });
  }catch(err){
    console.error('[ATTENDANCE] Active session error:',err);
    return res.status(500).json({error:'Could not load attendance.'});
  }
});

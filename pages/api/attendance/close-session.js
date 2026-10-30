// pages/api/attendance/close-session.js
import pool from '../../../lib/db';
import { withOrg } from '../../../lib/apiHelpers';
import { enqueueAttendanceProcessing } from '../../../lib/aria/attendanceQueue';
import { isOrganizationOperator } from '../../../lib/attendance/access';

export default withOrg(async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!isOrganizationOperator(req.user?.role))return res.status(403).json({error:'Only authorized organization operators can save attendance.'});
  const{session_id}=req.body||{};
  if(!session_id)return res.status(400).json({error:'session_id is required.'});

  const orgId=req.org.id,userId=req.user.id,client=await pool.connect();

  try{
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1::text))",[orgId]);

    const currentResult=await client.query(
      `SELECT id,name,status,started_at,closed_at,auto_close_at,auto_close_reason,closure_reason,
              register_completeness,register_source,register_reviewed_at,register_reviewed_by,
              aria_processing_status,aria_processing_attempts,aria_processing_started_at,
              aria_processing_completed_at,aria_processing_error,aria_processing_stage,
              aria_processing_progress,aria_processing_processed,aria_processing_total
       FROM sessions
       WHERE id=$1 AND organization_id=$2
       LIMIT 1
       FOR UPDATE`,
      [session_id,orgId]
    );

    if(!currentResult.rows.length){
      await client.query('ROLLBACK');
      return res.status(404).json({error:'Attendance session not found.'});
    }

    const current=currentResult.rows[0];
    const isAdmin=['owner','admin'].includes(String(req.user.role||'').toLowerCase());
    if(!isAdmin){
      const membership=await client.query(
        'SELECT 1 FROM session_users WHERE session_id=$1 AND user_id=$2 LIMIT 1',
        [session_id,userId]
      );
      if(!membership.rows.length){
        await client.query('ROLLBACK');
        return res.status(403).json({error:'Join this attendance session before saving it.'});
      }
    }

    if(current.status!=='active'){
      await client.query('ROLLBACK');
      return res.status(200).json({
        success:true,
        already_saved:true,
        processing_pending:['pending','processing'].includes(String(current.aria_processing_status||'')),
        queued:true,
        session:current,
        message:'Attendance is already saved. ARIA is handling the background work.'
      });
    }

    // The user's affirmative confirmation is the only UI step. The database
    // closes the session, confirms existing marks, and fills every remaining
    // session-roster entry as not present in one transaction.
    const finalized=await client.query(
      'SELECT public.nyeocare_finalize_attendance_session($1,$2,$3) AS finalized',
      [session_id,'manual_confirmation',userId]
    );
    if(finalized.rows[0]?.finalized!==true){
      await client.query('ROLLBACK');
      return res.status(409).json({error:'This attendance session changed before it could be saved.'});
    }

    const closed=(await client.query(
      `SELECT id,name,status,started_at,closed_at,auto_close_at,auto_close_reason,closure_reason,
              register_completeness,register_source,register_reviewed_at,register_reviewed_by,
              aria_processing_status,aria_processing_attempts,aria_processing_started_at,
              aria_processing_completed_at,aria_processing_error,aria_processing_stage,
              aria_processing_progress,aria_processing_processed,aria_processing_total
       FROM sessions WHERE id=$1 AND organization_id=$2 LIMIT 1`,
      [session_id,orgId]
    )).rows[0];

    const queued=await enqueueAttendanceProcessing({
      organizationId:orgId,
      sessionId:session_id,
      actorId:userId,
      stage:'persist',
      db:client
    });

    await client.query('COMMIT');

    return res.status(202).json({
      success:true,
      processing_pending:true,
      queued:true,
      queue_message_id:queued.messageId,
      error:null,
      session:closed,
      message:'Attendance saved. ARIA is updating the organization in the background.'
    });
  }catch(err){
    try{await client.query('ROLLBACK')}catch{}
    console.error('[ATTENDANCE] Close session error:',err);
    return res.status(503).json({
      success:false,
      error:'Attendance could not be saved yet. Your current attendance marks are still open.'
    });
  }finally{
    client.release();
  }
});

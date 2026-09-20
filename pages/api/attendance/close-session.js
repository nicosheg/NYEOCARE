// pages/api/attendance/close-session.js
import pool from '../../../lib/db';
import { withAdmin } from '../../../lib/apiHelpers';
import { enqueueAttendanceProcessing } from '../../../lib/aria/attendanceQueue';

export default withAdmin(async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const{session_id}=req.body||{};
  if(!session_id)return res.status(400).json({error:'session_id is required.'});

  const orgId=req.org.id,userId=req.user.id,client=await pool.connect();

  try{
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1::text))",[orgId]);

    const q=await client.query(
      `SELECT id,name,status,started_at,closed_at,aria_processing_status,aria_processing_attempts,
          aria_processing_started_at,aria_processing_completed_at,aria_processing_error,
          aria_processing_stage,aria_processing_progress,aria_processing_processed,aria_processing_total
       FROM sessions
       WHERE id=$1 AND organization_id=$2
       LIMIT 1
       FOR UPDATE`,
      [session_id,orgId]
    );

    if(!q.rows.length){
      await client.query('ROLLBACK');
      return res.status(404).json({error:'Attendance session not found.'});
    }

    const current=q.rows[0];

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

    await client.query(
      `UPDATE attendance_records
       SET confirmed=true,reviewed_by=$1,reviewed_at=NOW()
       WHERE organization_id=$2 AND session_id=$3
         AND present=true AND confirmed=false`,
      [userId,orgId,session_id]
    );

    const total=await client.query(
      `SELECT COUNT(*)::int AS count
       FROM people
       WHERE organization_id=$1 AND COALESCE(status,'active')='active'`,
      [orgId]
    );

    const closed=await client.query(
      `UPDATE sessions
       SET status='closed',
           closed_by=$1,
           closed_at=NOW(),
           aria_processing_status='pending',
           aria_processing_stage='persist',
           aria_processing_progress=0,
           aria_processing_processed=0,
           aria_processing_total=$4,
           aria_processing_completed_at=NULL,
           aria_processing_error=NULL,
           aria_processing_started_at=NULL,
           aria_processing_heartbeat_at=NULL
       WHERE id=$2 AND organization_id=$3 AND status='active'
       RETURNING id,name,status,started_at,closed_at,aria_processing_status,aria_processing_attempts,
                 aria_processing_started_at,aria_processing_completed_at,aria_processing_error,
                 aria_processing_stage,aria_processing_progress,aria_processing_processed,aria_processing_total`,
      [userId,session_id,orgId,Number(total.rows[0]?.count)||0]
    );

    if(!closed.rows.length){
      await client.query('ROLLBACK');
      return res.status(409).json({error:'This attendance session changed before it could be saved.'});
    }

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
      session:closed.rows[0],
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

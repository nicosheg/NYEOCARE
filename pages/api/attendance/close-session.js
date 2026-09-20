// pages/api/attendance/close-session.js
import pool from '../../../lib/db';
import { withAdmin } from '../../../lib/apiHelpers';
import { enqueueAttendanceProcessing } from '../../../lib/aria/attendanceQueue';
import { directAriaEvent } from '../../../lib/aria/director';
import { emitAriaEvent } from '../../../lib/aria/eventEmitter';

const failMsg='Attendance is saved, but ARIA could not be queued. Retry ARIA processing to unlock the next session.';

export default withAdmin(async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const{session_id}=req.body||{};
  if(!session_id)return res.status(400).json({error:'session_id is required.'});

  const orgId=req.org.id,userId=req.user.id,client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1::text))",[orgId]);

    const q=await client.query(
      "SELECT id,name,status,started_at FROM sessions WHERE id=$1 AND organization_id=$2 LIMIT 1 FOR UPDATE",
      [session_id,orgId]
    );
    if(!q.rows.length){
      await client.query('ROLLBACK');
      return res.status(404).json({error:'Attendance session not found.'});
    }
    if(q.rows[0].status!=='active'){
      await client.query('ROLLBACK');
      return res.status(409).json({error:'This attendance session is already saved.'});
    }

    await client.query(
      "UPDATE attendance_records SET confirmed=true,reviewed_by=$1,reviewed_at=NOW() WHERE organization_id=$2 AND session_id=$3 AND present=true AND confirmed=false",
      [userId,orgId,session_id]
    );

    const closed=await client.query(
      "UPDATE sessions SET status='closed',closed_by=$1,closed_at=NOW(),aria_processing_status='pending'," +
      "aria_processing_completed_at=NULL,aria_processing_error=NULL,aria_processing_started_at=NULL " +
      "WHERE id=$2 AND organization_id=$3 AND status='active' " +
      "RETURNING id,name,status,started_at,closed_at,aria_processing_status,aria_processing_attempts," +
      "aria_processing_started_at,aria_processing_completed_at,aria_processing_error",
      [userId,session_id,orgId]
    );
    await client.query('COMMIT');

    try{
      await enqueueAttendanceProcessing({organizationId:orgId,sessionId:session_id,actorId:userId});
    }catch(queueError){
      const internal=String(queueError?.message||failMsg).slice(0,2000);
      console.error('[ATTENDANCE] Queue publish failed after close:',queueError);
      await pool.query(
        "UPDATE sessions SET aria_processing_status='failed',aria_processing_error=$1 WHERE id=$2 AND organization_id=$3",
        [internal,session_id,orgId]
      );
      try{
        const event=await emitAriaEvent({
          organizationId:orgId,type:'ATTENDANCE_PROCESSING_FAILED',source:'attendance',actorId:userId,
          metadata:{session_id,session_name:closed.rows[0]?.name||null,error:internal},
          eventKey:`attendance:${session_id}:queue_failed`
        });
        if(event)await directAriaEvent(event);
      }catch(signalError){console.error('[ATTENDANCE] Could not persist queue failure signal:',signalError);}
      return res.status(503).json({
        success:false,processing_failed:true,
        error:failMsg,
        session:{...closed.rows[0],aria_processing_status:'failed',aria_processing_error:internal}
      });
    }

    return res.status(202).json({
      success:true,processing_pending:true,error:null,
      queued:true,
      session:{...closed.rows[0],aria_processing_status:'pending'},
      message:'Attendance saved. ARIA is starting the intelligence pass in the background.'
    });
  }catch(err){
    try{await client.query('ROLLBACK')}catch{}
    console.error('[ATTENDANCE] Close session error:',err);
    return res.status(500).json({error:'Could not save attendance.'});
  }finally{client.release();}
});
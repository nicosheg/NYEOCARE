// pages/api/attendance/process-session.js
import pool from '../../../lib/db';
import { withAdmin } from '../../../lib/apiHelpers';
import { enqueueAttendanceProcessing } from '../../../lib/aria/attendanceQueue';

const failMsg='ARIA could not be queued for another pass. The saved attendance is preserved; retry again to unlock the next session.';

export default withAdmin(async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  const{session_id}=req.body||{};
  if(!session_id)return res.status(400).json({error:'session_id is required.'});

  const orgId=req.org.id,userId=req.user.id,client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1::text))",[orgId]);

    const s=await client.query(
      "SELECT id,status,aria_processing_status,aria_processing_started_at,aria_processing_attempts " +
      "FROM sessions WHERE id=$1 AND organization_id=$2 LIMIT 1 FOR UPDATE",
      [session_id,orgId]
    );
    if(!s.rows.length){
      await client.query('ROLLBACK');
      return res.status(404).json({error:'Attendance session not found.'});
    }
    const row=s.rows[0];
    if(row.status!=='closed'){
      await client.query('ROLLBACK');
      return res.status(409).json({error:'Save the attendance session before processing ARIA.'});
    }
    if(row.aria_processing_status==='completed'){
      await client.query('COMMIT');
      return res.status(200).json({success:true,processing_failed:false,aria:{session_id,already_processed:true}});
    }

    const stale=row.aria_processing_status==='processing'&&row.aria_processing_started_at&&
      new Date(row.aria_processing_started_at).getTime()<Date.now()-5*60*1000;

    if(row.aria_processing_status==='processing'&&!stale){
      await client.query('ROLLBACK');
      return res.status(202).json({
        success:true,processing_failed:false,processing_pending:true,queued:false,
        error:null,aria:{session_id,processing_status:'processing'}
      });
    }

    await client.query(
      "UPDATE sessions SET aria_processing_status='pending',aria_processing_error=NULL,aria_processing_completed_at=NULL,aria_processing_started_at=NULL " +
      "WHERE id=$1 AND organization_id=$2 AND status='closed'",
      [session_id,orgId]
    );
    await client.query('COMMIT');

    try{
      const queued=await enqueueAttendanceProcessing({organizationId:orgId,sessionId:session_id,actorId:userId});
      return res.status(202).json({
        success:true,processing_failed:false,processing_pending:true,queued:true,
        queue_message_id:queued?.messageId??null,error:null,
        aria:{session_id,processing_status:'pending'}
      });
    }catch(queueError){
      const internal=String(queueError?.message||failMsg).slice(0,2000);
      await pool.query(
        "UPDATE sessions SET aria_processing_status='failed',aria_processing_error=$1 WHERE id=$2 AND organization_id=$3",
        [internal,session_id,orgId]
      );
      console.error('[ATTENDANCE] Retry queue publish failed:',queueError);
      return res.status(503).json({
        success:false,processing_failed:true,error:failMsg,
        aria:{session_id,processing_status:'failed'}
      });
    }
  }catch(e){
    try{await client.query('ROLLBACK')}catch{}
    console.error('[ATTENDANCE] Process session queue error:',e);
    return res.status(500).json({error:'Unable to queue ARIA processing.'});
  }finally{client.release();}
});
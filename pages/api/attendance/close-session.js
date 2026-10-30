// pages/api/attendance/close-session.js
import pool from '../../../lib/db';
import { withOrg } from '../../../lib/apiHelpers';
import { isOrganizationOperator } from '../../../lib/attendance/access';
import { finalizeAttendanceSession } from '../../../lib/attendance/sessionLifecycle';

export default withOrg(async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!isOrganizationOperator(req.user?.role))return res.status(403).json({error:'Only authorized organization operators can save attendance.'});
  const{session_id}=req.body||{};
  if(!session_id)return res.status(400).json({error:'session_id is required.'});

  const orgId=req.org.id,userId=req.user.id,client=await pool.connect();

  try{
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1::text))",[orgId]);
    const isAdmin=['owner','admin'].includes(String(req.user.role||'').toLowerCase());
    const current=(await client.query(
      `SELECT id,status FROM sessions
       WHERE id=$1 AND organization_id=$2 LIMIT 1 FOR UPDATE`,
      [session_id,orgId]
    )).rows[0];
    if(!current){
      await client.query('ROLLBACK');
      return res.status(404).json({error:'Attendance session not found.'});
    }
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

    const result=await finalizeAttendanceSession({
      db:client,
      organizationId:orgId,
      actorId:userId,
      sessionId:session_id
    });
    await client.query('COMMIT');

    if(result.alreadySaved){
      return res.status(200).json({
        success:true,
        already_saved:true,
        processing_pending:result.processing_pending,
        queued:true,
        session:result.session,
        message:'Attendance is already saved. ARIA is handling the background work.'
      });
    }

    return res.status(202).json({
      success:true,
      processing_pending:true,
      queued:true,
      queue_message_id:result.queue_message_id,
      error:null,
      session:result.session,
      message:'Attendance saved. ARIA is updating the organization in the background.'
    });
  }catch(err){
    await client.query('ROLLBACK').catch(()=>{});
    console.error('[ATTENDANCE] Close session error:',err);
    return res.status(err.status||503).json({
      success:false,
      error:err.status?err.message:'Attendance could not be saved yet. Your current attendance marks are still open.'
    });
  }finally{
    client.release();
  }
});

// pages/api/attendance/close-session.js
import pool from '../../../lib/db';
import { withOrg } from '../../../lib/apiHelpers';
import { enqueueAttendanceProcessing } from '../../../lib/aria/attendanceQueue';
import { isOrganizationOperator } from '../../../lib/attendance/access';

export default withOrg(async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
  if(!isOrganizationOperator(req.user?.role))return res.status(403).json({error:'Only authorized organization operators can save attendance.'});
  const{session_id,register_completeness='unconfirmed',register_source='digital_roster',register_note=null}=req.body||{};
  if(!session_id)return res.status(400).json({error:'session_id is required.'});
  if(!['unconfirmed','incomplete','complete'].includes(register_completeness))return res.status(400).json({error:'register_completeness must be unconfirmed, incomplete, or complete.'});
  if(register_source!==null&&!['digital_roster','paper_sheet','manual_reconciliation','other'].includes(register_source))return res.status(400).json({error:'Unsupported register source.'});
  const registerNote=typeof register_note==='string'?register_note.trim().slice(0,500):null;
  const verifiedRegisterSource=register_completeness==='unconfirmed'?null:register_source;
  if(register_completeness==='complete'&&!verifiedRegisterSource)return res.status(400).json({error:'A complete register requires a recorded source.'});
  if(register_completeness==='complete'&&verifiedRegisterSource==='other'&&!registerNote)return res.status(400).json({error:'Describe the other register source before confirming completeness.'});

  const orgId=req.org.id,userId=req.user.id,client=await pool.connect();

  try{
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1::text))",[orgId]);

    const q=await client.query(
      `SELECT id,name,status,started_at,closed_at,register_completeness,register_source,register_reviewed_at,register_reviewed_by,register_review_note,aria_processing_status,aria_processing_attempts,
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
           register_completeness=$5,
           register_source=$6,
           register_reviewed_at=NOW(),
           register_reviewed_by=$1,
           register_review_note=$7,
           aria_processing_status='pending',
           aria_processing_attempts=0,
           aria_processing_stage='persist',
           aria_processing_progress=0,
           aria_processing_processed=0,
           aria_processing_total=$4,
           aria_processing_completed_at=NULL,
           aria_processing_error=NULL,
           aria_processing_started_at=NULL,
           aria_processing_heartbeat_at=NULL
       WHERE id=$2 AND organization_id=$3 AND status='active'
       RETURNING id,name,status,started_at,closed_at,register_completeness,register_source,register_reviewed_at,register_reviewed_by,register_review_note,aria_processing_status,aria_processing_attempts,
                 aria_processing_started_at,aria_processing_completed_at,aria_processing_error,
                 aria_processing_stage,aria_processing_progress,aria_processing_processed,aria_processing_total`,
      [userId,session_id,orgId,Number(total.rows[0]?.count)||0,register_completeness,verifiedRegisterSource,registerNote]
    );

    if(!closed.rows.length){
      await client.query('ROLLBACK');
      return res.status(409).json({error:'This attendance session changed before it could be saved.'});
    }

    await client.query(
      `INSERT INTO attendance_register_events(
         organization_id,session_id,register_completeness,register_source,note,actor_id,recorded_at
       ) VALUES($1,$2,$3,$4,$5,$6,NOW())`,
      [orgId,session_id,register_completeness,verifiedRegisterSource,registerNote,userId]
    );

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

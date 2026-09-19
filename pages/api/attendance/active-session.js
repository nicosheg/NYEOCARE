// pages/api/attendance/active-session.js
import pool from'../../../lib/db';import{withOrg}from'../../../lib/apiHelpers';
export default withOrg(async function handler(req,res){
 if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({error:'Method not allowed'});}
 res.setHeader('Cache-Control','no-store');
 const orgId=req.org.id,userId=req.user.id;
 try{
  const result=await pool.query(
   'SELECT s.id,s.name,s.status,s.started_by,s.started_at,s.closed_at,s.aria_processing_status,s.aria_processing_attempts,s.aria_processing_started_at,s.aria_processing_completed_at,s.aria_processing_error,EXISTS(SELECT 1 FROM session_users su WHERE su.session_id=s.id AND su.user_id=$2) joined,(SELECT COUNT(*) FROM session_users su2 WHERE su2.session_id=s.id) participant_count FROM sessions s WHERE s.organization_id=$1 AND(s.status=\'active\' OR(s.status=\'closed\' AND s.aria_processing_status IN(\'pending\',\'processing\',\'failed\'))) ORDER BY CASE WHEN s.status=\'active\' THEN 0 ELSE 1 END,s.started_at DESC LIMIT 1',
   [orgId,userId]
  );
  if(!result.rows.length)return res.status(200).json({active:false});
  const row=result.rows[0],canDiscard=['owner','admin'].includes(req.user.role);
  return res.status(200).json({active:row.status==='active',recoverable:row.status==='closed',session_id:row.id,name:row.name,status:row.status,started_by:row.started_by,started_at:row.started_at,closed_at:row.closed_at,joined:row.joined,participant_count:Number(row.participant_count)||0,can_discard:canDiscard,processing_status:row.aria_processing_status,processing_attempts:Number(row.aria_processing_attempts)||0,processing_started_at:row.aria_processing_started_at,processing_completed_at:row.aria_processing_completed_at,processing_error:row.aria_processing_error});
 }catch(err){console.error('[ATTENDANCE] Active session error:',err);return res.status(500).json({error:'Could not load attendance.'});}
});
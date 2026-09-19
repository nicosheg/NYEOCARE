// pages/api/attendance/close-session.js
import pool from'../../../lib/db';import{withAdmin}from'../../../lib/apiHelpers';import{generateParticipationFromSession}from'../../../lib/aria/participationGenerator';
const failMsg='ARIA could not finish processing this attendance yet. The saved session and attendance are preserved, and you can retry safely.';
async function setState(org,id,state,error=null,completed=false){
 await pool.query('UPDATE sessions SET aria_processing_status=$1,aria_processing_error=$2,aria_processing_completed_at=$3 WHERE id=$4 AND organization_id=$5',[state,error,completed?'NOW()':null,id,org]);
}
export default withAdmin(async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const{session_id}=req.body||{};if(!session_id)return res.status(400).json({error:'session_id is required.'});
 const orgId=req.org.id,userId=req.user.id,client=await pool.connect();let released=false;const release=()=>{if(!released){released=true;client.release();}};
 try{
  await client.query('BEGIN');
  const s=await client.query('SELECT id,name,status,started_at FROM sessions WHERE id=$1 AND organization_id=$2 LIMIT 1 FOR UPDATE',[session_id,orgId]);
  if(!s.rows.length){await client.query('ROLLBACK');return res.status(404).json({error:'Attendance session not found.'});}
  if(s.rows[0].status!=='active'){await client.query('ROLLBACK');return res.status(409).json({error:'This attendance session is already saved.'});}
  await client.query('UPDATE attendance_records SET confirmed=true,reviewed_by=$1,reviewed_at=NOW() WHERE organization_id=$2 AND session_id=$3 AND present=true AND confirmed=false',[userId,orgId,session_id]);
  const closed=await client.query('UPDATE sessions SET status=\'closed\',closed_by=$1,closed_at=NOW(),aria_processing_status=\'processing\',aria_processing_attempts=aria_processing_attempts+1,aria_processing_started_at=NOW(),aria_processing_completed_at=NULL,aria_processing_error=NULL WHERE id=$2 AND organization_id=$3 AND status=\'active\' RETURNING id,name,status,started_at,closed_at,aria_processing_attempts',[userId,session_id,orgId]);
  await client.query('COMMIT');release();
  try{
   const aria=await generateParticipationFromSession(session_id,orgId);
   await pool.query('UPDATE sessions SET aria_processing_status=\'completed\',aria_processing_error=NULL,aria_processing_completed_at=NOW() WHERE id=$1 AND organization_id=$2',[session_id,orgId]);
   return res.status(200).json({success:true,session:{...closed.rows[0],aria_processing_status:'completed'},aria});
  }catch(e){
   const internal=String(e.message||'Processing failed').slice(0,2000);console.error('[ATTENDANCE] ARIA processing failed after close:',e);
   try{await pool.query('UPDATE sessions SET aria_processing_status=\'failed\',aria_processing_error=$1 WHERE id=$2 AND organization_id=$3',[internal,session_id,orgId])}catch(updateError){console.error('[ATTENDANCE] Could not persist processing failure:',updateError)}
   return res.status(500).json({error:failMsg,session:{...closed.rows[0],aria_processing_status:'failed',aria_processing_error:internal},processing_failed:true});
  }
 }catch(err){
  try{await client.query('ROLLBACK')}catch{}console.error('[ATTENDANCE] Close session error:',err);return res.status(500).json({error:'Could not save attendance.'});
 }finally{release();}
});
// pages/api/attendance/close-session.js
// Finalize an active attendance session and complete downstream ARIA processing before responding.
import pool from '../../../lib/db';
import { withAdmin } from '../../../lib/apiHelpers';
import { generateParticipationFromSession } from '../../../lib/aria/participationGenerator';

export default withAdmin(async function handler(req,res){
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Method not allowed'});}
 const{session_id}=req.body||{};
 if(!session_id)return res.status(400).json({error:'session_id is required.'});
 const orgId=req.org.id,userId=req.user.id,client=await pool.connect();
 try{
  await client.query('BEGIN');
  const session=await client.query(`SELECT id,name,status,started_at FROM sessions WHERE id=$1 AND organization_id=$2 LIMIT 1 FOR UPDATE`,[session_id,orgId]);
  if(!session.rows.length){await client.query('ROLLBACK');return res.status(404).json({error:'Attendance session not found.'});}
  if(session.rows[0].status!=='active'){await client.query('ROLLBACK');return res.status(409).json({error:'This attendance session is already closed.'});}
  await client.query(`UPDATE attendance_records SET confirmed=true,reviewed_by=$1,reviewed_at=NOW() WHERE organization_id=$2 AND session_id=$3 AND present=true AND confirmed=false`,[userId,orgId,session_id]);
  const closed=await client.query(`UPDATE sessions SET status='closed',closed_by=$1,closed_at=NOW() WHERE id=$2 AND organization_id=$3 AND status='active' RETURNING id,name,status,started_at,closed_at`,[userId,session_id,orgId]);
  await client.query('COMMIT');
  // Do not use setImmediate here: Vercel may terminate the function after the response,
  // leaving attendance closed while participation/ARIA state is incomplete.
  let aria;
  try{aria=await generateParticipationFromSession(session_id,orgId);}catch(error){
   console.error('[ATTENDANCE] ARIA processing failed after close:',error);
   return res.status(500).json({error:'Attendance was closed, but ARIA could not finish processing it. Retry ARIA processing before relying on the care results.',session:closed.rows[0],processing_failed:true});
  }
  return res.status(200).json({success:true,session:closed.rows[0],aria});
 }catch(err){
  try{await client.query('ROLLBACK')}catch{}
  console.error('[ATTENDANCE] Close session error:',err);
  return res.status(500).json({error:'Could not close attendance.'});
 }finally{client.release();}
});

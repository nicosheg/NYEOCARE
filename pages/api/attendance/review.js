// pages/api/attendance/review.js
import pool from'../../../lib/db';
import{withAdmin}from'../../../lib/apiHelpers';
import{generateParticipationFromSession}from'../../../lib/aria/participationGenerator';

export default withAdmin(async function handler(req,res){
 const{session_id}=req.query;
 const orgId=req.org.id;
 const userId=req.user.id;

 if(!session_id)return res.status(400).json({error:'Missing session_id'});

 const session=await pool.query(
  `SELECT id,name,status FROM sessions WHERE id=$1 AND organization_id=$2 LIMIT 1`,
  [session_id,orgId]
 );

 if(!session.rows.length)return res.status(403).json({error:'Session not found.'});

 if(req.method==='GET'){
  try{
   const result=await pool.query(
    `SELECT ar.*,p.first_name,p.last_name,p.phone
     FROM attendance_records ar
     JOIN people p ON p.id=ar.people_id AND p.organization_id=ar.organization_id
     WHERE ar.session_id=$1
       AND ar.organization_id=$2
       AND ar.confirmed=false
       AND ar.present=true
     ORDER BY ar.marked_at ASC`,
    [session_id,orgId]
   );

   return res.status(200).json({records:result.rows});
  }catch(err){
   console.error('[ATTENDANCE] Review:',err);
   return res.status(500).json({error:'Could not load attendance review.'});
  }
 }

 if(req.method==='POST'){
  try{
   const confirmed=await pool.query(
    `UPDATE attendance_records
     SET confirmed=true,reviewed_by=$1,reviewed_at=NOW()
     WHERE session_id=$2
       AND organization_id=$3
       AND present=true
       AND confirmed=false
     RETURNING id`,
    [userId,session_id,orgId]
   );

   const pipeline=await generateParticipationFromSession(session_id,orgId);

   return res.status(200).json({
    success:true,
    confirmed:confirmed.rowCount,
    pipeline,
    message:'Attendance confirmed. Participation and relationship intelligence have been updated.'
   });
  }catch(err){
   console.error('[ATTENDANCE] Confirm:',err);
   return res.status(err.status||500).json({error:err.message||'Could not confirm attendance.'});
  }
 }

 res.setHeader('Allow','GET,POST');
 return res.status(405).json({error:'Method not allowed'});
});

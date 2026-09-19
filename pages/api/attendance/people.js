// pages/api/attendance/people.js
import pool from'../../../lib/db';import{withOrg}from'../../../lib/apiHelpers';
export default withOrg(async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const{session_id}=req.query;if(!session_id)return res.status(400).json({error:'session_id is required'});
 res.setHeader('Cache-Control','no-store');const orgId=req.org.id;
 try{
  const result=await pool.query("SELECT p.id,p.first_name,p.last_name,p.display_name,p.phone,COALESCE(ar.present,false) marked,COALESCE(NULLIF(u.name,''),NULLIF(CONCAT_WS(' ',au.raw_user_meta_data->>'first_name',au.raw_user_meta_data->>'last_name'),''),au.email) marked_by_name,c.id absence_context_id,c.reason_code absence_reason_code,c.reason_note,c.expected_return_date,c.expected_service_type,c.expected_return_known FROM sessions s JOIN people p ON p.organization_id=s.organization_id AND COALESCE(p.status,'active')='active' LEFT JOIN attendance_records ar ON ar.people_id=p.id AND ar.organization_id=$1 AND ar.session_id=$2 AND ar.present=true LEFT JOIN users u ON u.id=ar.marked_by LEFT JOIN auth.users au ON au.id=u.supabase_user_id LEFT JOIN aria_attendance_contexts c ON c.organization_id=$1 AND c.person_id=p.id AND c.session_id=$2 WHERE s.id=$2 AND s.organization_id=$1 AND(s.status='active' OR(s.status='closed' AND s.aria_processing_status IN('pending','processing','failed'))) ORDER BY COALESCE(NULLIF(p.display_name,''),CONCAT_WS(' ',p.first_name,p.last_name))",[orgId,session_id]);
  return res.status(200).json(result.rows);
 }catch(err){console.error('[ATTENDANCE] People error:',err);return res.status(500).json({error:'Could not load people.'});}
});
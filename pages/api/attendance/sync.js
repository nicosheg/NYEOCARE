// pages/api/attendance/sync.js
import pool from'../../../lib/db';
import{withOrg}from'../../../lib/apiHelpers';
import{enqueueAttendanceProcessing}from'../../../lib/aria/attendanceQueue';
const MAX_OPERATIONS=100;
export default withOrg(async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const{session_id,operations}=req.body||{};
 if(!session_id||!Array.isArray(operations)||!operations.length)return res.status(400).json({error:'session_id and operations are required.'});
 if(operations.length>MAX_OPERATIONS)return res.status(413).json({error:'Too many attendance changes.'});
 const deduped=new Map();
 for(const x of operations){if(!x?.people_id)continue;if(typeof x.present!=='boolean')return res.status(400).json({error:'Attendance changes need boolean present values.'});deduped.set(String(x.people_id),{people_id:String(x.people_id),present:x.present})}
 if(!deduped.size)return res.status(400).json({error:'No valid attendance changes supplied.'});
 const orgId=req.org.id,userId=req.user.id,client=await pool.connect();
 try{
  await client.query('BEGIN');
  const session=(await client.query("SELECT id,started_at,status,aria_processing_status,closed_by FROM sessions WHERE id=$1 AND organization_id=$2 LIMIT 1 FOR UPDATE",[session_id,orgId])).rows[0];
  if(!session){await client.query('ROLLBACK');return res.status(404).json({error:'Attendance session not found.'})}
  if(!['active','closed'].includes(session.status)){await client.query('ROLLBACK');return res.status(409).json({error:'This attendance session is no longer available.'})}
  const member=(await client.query("SELECT 1 FROM session_users WHERE session_id=$1 AND user_id=$2 LIMIT 1",[session_id,userId])).rows[0];
  if(!member){await client.query('ROLLBACK');return res.status(403).json({error:'Join this attendance session before syncing attendance.'})}
  const ids=[...deduped.keys()];
  const valid=(await client.query("SELECT id FROM people WHERE organization_id=$1 AND COALESCE(status,'active')='active' AND id=ANY($2::uuid[])",[orgId,ids])).rows.map(x=>String(x.id));
  const validSet=new Set(valid),ignored=ids.filter(id=>!validSet.has(id)),ops=[...deduped.values()].filter(x=>validSet.has(x.people_id)),payload=JSON.stringify(ops),date=new Date(session.started_at||Date.now()).toISOString().slice(0,10),confirmed=session.status==='closed';
  if(ops.length){
   await client.query("DELETE FROM attendance_records ar USING jsonb_to_recordset($3::jsonb) AS o(people_id uuid,present boolean) WHERE ar.organization_id=$1 AND ar.session_id=$2 AND ar.people_id=o.people_id AND o.present=false AND ar.confirmed=false",[orgId,session_id,payload]);
   await client.query("INSERT INTO attendance_records(people_id,attendance_date,present,session_id,marked_by,marked_at,status,confirmed,reviewed_by,reviewed_at,organization_id) SELECT o.people_id,$4::date,true,$2,$3,NOW(),'present',$5,CASE WHEN $5 THEN $6::uuid ELSE NULL END,CASE WHEN $5 THEN NOW() ELSE NULL END,$1 FROM jsonb_to_recordset($7::jsonb) AS o(people_id uuid,present boolean) WHERE o.present=true ON CONFLICT(organization_id,people_id,session_id) DO UPDATE SET present=true,marked_by=EXCLUDED.marked_by,marked_at=NOW(),status='present',confirmed=attendance_records.confirmed OR EXCLUDED.confirmed,reviewed_by=COALESCE(attendance_records.reviewed_by,EXCLUDED.reviewed_by),reviewed_at=COALESCE(attendance_records.reviewed_at,EXCLUDED.reviewed_at) WHERE attendance_records.confirmed=false OR EXCLUDED.confirmed=true",[orgId,session_id,userId,date,confirmed,session.closed_by,payload]);
  }
  let reprocessingQueued=false;
  if(session.status==='closed'&&ops.length){
   const total=(await client.query("SELECT COUNT(*)::int AS count FROM people WHERE organization_id=$1 AND COALESCE(status,'active')='active'",[orgId])).rows[0]?.count||0;
   const reset=(await client.query("UPDATE sessions SET aria_processing_status='pending',aria_processing_stage='persist',aria_processing_progress=0,aria_processing_processed=0,aria_processing_total=$2,aria_processing_attempts=0,aria_processing_started_at=NULL,aria_processing_completed_at=NULL,aria_processing_error=NULL,aria_processing_heartbeat_at=NULL WHERE id=$1 AND organization_id=$3 AND status='closed' RETURNING id",[session_id,Number(total)||0,orgId])).rows;
   if(reset.length){await enqueueAttendanceProcessing({organizationId:orgId,sessionId:session_id,actorId:userId,stage:'persist',db:client});reprocessingQueued=true}
  }
  await client.query('COMMIT');
  return res.status(200).json({success:true,applied_people_ids:valid,ignored_people_ids:ignored,reprocessing_queued:reprocessingQueued});
 }catch(err){try{await client.query('ROLLBACK')}catch{}console.error('[ATTENDANCE] Offline sync error:',err);return res.status(503).json({error:'Attendance sync is temporarily unavailable.'})}
 finally{client.release()}
});
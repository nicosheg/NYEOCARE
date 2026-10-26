// pages/api/attendance/mark.js
import pool from'../../../lib/db';
import{withOrg}from'../../../lib/apiHelpers';
import{eventAttendanceDate}from'../../../lib/attendance/eventDate';
import{isOrganizationOperator}from'../../../lib/attendance/access';

export default withOrg(async function handler(req,res){
if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
if(!isOrganizationOperator(req.user?.role))return res.status(403).json({error:'Only authorized organization operators can mark attendance.'});
const{session_id,people_id,present=true,historical=false}=req.body||{};
if(!session_id||!people_id)return res.status(400).json({error:'session_id and people_id are required.'});
if(typeof present!=='boolean')return res.status(400).json({error:'present must be boolean.'});
if(historical&&!['owner','admin'].includes(req.user.role))return res.status(403).json({error:'Admin permissions required for historical corrections.'});
const orgId=req.org.id,userId=req.user.id,client=await pool.connect();
try{
await client.query('BEGIN');
// Shared locking keeps the event status stable while allowing workers to mark different people concurrently.
const session=await client.query(`SELECT s.id,s.name,s.status,s.started_at,COALESCE(NULLIF(o.settings->>'timezone',''),'Africa/Lagos') AS organization_timezone FROM sessions s JOIN organizations o ON o.id=s.organization_id WHERE s.id=$1 AND s.organization_id=$2 LIMIT 1 FOR SHARE OF s`,[session_id,orgId]);
if(!session.rows.length){await client.query('ROLLBACK');return res.status(404).json({error:'Attendance session not found.'})}
const person=await client.query(`SELECT id,first_name,last_name FROM people WHERE id=$1 AND organization_id=$2 AND COALESCE(status,'active')='active' LIMIT 1`,[people_id,orgId]);
if(!person.rows.length){await client.query('ROLLBACK');return res.status(404).json({error:'Person not found in your organization.'})}
const existing=await client.query(`SELECT id,confirmed,present FROM attendance_records WHERE organization_id=$1 AND people_id=$2 AND session_id=$3 LIMIT 1`,[orgId,people_id,session_id]);

if(!historical){
if(session.rows[0].status!=='active'){await client.query('ROLLBACK');return res.status(403).json({error:'This attendance session is no longer active.'})}
const membership=await client.query(`SELECT 1 FROM session_users WHERE session_id=$1 AND user_id=$2 LIMIT 1`,[session_id,userId]);
if(!membership.rows.length){await client.query('ROLLBACK');return res.status(403).json({error:'Join this attendance session before marking attendance.'})}
if(existing.rows[0]?.confirmed){await client.query('COMMIT');return res.status(200).json({success:true,present:Boolean(existing.rows[0].present),confirmed:true,changed:false,attendance_id:existing.rows[0].id,person:person.rows[0]})}
if(!present){
const current=existing.rows[0];
if(current&&!current.confirmed&&current.present===true){
await client.query(`UPDATE attendance_records SET present=false,status='not_present',marked_by=$1,marked_at=NOW() WHERE id=$2 AND organization_id=$3 AND confirmed=false`,[userId,current.id,orgId]);
await client.query('COMMIT');
return res.status(200).json({success:true,present:false,confirmed:false,changed:true,attendance_id:current.id,person:person.rows[0]});
}
await client.query('COMMIT');
return res.status(200).json({success:true,present:false,confirmed:Boolean(current?.confirmed),changed:false,attendance_id:current?.id||null,person:person.rows[0]});
}
const result=await client.query(`INSERT INTO attendance_records(people_id,attendance_date,present,session_id,marked_by,marked_at,status,confirmed,organization_id) VALUES($1,$2,true,$3,$4,NOW(),'present',false,$5) ON CONFLICT(organization_id,people_id,session_id) WHERE session_id IS NOT NULL DO UPDATE SET present=true,marked_by=EXCLUDED.marked_by,marked_at=NOW(),status='present' WHERE attendance_records.confirmed=false RETURNING id,marked_at`,[people_id,eventAttendanceDate(session.rows[0].started_at,session.rows[0].organization_timezone),session_id,userId,orgId]);
await client.query('COMMIT');
if(!result.rows.length)return res.status(200).json({success:true,present:true,confirmed:true,changed:false,attendance_id:existing.rows[0]?.id,person:person.rows[0]});
return res.status(200).json({success:true,present:true,confirmed:false,changed:true,attendance_id:result.rows[0].id,marked_at:result.rows[0].marked_at,person:person.rows[0]});
}

const row=existing.rows[0];
if(!row){
if(!present){await client.query('COMMIT');return res.status(200).json({success:true,present:false,confirmed:true,changed:false,person:person.rows[0]})}
const inserted=await client.query(`INSERT INTO attendance_records(people_id,attendance_date,present,session_id,marked_by,marked_at,status,confirmed,reviewed_by,reviewed_at,organization_id) VALUES($1,$2,true,$3,$4,NOW(),'present',true,$4,NOW(),$5) RETURNING id,marked_at`,[people_id,eventAttendanceDate(session.rows[0].started_at,session.rows[0].organization_timezone),session_id,userId,orgId]);
await client.query('COMMIT');
return res.status(200).json({success:true,present:true,confirmed:true,changed:true,attendance_id:inserted.rows[0].id,marked_at:inserted.rows[0].marked_at,person:person.rows[0]});
}
if(row.confirmed&&row.present===present){await client.query('COMMIT');return res.status(200).json({success:true,present,confirmed:true,changed:false,attendance_id:row.id,person:person.rows[0]})}
const updated=await client.query(`UPDATE attendance_records SET present=$1,status=$2,confirmed=true,marked_by=$3,marked_at=NOW(),reviewed_by=$3,reviewed_at=NOW() WHERE id=$4 RETURNING id,marked_at`,[present,present?'present':'not_present',userId,row.id]);
await client.query('COMMIT');
return res.status(200).json({success:true,present,confirmed:true,changed:true,attendance_id:updated.rows[0].id,marked_at:updated.rows[0].marked_at,person:person.rows[0]});
}catch(err){
try{await client.query('ROLLBACK')}catch{}
console.error('[ATTENDANCE] Mark error:',err);
return res.status(500).json({error:'Could not update attendance.'});
}finally{client.release()}
});

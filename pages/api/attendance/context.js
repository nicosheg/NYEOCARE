// pages/api/attendance/context.js
import pool from'../../../lib/db';import{withOrg}from'../../../lib/apiHelpers';
const REASONS=new Set(['health','travel','work_school','family','personal','transport','other','unknown']);
function weekday(v){const n=new Date(v).getUTCDay();return n===0?7:n}
function nextDate(start,service){const base=new Date(start),baseDay=weekday(start),m=String(service||'').match(/^weekday:(\d)$/);const target=m?Number(m[1]):baseDay,delta=((target-baseDay+7)%7)||7;base.setUTCDate(base.getUTCDate()+delta);return base.toISOString().slice(0,10)}
export default withOrg(async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const{session_id,people_id,reason_code='unknown',reason_note='',return_option='unknown',expected_return_date=null}=req.body||{};
 if(!session_id||!people_id)return res.status(400).json({error:'session_id and people_id are required.'});
 if(!REASONS.has(String(reason_code)))return res.status(400).json({error:'Invalid absence reason.'});
 if(!['unknown','next_gathering','specific_date'].includes(String(return_option)))return res.status(400).json({error:'Invalid return option.'});
 const orgId=req.org.id;
 try{
  const s=await pool.query('SELECT id,started_at,service_type,status,aria_processing_status FROM sessions WHERE id=$1 AND organization_id=$2 LIMIT 1',[session_id,orgId]);
  if(!s.rows.length)return res.status(404).json({error:'Attendance session not found.'});
  if(s.rows[0].status!=='active')return res.status(409).json({error:'Attendance is already saved; add context from the person story instead.'});
  const p=await pool.query('SELECT id FROM people WHERE id=$1 AND organization_id=$2 AND status=\'active\' LIMIT 1',[people_id,orgId]);
  if(!p.rows.length)return res.status(404).json({error:'Person not found.'});
  const a=await pool.query('SELECT 1 FROM attendance_records WHERE organization_id=$1 AND session_id=$2 AND people_id=$3 AND present=true LIMIT 1',[orgId,session_id,people_id]);
  if(a.rows.length)return res.status(409).json({error:'This person is already marked present.'});
  let returnDate=null,known=false;
  if(return_option==='specific_date'){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(expected_return_date||'')))return res.status(400).json({error:'Choose a return date.'});returnDate=expected_return_date;known=true}
  if(return_option==='next_gathering'){returnDate=nextDate(s.rows[0].started_at,s.rows[0].service_type);known=true}
  const result=await pool.query('INSERT INTO aria_attendance_contexts(organization_id,person_id,session_id,reason_code,reason_note,expected_return_date,expected_service_type,expected_return_known,source,created_by,updated_at,resolved_at,resolved_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,\'human\',$9,NOW(),NULL,NULL) ON CONFLICT(organization_id,session_id,person_id) DO UPDATE SET reason_code=EXCLUDED.reason_code,reason_note=EXCLUDED.reason_note,expected_return_date=EXCLUDED.expected_return_date,expected_service_type=EXCLUDED.expected_service_type,expected_return_known=EXCLUDED.expected_return_known,source=\'human\',created_by=EXCLUDED.created_by,updated_at=NOW(),resolved_at=NULL,resolved_by=NULL RETURNING id,reason_code,reason_note,expected_return_date,expected_service_type,expected_return_known',[orgId,people_id,session_id,String(reason_code),String(reason_note||'').trim().slice(0,1000)||null,returnDate,s.rows[0].service_type||null,known,req.user.id]);
  return res.status(200).json({success:true,context:result.rows[0]});
 }catch(e){console.error('[ATTENDANCE] Context error:',e);return res.status(500).json({error:'Could not save this attendance context.'});}
});
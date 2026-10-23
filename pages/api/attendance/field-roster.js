// pages/api/attendance/field-roster.js
import pool from'../../../lib/db';
import{withOrg}from'../../../lib/apiHelpers';
const MAX_LIMIT=5000;
function decodeCursor(value){if(!value)return null;try{const x=JSON.parse(Buffer.from(String(value),'base64url').toString('utf8'));return x&&typeof x.name==='string'&&typeof x.id==='string'?x:null}catch{return null}}
function encodeCursor(row){return Buffer.from(JSON.stringify({name:String(row.sort_name||''),id:String(row.id)})).toString('base64url')}
export default withOrg(async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const{session_id,cursor}=req.query||{};if(!session_id)return res.status(400).json({error:'session_id is required'});
 const orgId=req.org.id,limit=Math.min(Math.max(Number(req.query.limit)||MAX_LIMIT,1),MAX_LIMIT),decoded=decodeCursor(cursor);res.setHeader('Cache-Control','private,no-store,max-age=0');
 try{
  const session=(await pool.query("SELECT id,status FROM sessions WHERE id=$1 AND organization_id=$2 AND(status='active' OR(status='closed' AND aria_processing_status IN('pending','processing'))) LIMIT 1",[session_id,orgId])).rows[0];
  if(!session)return res.status(404).json({error:'Attendance session is not available.'});
  const nameExpr="coalesce(nullif(p.display_name,''),trim(coalesce(p.first_name,'')||' '||coalesce(p.last_name,'')))",params=[orgId,session_id];let cursorSql='';
  if(decoded){params.push(decoded.name,decoded.id);cursorSql='AND ('+nameExpr+',p.id)>($3::text,$4::uuid)'}
  params.push(limit+1);const li=params.length;
  const firstVisitExpr="CASE WHEN lower(BTRIM(COALESCE(p.type,'')))='visitor' AND NOT EXISTS(SELECT 1 FROM participation_records previous WHERE previous.organization_id=p.organization_id AND previous.person_id=p.id AND previous.participation_type='attendance' AND previous.session_id<>s.id AND previous.occurred_at<s.started_at) AND NOT EXISTS(SELECT 1 FROM aria_care_contexts cc WHERE cc.organization_id=p.organization_id AND cc.person_id=p.id AND cc.kind='other' AND cc.metadata->>'do_not_contact'='true' AND cc.starts_on<=s.started_at::date AND (cc.ends_on IS NULL OR cc.ends_on>=s.started_at::date)) THEN true ELSE false END";
  const firstVisitRecordedExpr="EXISTS(SELECT 1 FROM care_feedback wf WHERE wf.organization_id=p.organization_id AND wf.person_id=p.id AND wf.context->>'source'='first_visit_welcome_during_attendance' AND wf.context->>'session_id'=s.id::text AND wf.context->>'outcome'='met_in_person' AND wf.verification_status='reported')";
  const rows=(await pool.query("SELECT p.id,p.first_name,p.last_name,p.display_name,p.phone,p.type,"+firstVisitExpr+" AS first_visit_candidate,"+firstVisitRecordedExpr+" AS first_visit_welcome_recorded,COALESCE(ar.present,false) marked,"+nameExpr+" AS sort_name FROM people p CROSS JOIN sessions s LEFT JOIN attendance_records ar ON ar.people_id=p.id AND ar.organization_id=$1 AND ar.session_id=$2 AND ar.present=true WHERE p.organization_id=$1 AND s.organization_id=$1 AND s.id=$2 AND COALESCE(p.status,'active')='active' "+cursorSql+" ORDER BY "+nameExpr+" ASC,p.id ASC LIMIT $"+li,params)).rows;
  const more=rows.length>limit,people=more?rows.slice(0,limit):rows,last=people[people.length-1];
  const totals=await Promise.all([pool.query("SELECT COUNT(*)::int AS count FROM people WHERE organization_id=$1 AND COALESCE(status,'active')='active'",[orgId]),pool.query("SELECT COUNT(*)::int AS count FROM attendance_records WHERE organization_id=$1 AND session_id=$2 AND present=true",[orgId,session_id])]);
  return res.status(200).json({success:true,session_id:String(session.id),session_status:String(session.status),people:people.map(({sort_name,...person})=>person),total:Number(totals[0].rows[0]?.count)||0,present_count:Number(totals[1].rows[0]?.count)||0,has_more:more,next_cursor:more&&last?encodeCursor(last):null});
 }catch(err){console.error('[ATTENDANCE] Field roster error:',err);return res.status(500).json({error:'Could not prepare the field roster.'})}
});
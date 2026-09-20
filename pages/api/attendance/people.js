// pages/api/attendance/people.js
import pool from '../../../lib/db';
import {withOrg} from '../../../lib/apiHelpers';

function decodeCursor(value){
 if(!value)return null;
 try{
  const raw=Buffer.from(String(value),'base64url').toString('utf8');
  const parsed=JSON.parse(raw);
  if(!parsed||typeof parsed.name!=='string'||typeof parsed.id!=='string')return null;
  return parsed;
 }catch{return null;}
}

function encodeCursor(row){
 return Buffer.from(JSON.stringify({
  name:String(row.sort_name||''),
  id:String(row.id)
 })).toString('base64url');
}

export default withOrg(async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const{session_id,q,cursor}=req.query||{};
 if(!session_id)return res.status(400).json({error:'session_id is required'});

 const orgId=req.org.id;
 const limit=Math.min(Math.max(Number(req.query.limit)||80,1),100);
 const search=typeof q==='string'?q.trim():'';
 const decoded=decodeCursor(cursor);
 res.setHeader('Cache-Control','no-store');

 try{
  const params=[orgId,session_id];
  const clauses=[
   "s.id=$2",
   "s.organization_id=$1",
   "(s.status='active' OR (s.status='closed' AND s.aria_processing_status IN('pending','processing','failed')))"
  ];

  const nameExpr="coalesce(nullif(p.display_name,''),coalesce(p.first_name,'')||' '||coalesce(p.last_name,''))";
  if(search){
   params.push(search);
   const i=params.length;
   clauses.push(`(
     ${nameExpr} ILIKE '%'||$${i}||'%'
     OR COALESCE(p.phone,'') ILIKE '%'||$${i}||'%'
   )`);
  }
  if(decoded){
   params.push(decoded.name,decoded.id);
   const ni=params.length-1,ii=params.length;
   clauses.push(`(${nameExpr},p.id) > ($${ni}::text,$${ii}::uuid)`);
  }
  params.push(limit+1);
  const li=params.length;

  const result=await pool.query(
   `SELECT p.id,p.first_name,p.last_name,p.display_name,p.phone,
      COALESCE(ar.present,false) marked,
      COALESCE(NULLIF(u.name,''),NULLIF(CONCAT_WS(' ',au.raw_user_meta_data->>'first_name',au.raw_user_meta_data->>'last_name'),''),au.email) marked_by_name,
      c.id absence_context_id,c.reason_code absence_reason_code,c.reason_note,c.expected_return_date,
      c.expected_service_type,c.expected_return_known,
      ${nameExpr} AS sort_name,
      COUNT(*) OVER()::int AS total_people,
      (SELECT COUNT(*)::int FROM people pc WHERE pc.organization_id=$1 AND COALESCE(pc.status,'active')='active') AS organization_total_people,
      (SELECT COUNT(*)::int FROM attendance_records ap
       WHERE ap.organization_id=$1 AND ap.session_id=$2 AND ap.present=true) AS present_count
    FROM sessions s
    JOIN people p ON p.organization_id=s.organization_id AND COALESCE(p.status,'active')='active'
    LEFT JOIN attendance_records ar ON ar.people_id=p.id AND ar.organization_id=$1 AND ar.session_id=$2 AND ar.present=true
    LEFT JOIN users u ON u.id=ar.marked_by
    LEFT JOIN auth.users au ON au.id=u.supabase_user_id
    LEFT JOIN aria_attendance_contexts c ON c.organization_id=$1 AND c.person_id=p.id AND c.session_id=$2
    WHERE ${clauses.join(' AND ')}
    ORDER BY ${nameExpr} ASC,p.id ASC
    LIMIT $${li}`,
   params
  );

  const hasMore=result.rows.length>limit;
  const rows=hasMore?result.rows.slice(0,limit):result.rows;
  const last=rows[rows.length-1];

  return res.status(200).json({
   people:rows,
   total:rows.length?(Number(rows[0].total_people)||0):0,
   present_count:rows.length?(Number(rows[0].present_count)||0):0,
   organization_total:rows.length?(Number(rows[0].organization_total_people)||0):0,
   limit,
   has_more:hasMore,
   next_cursor:hasMore&&last?encodeCursor(last):null,
   query:search
  });
 }catch(err){
  console.error('[ATTENDANCE] People error:',err);
  return res.status(500).json({error:'Could not load people.'});
 }
});

// lib/attendance/history.js
import pool from '../db';

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GROUPS=[{key:'men',label:'Men'},{key:'women',label:'Women'},{key:'youth',label:'Youth'},{key:'unassigned',label:'Unassigned'}];
const number=value=>Number(value)||0;
const normalizeGroup=value=>{const key=String(value||'').trim().toLowerCase();return GROUPS.some(group=>group.key===key)?key:'unassigned';};
const encodeCursor=value=>Buffer.from(JSON.stringify(value),'utf8').toString('base64url');
function decodeCursor(value){
 if(!value)return null;
 try{const decoded=JSON.parse(Buffer.from(String(value),'base64url').toString('utf8'));const at=String(decoded?.at||''),id=String(decoded?.id||'');if(!Number.isFinite(Date.parse(at))||!UUID_RE.test(id))throw new Error('Invalid cursor.');return{at,id};}
 catch{throw Object.assign(new Error('The attendance history page cursor is invalid. Refresh the history and try again.'),{status:400,code:'ATTENDANCE_HISTORY_CURSOR_INVALID'});}
}
function normalizeSummary(row,groupRows=[]){
 const totals={recorded_count:number(row.recorded_count),present_count:number(row.present_count),absent_count:number(row.absent_count)};
 const groups=new Map(GROUPS.map(group=>[group.key,0]));for(const group of groupRows)groups.set(normalizeGroup(group.group_key),number(group.count));
 return{session:{id:row.id,name:row.name,service_type:row.service_type,status:row.status,started_at:row.started_at,closed_at:row.closed_at,organization_timezone:row.organization_timezone||'Africa/Lagos',register_completeness:row.register_completeness||'unconfirmed',register_source:row.register_source||null,register_reviewed_at:row.register_reviewed_at||null,aria_processing_status:row.aria_processing_status||'idle',aria_processing_stage:row.aria_processing_stage||'idle',aria_processing_progress:number(row.aria_processing_progress),aria_processing_processed:number(row.aria_processing_processed),aria_processing_total:number(row.aria_processing_total)},totals,group_breakdown:GROUPS.map(group=>({key:group.key,label:group.label,count:groups.get(group.key)||0})),group_breakdown_basis:'current_people_assignment'};
}
export async function getAttendanceSessionSummary(db=pool,organizationId,sessionId){
 if(!organizationId||!sessionId)throw Object.assign(new Error('Organization and session are required.'),{status:400});
 const result=await db.query(
   `SELECT s.id,s.name,s.service_type,s.status,s.started_at,s.closed_at,s.register_completeness,s.register_source,s.register_reviewed_at,
           s.aria_processing_status,s.aria_processing_stage,s.aria_processing_progress,s.aria_processing_processed,s.aria_processing_total,
           COALESCE(MAX(NULLIF(o.settings->>'timezone','')),'Africa/Lagos') AS organization_timezone,
           COUNT(ar.id)::int AS recorded_count,
           COUNT(ar.id) FILTER(WHERE ar.present=true)::int AS present_count,
           COUNT(ar.id) FILTER(WHERE ar.present=false)::int AS absent_count
    FROM sessions s JOIN organizations o ON o.id=s.organization_id
    LEFT JOIN attendance_records ar ON ar.organization_id=s.organization_id AND ar.session_id=s.id
    WHERE s.id=$1 AND s.organization_id=$2 GROUP BY s.id LIMIT 1`,
   [sessionId,organizationId]
 );
 const row=result.rows[0];if(!row)throw Object.assign(new Error('Attendance session was not found in this organization.'),{status:404,code:'ATTENDANCE_HISTORY_NOT_FOUND'});
 const groups=(await db.query(
   `SELECT COALESCE(NULLIF(lower(BTRIM(p.attendance_group)),''),'unassigned') AS group_key,COUNT(*)::int AS count
    FROM attendance_records ar JOIN people p ON p.id=ar.people_id AND p.organization_id=ar.organization_id
    WHERE ar.organization_id=$1 AND ar.session_id=$2 AND ar.present=true GROUP BY 1`,
   [organizationId,sessionId]
 )).rows;
 return normalizeSummary(row,groups);
}
export async function getAttendanceHistory({db=pool,organizationId,sessionId=null,cursor=null,limit=20}={}){
 if(!organizationId)throw Object.assign(new Error('Organization is required.'),{status:400});
 const pageSize=Math.min(Math.max(Number.parseInt(limit,10)||20,1),100);
 if(sessionId){
  if(!UUID_RE.test(String(sessionId)))throw Object.assign(new Error('A valid attendance session is required.'),{status:400});
  const summary=await getAttendanceSessionSummary(db,organizationId,String(sessionId));
  if(summary.session.status!=='closed')throw Object.assign(new Error('Only saved attendance sessions appear in history.'),{status:409,code:'ATTENDANCE_HISTORY_SESSION_NOT_CLOSED'});
  const page=decodeCursor(cursor);
  const rows=(await db.query(
    `SELECT ar.id,ar.people_id,ar.attendance_date,ar.present,ar.status,ar.confirmed,ar.marked_at,ar.created_at,ar.source,
            COALESCE(NULLIF(BTRIM(p.display_name),''),NULLIF(BTRIM(CONCAT_WS(' ',p.first_name,p.last_name)),''),'Person') AS person_name,
            COALESCE(NULLIF(lower(BTRIM(p.attendance_group)),''),'unassigned') AS attendance_group
     FROM attendance_records ar JOIN people p ON p.id=ar.people_id AND p.organization_id=ar.organization_id
     WHERE ar.organization_id=$1 AND ar.session_id=$2
       AND ($3::timestamptz IS NULL OR (COALESCE(ar.marked_at,ar.created_at),ar.id)<($3::timestamptz,$4::uuid))
     ORDER BY COALESCE(ar.marked_at,ar.created_at) DESC,ar.id DESC LIMIT $5`,
    [organizationId,String(sessionId),page?.at||null,page?.id||null,pageSize+1]
  )).rows;
  const hasMore=rows.length>pageSize;
  const records=rows.slice(0,pageSize).map(row=>({id:row.id,person_id:row.people_id,person_name:row.person_name,attendance_date:row.attendance_date,present:Boolean(row.present),status:row.status,confirmed:Boolean(row.confirmed),marked_at:row.marked_at,created_at:row.created_at,source:row.source,attendance_group:normalizeGroup(row.attendance_group)}));
  const last=records[records.length-1];
  return{session:summary.session,summary,records,has_more:hasMore,next_cursor:hasMore&&last?encodeCursor({at:last.marked_at||last.created_at,id:last.id}):null};
 }
 const page=decodeCursor(cursor);
 const rows=(await db.query(
   `SELECT s.id,s.name,s.service_type,s.status,s.started_at,s.closed_at,s.register_completeness,s.aria_processing_status,s.aria_processing_stage,s.aria_processing_progress,
           COALESCE(NULLIF(o.settings->>'timezone',''),'Africa/Lagos') AS organization_timezone,
           COALESCE(stats.recorded_count,0)::int AS recorded_count,COALESCE(stats.present_count,0)::int AS present_count,
           COALESCE(stats.absent_count,0)::int AS absent_count
    FROM sessions s JOIN organizations o ON o.id=s.organization_id
    LEFT JOIN LATERAL(
      SELECT COUNT(*)::int AS recorded_count,
             COUNT(*) FILTER(WHERE ar.present=true)::int AS present_count,
             COUNT(*) FILTER(WHERE ar.present=false)::int AS absent_count
      FROM attendance_records ar WHERE ar.organization_id=s.organization_id AND ar.session_id=s.id
    ) stats ON true
    WHERE s.organization_id=$1 AND s.status='closed'
      AND ($2::timestamptz IS NULL OR (s.started_at,s.id)<($2::timestamptz,$3::uuid))
    ORDER BY s.started_at DESC,s.id DESC LIMIT $4`,
   [organizationId,page?.at||null,page?.id||null,pageSize+1]
 )).rows;
 const hasMore=rows.length>pageSize;
 const sessions=rows.slice(0,pageSize).map(row=>({id:row.id,name:row.name,service_type:row.service_type,status:row.status,started_at:row.started_at,closed_at:row.closed_at,organization_timezone:row.organization_timezone||'Africa/Lagos',register_completeness:row.register_completeness||'unconfirmed',aria_processing_status:row.aria_processing_status||'idle',aria_processing_stage:row.aria_processing_stage||'idle',aria_processing_progress:number(row.aria_processing_progress),recorded_count:number(row.recorded_count),present_count:number(row.present_count),absent_count:number(row.absent_count)}));
 const last=sessions[sessions.length-1];
 return{sessions,has_more:hasMore,next_cursor:hasMore&&last?encodeCursor({at:last.started_at,id:last.id}):null};
}

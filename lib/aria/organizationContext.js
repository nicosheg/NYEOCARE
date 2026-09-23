// lib/aria/organizationContext.js
import pool from '../db';
import {getMemory} from './organizationMemory';

const clean=(v,max=300)=>String(v??'').trim().slice(0,max);
const nameOf=r=>String(r?.name||'').trim()||'Unnamed operator';
function visibility(viewer,target,viewerId){if(viewerId&&String(viewerId)===String(target.id))return'full';if(viewer==='owner')return'full';if(viewer==='admin')return target.role==='user'?'full':'basic';return target.role==='user'?'full':'basic';}
function projectOperator(row,level){if(level==='full')return{name:nameOf(row),email:row.email||null,role:row.role,active:Boolean(row.active),joined_at:row.created_at,last_login_at:row.last_login_at||null,activity_count:Number(row.activity_count)||0,last_activity_at:row.last_activity_at||null,activity_breakdown:row.activity_breakdown||{},recent_activity:row.recent_activity||[]};return{name:nameOf(row),role:row.role,active:Boolean(row.active),joined_at:row.created_at};}
async function getViewer(organizationId,userId){const r=await pool.query("SELECT id,name,email,role,active,created_at,last_login_at FROM users WHERE id=$1 AND organization_id=$2 AND active=true LIMIT 1",[userId,organizationId]);return r.rows[0]||null;}
async function getOperatorActivity(organizationId){
 const aSql=[
  "SELECT e.actor_id::text AS actor_key,e.occurred_at AS at,'aria_event' AS kind,LEFT(COALESCE(e.type,'ARIA event'),120) AS detail FROM aria_events e WHERE e.organization_id=$1 AND e.actor_id IS NOT NULL",
  "SELECT s.started_by::text,s.started_at,'session_started',LEFT(COALESCE(s.name,s.service_type,'attendance session'),120) FROM sessions s WHERE s.organization_id=$1 AND s.started_by IS NOT NULL",
  "SELECT s.closed_by::text,s.closed_at,'session_closed',LEFT(COALESCE(s.name,s.service_type,'attendance session'),120) FROM sessions s WHERE s.organization_id=$1 AND s.closed_by IS NOT NULL AND s.closed_at IS NOT NULL",
  "SELECT ar.marked_by::text,ar.marked_at,'attendance_marked',LEFT(COALESCE(p.display_name,trim(concat_ws(' ',p.first_name,p.last_name)),'person attendance'),120) FROM attendance_records ar LEFT JOIN people p ON p.id=ar.people_id AND p.organization_id=ar.organization_id WHERE ar.organization_id=$1 AND ar.marked_by IS NOT NULL",
  "SELECT ar.reviewed_by::text,ar.reviewed_at,'attendance_reviewed',LEFT(COALESCE(p.display_name,trim(concat_ws(' ',p.first_name,p.last_name)),'person attendance'),120) FROM attendance_records ar LEFT JOIN people p ON p.id=ar.people_id AND p.organization_id=ar.organization_id WHERE ar.organization_id=$1 AND ar.reviewed_by IS NOT NULL AND ar.reviewed_at IS NOT NULL",
  "SELECT sj.actor_id,sj.created_at,'scan_started',LEFT(COALESCE(sj.program_name,'scan'),120) FROM scan_jobs sj WHERE sj.organization_id=$1 AND sj.actor_id IS NOT NULL",
  "SELECT p.created_by::text,p.created_at,'person_created',LEFT(COALESCE(p.display_name,trim(concat_ws(' ',p.first_name,p.last_name)),'person'),120) FROM people p WHERE p.organization_id=$1 AND p.created_by IS NOT NULL",
  "SELECT cf.actor_id::text,cf.observed_at,'care_feedback',LEFT(COALESCE(cf.feedback_type,'care feedback'),120) FROM care_feedback cf WHERE cf.organization_id=$1 AND cf.actor_id IS NOT NULL",
  "SELECT pt.created_by::text,pt.created_at,'task_created',LEFT(COALESCE(pt.title,'task'),120) FROM person_tasks pt WHERE pt.organization_id=$1 AND pt.created_by IS NOT NULL",
  "SELECT a.approved_by::text,a.approved_at,'action_approved',LEFT(COALESCE(a.type,'action'),120) FROM aria_actions a WHERE a.organization_id=$1 AND a.approved_by IS NOT NULL AND a.approved_at IS NOT NULL",
  "SELECT i.invited_by::text,i.created_at,'invitation_sent',LEFT(COALESCE(i.role,'user'),120) FROM organization_invites i WHERE i.organization_id=$1 AND i.invited_by IS NOT NULL",
  "SELECT i.accepted_by::text,i.used_at,'invitation_accepted',LEFT(COALESCE(i.role,'user'),120) FROM organization_invites i WHERE i.organization_id=$1 AND i.accepted_by IS NOT NULL AND i.used_at IS NOT NULL",
  "SELECT i.created_by::text,i.created_at,'legacy_invitation_sent',LEFT(COALESCE(i.intended_role,'user'),120) FROM organization_invitations i WHERE i.organization_id=$1 AND i.created_by IS NOT NULL",
  "SELECT i.accepted_by::text,i.accepted_at,'legacy_invitation_accepted',LEFT(COALESCE(i.intended_role,'user'),120) FROM organization_invitations i WHERE i.organization_id=$1 AND i.accepted_by IS NOT NULL AND i.accepted_at IS NOT NULL"
 ].join(' UNION ALL ');
 const [summary,recent]=await Promise.all([
  pool.query("SELECT actor_key,kind,COUNT(*)::int AS count,MAX(at) AS last_at FROM ("+aSql+") a JOIN users u ON u.id::text=a.actor_key AND u.organization_id=$1 AND u.active=true GROUP BY actor_key,kind",[organizationId]),
  pool.query("WITH ranked AS(SELECT a.actor_key,a.at,a.kind,a.detail,ROW_NUMBER() OVER(PARTITION BY a.actor_key ORDER BY a.at DESC NULLS LAST) AS rn FROM ("+aSql+") a JOIN users u ON u.id::text=a.actor_key AND u.organization_id=$1 AND u.active=true) SELECT actor_key,at,kind,detail FROM ranked WHERE rn<=8 ORDER BY actor_key,at DESC NULLS LAST",[organizationId])
 ]);
 const map=new Map();
 for(const r of summary.rows){const key=String(r.actor_key);const item=map.get(key)||{activity_count:0,last_activity_at:null,activity_breakdown:{},recent_activity:[]};item.activity_count+=Number(r.count)||0;item.activity_breakdown[r.kind]=Number(r.count)||0;if(!item.last_activity_at||new Date(r.last_at)>new Date(item.last_activity_at))item.last_activity_at=r.last_at;map.set(key,item)}
 for(const r of recent.rows){const key=String(r.actor_key);const item=map.get(key)||{activity_count:0,last_activity_at:null,activity_breakdown:{},recent_activity:[]};if(item.recent_activity.length<8)item.recent_activity.push({at:r.at,kind:r.kind,detail:r.detail});map.set(key,item)}
 return map;
}
async function getInvitations(organizationId,viewerRole){
 const includeEmail=viewerRole==='owner'||viewerRole==='admin';
 const [current,legacy]=await Promise.all([
  pool.query("SELECT i.role,i.email,i.created_at,i.expires_at,i.used_at,CASE WHEN i.used_at IS NOT NULL THEN 'accepted' WHEN i.expires_at<=NOW() THEN 'expired' ELSE 'pending' END AS status,COALESCE(u.name,NULLIF(i.email,''),'Unnamed invitee') AS invitee_name,u.email AS accepted_email,inviter.name AS inviter_name,inviter.role AS inviter_role FROM organization_invites i LEFT JOIN users u ON u.id=i.accepted_by AND u.organization_id=i.organization_id LEFT JOIN users inviter ON inviter.id=i.invited_by AND inviter.organization_id=i.organization_id WHERE i.organization_id=$1 AND i.created_at>=NOW()-INTERVAL '90 days' ORDER BY i.created_at DESC LIMIT 30",[organizationId]),
  pool.query("SELECT i.intended_role AS role,i.invited_email AS email,i.created_at,i.expires_at,i.accepted_at,CASE WHEN i.revoked_at IS NOT NULL THEN 'revoked' WHEN i.accepted_at IS NOT NULL THEN 'accepted' WHEN i.expires_at<=NOW() THEN 'expired' ELSE 'pending' END AS status,COALESCE(i.invited_name,NULLIF(i.invited_email,''),'Unnamed invitee') AS invitee_name,accepted.email AS accepted_email,inviter.name AS inviter_name,inviter.role AS inviter_role FROM organization_invitations i LEFT JOIN users accepted ON accepted.id=i.accepted_by AND accepted.organization_id=i.organization_id LEFT JOIN users inviter ON inviter.id=i.created_by AND inviter.organization_id=i.organization_id WHERE i.organization_id=$1 AND i.created_at>=NOW()-INTERVAL '90 days' ORDER BY i.created_at DESC LIMIT 30",[organizationId])
 ]);
 const mapRow=(r,source)=>{const out={source,invitee:r.invitee_name||'Unnamed invitee',role:r.role,status:r.status,invited_at:r.created_at,expires_at:r.expires_at||null,accepted_at:r.used_at||r.accepted_at||null,inviter:r.inviter_name?{name:r.inviter_name,role:r.inviter_role}:null};if(includeEmail)out.invitee_email=r.email||r.accepted_email||null;return out};
 return [...current.rows.map(r=>mapRow(r,'organization_invites')),...legacy.rows.map(r=>mapRow(r,'organization_invitations'))].sort((a,b)=>new Date(b.invited_at)-new Date(a.invited_at)).slice(0,40);
}
export async function getOrganizationContext({organizationId,viewerId}){
 if(!organizationId||!viewerId)throw Object.assign(new Error('Organization context requires an authenticated operator.'),{status:401});
 const viewer=await getViewer(organizationId,viewerId);if(!viewer)throw Object.assign(new Error('Organization access could not be verified.'),{status:403});
 const activity=await getOperatorActivity(organizationId);
 const [org,peopleCounts,people,birthdays,tasks,intelligence,operators,sessions,scans,invitations,memory]=await Promise.all([
  pool.query("SELECT name,created_at FROM organizations WHERE id=$1 LIMIT 1",[organizationId]),
  pool.query("SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE type='member')::int AS members,COUNT(*) FILTER(WHERE type='visitor')::int AS visitors,COUNT(*) FILTER(WHERE created_at>=NOW()-INTERVAL '7 days')::int AS added_7d,COUNT(*) FILTER(WHERE created_at>=NOW()-INTERVAL '30 days')::int AS added_30d FROM people WHERE organization_id=$1 AND COALESCE(status,'active')='active'",[organizationId]),
  pool.query("SELECT display_name,first_name,last_name,type,created_at FROM people WHERE organization_id=$1 AND COALESCE(status,'active')='active' ORDER BY created_at DESC LIMIT 20",[organizationId]),
  pool.query("SELECT display_name,first_name,last_name,birthday FROM people WHERE organization_id=$1 AND COALESCE(status,'active')='active' AND birthday IS NOT NULL ORDER BY birthday LIMIT 12",[organizationId]),
  pool.query("SELECT COALESCE(p.display_name,trim(concat_ws(' ',p.first_name,p.last_name))) AS person_name,pt.title,pt.description,pt.priority,pt.status,pt.due_at FROM person_tasks pt JOIN people p ON p.id=pt.person_id AND p.organization_id=pt.organization_id WHERE pt.organization_id=$1 AND pt.status NOT IN('completed','cancelled') ORDER BY pt.due_at NULLS LAST,pt.created_at DESC LIMIT 20",[organizationId]),
  pool.query("SELECT COALESCE(p.display_name,trim(concat_ws(' ',p.first_name,p.last_name))) AS person_name,pi.attention_level,pi.attention_score,pi.next_best_action,pi.action_reason FROM people_intelligence pi JOIN people p ON p.id=pi.person_id AND p.organization_id=pi.organization_id WHERE pi.organization_id=$1 AND pi.next_best_action IS NOT NULL ORDER BY pi.attention_score DESC NULLS LAST LIMIT 20",[organizationId]),
  pool.query("SELECT id,name,email,role,active,created_at,last_login_at FROM users WHERE organization_id=$1 AND active=true ORDER BY CASE role WHEN'owner'THEN 0 WHEN'admin'THEN 1 ELSE 2 END,created_at",[organizationId]),
  pool.query("SELECT name,status,service_type,started_at,closed_at,aria_processing_status FROM sessions WHERE organization_id=$1 ORDER BY started_at DESC NULLS LAST LIMIT 12",[organizationId]),
  pool.query("SELECT program_name,status,created_at,started_at,completed_at FROM scan_jobs WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 12",[organizationId]),
  getInvitations(organizationId,viewer.role),getMemory(organizationId)
 ]);
 const visibleOperators=operators.rows.map(row=>projectOperator({...row,...(activity.get(String(row.id))||{})},visibility(viewer.role,row,viewer.id)));
 const count=peopleCounts.rows[0]||{};const recentOperatorActivity=[];
 for(const row of operators.rows){if(visibility(viewer.role,row,viewer.id)!=='full')continue;const a=activity.get(String(row.id));if(a?.recent_activity?.length)recentOperatorActivity.push(...a.recent_activity.map(x=>({...x,operator:nameOf(row),role:row.role})))}
 recentOperatorActivity.sort((a,b)=>new Date(b.at)-new Date(a.at));
 return{viewer:{name:nameOf(viewer),role:viewer.role},organization:{name:org.rows[0]?.name||'This organization',created_at:org.rows[0]?.created_at||null},scope:'Current organization only. Internal IDs, invitation tokens, passwords and authentication secrets are never included.',counts:{people:Number(count.total)||0,members:Number(count.members)||0,visitors:Number(count.visitors)||0,people_added_7d:Number(count.added_7d)||0,people_added_30d:Number(count.added_30d)||0,active_operators:visibleOperators.length,pending_invitations:invitations.filter(x=>x.status==='pending').length,accepted_invitations_90d:invitations.filter(x=>x.status==='accepted').length,open_tasks:tasks.rows.length,attention_items:intelligence.rows.length},operators:visibleOperators,invitations,recent_people:people.rows,upcoming_birthdays:birthdays.rows,open_tasks:tasks.rows,attention:intelligence.rows,recent_sessions:sessions.rows,recent_scans:scans.rows,recent_operator_activity:recentOperatorActivity.slice(0,30),organization_memory:memory.slice(0,20).map(x=>({memory_type:x.memory_type,key:x.memory_key,value:x.memory_value,confidence:x.confidence,updated_at:x.updated_at}))};
}
export async function getOperatorContext({organizationId,viewerId,operatorName=null}){
 if(!organizationId||!viewerId)throw Object.assign(new Error('Operator context requires an authenticated operator.'),{status:401});
 const viewer=await getViewer(organizationId,viewerId);if(!viewer)throw Object.assign(new Error('Organization access could not be verified.'),{status:403});
 const activity=await getOperatorActivity(organizationId);const q=clean(operatorName,100);
 const rows=await pool.query("SELECT id,name,email,role,active,created_at,last_login_at FROM users WHERE organization_id=$1 AND active=true AND($2::text='' OR lower(name) LIKE '%'||lower($2)||'%') ORDER BY CASE role WHEN'owner'THEN 0 WHEN'admin'THEN 1 ELSE 2 END,created_at LIMIT 10",[organizationId,q]);
 const matches=rows.rows.map(row=>projectOperator({...row,...(activity.get(String(row.id))||{})},visibility(viewer.role,row,viewer.id)));
 return{viewer:{name:nameOf(viewer),role:viewer.role},operator_query:q||null,matches,scope:'Current organization operators only. Internal IDs, invitation tokens, passwords and authentication secrets are never included.'};
}

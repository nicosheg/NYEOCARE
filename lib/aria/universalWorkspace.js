// lib/aria/universalWorkspace.js
import pool from '../db';
import { getOrganizationContext } from './organizationContext';
import { getDirectorBriefing } from './directorEngine';
import { transitionLifecycle, addTimelineEvent } from '../peopleOperatingSystem';
import { emitAriaEvent } from './eventEmitter';

const clean=(v,max=2000)=>String(v??'').trim().slice(0,max);
const roleOf=async(organizationId,actorId)=>{
 const r=await pool.query('SELECT id,name,role,active FROM users WHERE id=$1 AND organization_id=$2 AND active=true LIMIT 1',[actorId,organizationId]);
 if(!r.rows.length)throw Object.assign(new Error('Authenticated organization actor required.'),{status:403});
 return r.rows[0];
};
const requireAdmin=async(organizationId,actorId)=>{
 const actor=await roleOf(organizationId,actorId);
 if(!['owner','admin'].includes(actor.role))throw Object.assign(new Error('Owner or admin permission required.'),{status:403});
 return actor;
};
const personName=p=>p?.display_name||[p?.first_name,p?.last_name].filter(Boolean).join(' ')||'Person';

export function currentTime(timeZone=null){
 let zone=String(timeZone||'UTC').trim()||'UTC';
 let local;
 try{local=new Intl.DateTimeFormat('en',{dateStyle:'full',timeStyle:'long',timeZone:zone}).format(new Date());}
 catch{zone='UTC';local=new Intl.DateTimeFormat('en',{dateStyle:'full',timeStyle:'long',timeZone:'UTC'}).format(new Date());}
 return{capability:'current_time',iso:new Date().toISOString(),time_zone:zone,formatted:local};
}

export async function latestAttendance(organizationId){
 const session=(await pool.query(
  `SELECT s.id,s.name,s.service_type,s.status,s.started_at,s.closed_at,
          s.aria_processing_status,s.aria_processing_stage,s.aria_processing_progress,
          COUNT(ar.id)::int AS attendance_rows,
          COUNT(ar.id) FILTER(WHERE ar.present=true)::int AS present_rows,
          COUNT(ar.id) FILTER(WHERE ar.confirmed=true)::int AS confirmed_rows
   FROM sessions s
   LEFT JOIN attendance_records ar ON ar.organization_id=s.organization_id AND ar.session_id=s.id
   WHERE s.organization_id=$1
   GROUP BY s.id ORDER BY s.started_at DESC NULLS LAST LIMIT 1`,[organizationId]
 )).rows[0]||null;
 if(!session)return{capability:'get_latest_attendance',session:null,last_mark:null,people:[]};
 const rows=(await pool.query(
  `SELECT ar.id,ar.attendance_date,ar.present,ar.confirmed,ar.marked_at,
          p.id AS person_id,p.first_name,p.last_name,p.display_name,p.phone
   FROM attendance_records ar
   JOIN people p ON p.organization_id=ar.organization_id AND p.id=ar.people_id
   WHERE ar.organization_id=$1 AND ar.session_id=$2
   ORDER BY ar.marked_at DESC NULLS LAST LIMIT 100`,[organizationId,session.id]
 )).rows;
 const last=rows[0]||null;
 return{
  capability:'get_latest_attendance',session,
  last_mark:last?{attendance_id:last.id,person_id:last.person_id,person_name:personName(last),present:Boolean(last.present),confirmed:Boolean(last.confirmed),attendance_date:last.attendance_date,marked_at:last.marked_at,session_started_at:session.started_at,session_closed_at:session.closed_at}:null,
  people:rows.map(x=>({attendance_id:x.id,person_id:x.person_id,person_name:personName(x),present:Boolean(x.present),confirmed:Boolean(x.confirmed),attendance_date:x.attendance_date,marked_at:x.marked_at}))
 };
}

export async function recentActivity(organizationId,{limit=20,days=30}={}){
 const n=Math.min(Math.max(Number(limit)||20,1),100),d=Math.min(Math.max(Number(days)||30,1),365);
 const audit=await pool.query(
  `SELECT l.occurred_at,l.route,l.method,l.action_kind,l.entity_type,l.entity_id,l.status_code,l.success,l.metadata,
          u.name actor_name,u.role actor_role
   FROM aria_activity_log l
   LEFT JOIN users u ON u.id=l.actor_id AND u.organization_id=l.organization_id
   WHERE l.organization_id=$1 AND l.occurred_at>=NOW()-($2||' days')::interval
   ORDER BY l.occurred_at DESC LIMIT $3`,[organizationId,String(d),n]
 );
 let rows=audit.rows.map(x=>({at:x.occurred_at,kind:x.action_kind,route:x.route,method:x.method,status_code:x.status_code,success:Boolean(x.success),actor:x.actor_name||'NYEOCARE',actor_role:x.actor_role||null,entity_type:x.entity_type||null,entity_id:x.entity_id||null,metadata:x.metadata||{}}));
 if(rows.length<Math.min(n,8)){
  const [events,timeline]=await Promise.all([
   pool.query(`SELECT e.occurred_at,e.type,e.source,e.person_id,e.metadata,u.name actor_name,u.role actor_role
               FROM aria_events e LEFT JOIN users u ON u.id=e.actor_id AND u.organization_id=e.organization_id
               WHERE e.organization_id=$1 AND e.occurred_at>=NOW()-($2||' days')::interval
               ORDER BY e.occurred_at DESC LIMIT $3`,[organizationId,String(d),n]),
   pool.query(`SELECT t.occurred_at,t.event_type,t.title,t.description,t.people_id,p.display_name
               FROM timeline_events t JOIN people p ON p.id=t.people_id
               WHERE p.organization_id=$1 AND t.occurred_at>=NOW()-($2||' days')::interval
               ORDER BY t.occurred_at DESC LIMIT $3`,[organizationId,String(d),n])
  ]);
  rows=rows.concat(events.rows.map(x=>({at:x.occurred_at,kind:'aria_event',route:'aria_events',method:'EVENT',status_code:200,success:true,actor:x.actor_name||'ARIA',actor_role:x.actor_role||null,entity_type:x.person_id?'person':'organization',entity_id:x.person_id||null,metadata:{type:x.type,source:x.source,...(x.metadata||{})}})));
  rows=rows.concat(timeline.rows.map(x=>({at:x.occurred_at,kind:'timeline',route:'timeline_events',method:'EVENT',status_code:200,success:true,actor:'NYEOCARE',actor_role:null,entity_type:'person',entity_id:x.people_id,metadata:{event_type:x.event_type,title:x.title,description:x.description,person_name:x.display_name}})));
 }
 rows.sort((a,b)=>new Date(b.at)-new Date(a.at));
 rows=rows.slice(0,n);
 return{capability:'get_recent_activity',window_days:d,count:rows.length,activities:rows};
}

async function unresolvedOperationalCounts(organizationId){
 const [scan,reviews,tasks,actions,errors]=await Promise.all([
  pool.query("SELECT COUNT(*)::int count FROM scan_jobs WHERE organization_id=$1 AND status IN('queued','processing')",[organizationId]),
  pool.query("SELECT COUNT(*)::int count FROM scan_review_items WHERE organization_id=$1 AND status='pending'",[organizationId]),
  pool.query("SELECT COUNT(*)::int count FROM person_tasks WHERE organization_id=$1 AND status NOT IN('completed','cancelled')",[organizationId]),
  pool.query("SELECT COUNT(*)::int count FROM aria_actions WHERE organization_id=$1 AND status IN('proposed','approved','executing')",[organizationId]),
  pool.query("SELECT COUNT(*)::int count FROM system_diagnostic_events WHERE organization_id=$1 AND status='open' AND severity IN('error','critical')",[organizationId])
 ]);
 return{processing_scans:scan.rows[0]?.count||0,pending_reviews:reviews.rows[0]?.count||0,open_tasks:tasks.rows[0]?.count||0,open_aria_actions:actions.rows[0]?.count||0,open_system_errors:errors.rows[0]?.count||0};
}

export async function workspaceSnapshot(organizationId,actorId,{timeZone=null,activityLimit=20}={}){
 const [time,organization,briefing,attendance,activity,ops,communications,tasks,scans,people,groups,operators,conversations]=await Promise.all([
  Promise.resolve(currentTime(timeZone)),
  getOrganizationContext({organizationId,viewerId:actorId}),
  getDirectorBriefing(organizationId,{limit:8}),
  latestAttendance(organizationId),
  recentActivity(organizationId,{limit:activityLimit,days:30}),
  unresolvedOperationalCounts(organizationId),
  pool.query(`SELECT pc.id,pc.person_id,pc.channel,pc.direction,pc.status,pc.subject,LEFT(COALESCE(pc.content,''),500) content,pc.occurred_at,p.display_name
              FROM person_communications pc JOIN people p ON p.organization_id=pc.organization_id AND p.id=pc.person_id
              WHERE pc.organization_id=$1 ORDER BY pc.occurred_at DESC NULLS LAST,pc.created_at DESC LIMIT 25`,[organizationId]),
  pool.query(`SELECT pt.id,pt.person_id,pt.title,pt.description,pt.status,pt.priority,pt.due_at,pt.assigned_to,pt.created_by,p.display_name
              FROM person_tasks pt JOIN people p ON p.organization_id=pt.organization_id AND p.id=pt.person_id
              WHERE pt.organization_id=$1 AND pt.status NOT IN('completed','cancelled')
              ORDER BY pt.due_at NULLS LAST,pt.created_at DESC LIMIT 30`,[organizationId]),
  pool.query(`SELECT id,program_name,status,created_at,started_at,completed_at,failed_at FROM scan_jobs WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 20`,[organizationId]),
  pool.query(`SELECT id,display_name,first_name,last_name,phone,email,type,status,source,created_at,updated_at
              FROM people WHERE organization_id=$1 AND status='active' ORDER BY updated_at DESC NULLS LAST LIMIT 100`,[organizationId]),
  pool.query(`SELECT g.id,g.name,g.group_type,g.description,g.active,g.metadata,COUNT(DISTINCT pm.person_id) FILTER(WHERE pm.status='active')::int member_count
              FROM organization_groups g LEFT JOIN person_memberships pm ON pm.organization_id=g.organization_id AND pm.group_id=g.id
              WHERE g.organization_id=$1 AND g.active=true GROUP BY g.id ORDER BY g.name LIMIT 100`,[organizationId]),
  pool.query(`SELECT id,name,email,role,active,created_at,last_login_at FROM users WHERE organization_id=$1 AND active=true
              ORDER BY CASE role WHEN'owner'then 0 WHEN'admin'then 1 ELSE 2 END,created_at`,[organizationId]),
  pool.query(`SELECT c.id,c.user_id,c.person_id,c.status,c.created_at,c.updated_at,(SELECT COUNT(*)::int FROM aria_messages m WHERE m.conversation_id=c.id) message_count
              FROM aria_conversations c WHERE c.organization_id=$1 ORDER BY c.updated_at DESC LIMIT 20`,[organizationId])
 ]);
 return{capability:'get_workspace_snapshot',generated_at:new Date().toISOString(),time,organization,director:briefing,latest_attendance:attendance,recent_activity:activity,operational:ops,communications:communications.rows,open_tasks:tasks.rows,recent_scans:scans.rows,people:people.rows,groups:groups.rows,operators:operators.rows,conversations:conversations.rows};
}

const confirmationOps=new Set(['archive_person','merge_people','invite_operator','revoke_invitation','change_operator_role','delete_group','delete_person_data']);
async function executeMarkAttendance({organizationId,actorId,personId,sessionId,present=true,historical=false}){
 const actor=await roleOf(organizationId,actorId);
 let sid=sessionId;
 if(!sid){
  const open=(await pool.query("SELECT id FROM sessions WHERE organization_id=$1 AND status='active' ORDER BY started_at DESC NULLS LAST LIMIT 1",[organizationId])).rows[0];
  if(!open)throw Object.assign(new Error('No active attendance session is available.'),{status:409});
  sid=open.id;
 }
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const session=(await client.query('SELECT id,name,status,started_at FROM sessions WHERE id=$1 AND organization_id=$2 LIMIT 1',[sid,organizationId])).rows[0];
  if(!session)throw Object.assign(new Error('Attendance session not found.'),{status:404});
  const person=(await client.query("SELECT id,first_name,last_name,display_name FROM people WHERE id=$1 AND organization_id=$2 AND status='active' LIMIT 1",[personId,organizationId])).rows[0];
  if(!person)throw Object.assign(new Error('Person not found in your organization.'),{status:404});
  if(!historical){
   if(session.status!=='active')throw Object.assign(new Error('This attendance session is no longer active.'),{status:403});
   if(!['owner','admin'].includes(actor.role)){
    const member=await client.query('SELECT 1 FROM session_users WHERE session_id=$1 AND user_id=$2 LIMIT 1',[session.id,actor.id]);
    if(!member.rows.length)throw Object.assign(new Error('Join this attendance session before asking ARIA to mark attendance.'),{status:403});
   }
  }else if(!['owner','admin'].includes(actor.role))throw Object.assign(new Error('Owner or admin permission required for historical attendance corrections.'),{status:403});
  const existing=(await client.query('SELECT id,confirmed,present FROM attendance_records WHERE organization_id=$1 AND people_id=$2 AND session_id=$3 LIMIT 1',[organizationId,personId,session.id])).rows[0]||null;
  let row=null;
  if(existing?.confirmed){
   if(Boolean(existing.present)===Boolean(present)){await client.query('COMMIT');return{attendance_id:existing.id,changed:false,confirmed:true,present:Boolean(existing.present),session_id:session.id,person};}
   row=(await client.query('UPDATE attendance_records SET present=$1,status=$2,marked_by=$3,marked_at=NOW(),reviewed_by=$3,reviewed_at=NOW() WHERE id=$4 RETURNING id,marked_at',[Boolean(present),present?'present':'not_present',actor.id,existing.id])).rows[0];
  }else if(!present){
   if(existing)await client.query('DELETE FROM attendance_records WHERE id=$1 AND organization_id=$2 AND confirmed=false',[existing.id,organizationId]);
   await client.query('COMMIT');return{attendance_id:existing?.id||null,changed:Boolean(existing),confirmed:false,present:false,session_id:session.id,person};
  }else{
   row=(await client.query(`INSERT INTO attendance_records(people_id,attendance_date,present,session_id,marked_by,marked_at,status,confirmed,reviewed_by,reviewed_at,organization_id)
     VALUES($1,$2,true,$3,$4,NOW(),'present',true,$4,NOW(),$5)
     ON CONFLICT(organization_id,people_id,session_id) WHERE session_id IS NOT NULL
     DO UPDATE SET present=true,marked_by=EXCLUDED.marked_by,marked_at=NOW(),status='present',confirmed=true,reviewed_by=EXCLUDED.reviewed_by,reviewed_at=NOW()
     RETURNING id,marked_at`,[personId,new Date(session.started_at||Date.now()).toISOString().slice(0,10),session.id,actor.id,organizationId])).rows[0];
  }
  await client.query('COMMIT');
  try{
   const event=await emitAriaEvent({organizationId,personId,type:'PARTICIPATION_CONFIRMED',source:'aria_workspace_action',actorId:actor.id,actorRole:actor.role,evidenceKind:'human_report',verificationStatus:'confirmed',confidence:1,metadata:{session_id:session.id,attendance_id:row?.id||existing?.id||null,present:Boolean(present),source:'aria_workspace_action'},eventKey:'aria-attendance:'+session.id+':'+personId+':'+Date.now()});
   return{attendance_id:row?.id||existing?.id||null,changed:true,confirmed:true,present:Boolean(present),marked_at:row?.marked_at||null,session_id:session.id,session,person,event_id:event?.id||null};
  }catch{return{attendance_id:row?.id||existing?.id||null,changed:true,confirmed:true,present:Boolean(present),marked_at:row?.marked_at||null,session_id:session.id,session,person};}
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{client.release();}
}

export async function executeWorkspaceAction({organizationId,actorId,operation,personId=null,parameters={},confirmed=false}){
 const op=clean(operation,100);
 if(!op)throw Object.assign(new Error('Workspace action is required.'),{status:400});
 const actor=await roleOf(organizationId,actorId);
 if(confirmationOps.has(op)&&!confirmed)return{capability:'operate_workspace',requires_confirmation:true,operation:op,preview:parameters};
 if(op==='archive_person'){
  await requireAdmin(organizationId,actorId);
  if(!personId)throw Object.assign(new Error('personId required'),{status:400});
  const r=await pool.query(`UPDATE people SET status='archived',updated_at=NOW()
    WHERE id=$1 AND organization_id=$2 AND status='active' RETURNING id,display_name,first_name,last_name`,[personId,organizationId]);
  if(!r.rows.length)throw Object.assign(new Error('Active person not found.'),{status:404});
  await addTimelineEvent(organizationId,personId,{event_type:'person_archived',title:'Person archived by ARIA',description:'Person archived after explicit operator confirmation.',metadata:{actor_id:actor.id,source:'aria_workspace_action'},source:'human'});
  return{capability:'operate_workspace',operation:op,completed:true,person:r.rows[0]};
 }
 if(op==='restore_person'){
  if(!personId)throw Object.assign(new Error('personId required'),{status:400});
  const r=await pool.query(`UPDATE people SET status='active',updated_at=NOW()
    WHERE id=$1 AND organization_id=$2 AND status='archived' RETURNING id,display_name,first_name,last_name`,[personId,organizationId]);
  if(!r.rows.length)throw Object.assign(new Error('Archived person not found.'),{status:404});
  await addTimelineEvent(organizationId,personId,{event_type:'person_restored',title:'Person restored by ARIA',description:'Person restored to the active People directory.',metadata:{actor_id:actor.id,source:'aria_workspace_action'},source:'human'});
  return{capability:'operate_workspace',operation:op,completed:true,person:r.rows[0]};
 }
 if(op==='create_task'){
  if(!personId)throw Object.assign(new Error('personId required'),{status:400});
  const title=clean(parameters.title||parameters.task||'',240);
  if(!title)throw Object.assign(new Error('Task title is required.'),{status:400});
  const r=await pool.query(`INSERT INTO person_tasks(organization_id,person_id,title,description,status,priority,due_at,assigned_to,metadata,created_by)
    VALUES($1,$2,$3,$4,'open',$5,$6,$7,$8::jsonb,$9) RETURNING *`,
   [organizationId,personId,title,clean(parameters.description,2000)||null,['urgent','high','medium','low'].includes(parameters.priority)?parameters.priority:'medium',
    parameters.due_at||parameters.due_date||null,parameters.assigned_to||null,JSON.stringify({source:'aria_workspace_action'}),actor.id]);
  return{capability:'operate_workspace',operation:op,completed:true,task:r.rows[0]};
 }
 if(op==='complete_task'){
  const taskId=parameters.task_id||parameters.taskId;
  if(!taskId)throw Object.assign(new Error('taskId required'),{status:400});
  const r=await pool.query(`UPDATE person_tasks SET status='completed',completed_at=NOW(),updated_at=NOW()
    WHERE id=$1 AND organization_id=$2
      AND(created_by=$3 OR assigned_to=$3 OR EXISTS(SELECT 1 FROM users u WHERE u.id=$3 AND u.organization_id=$2 AND u.role IN('owner','admin')))
    RETURNING *`,[taskId,organizationId,actor.id]);
  if(!r.rows.length)throw Object.assign(new Error('Task not found or not accessible to this operator.'),{status:404});
  return{capability:'operate_workspace',operation:op,completed:true,task:r.rows[0]};
 }
 if(op==='add_note'){
  if(!personId)throw Object.assign(new Error('personId required'),{status:400});
  const text=clean(parameters.note||parameters.content||'',3000);
  if(!text)throw Object.assign(new Error('Note content is required.'),{status:400});
  const event=await addTimelineEvent(organizationId,personId,{event_type:'NOTE',title:clean(parameters.title||'Note',200),description:text,metadata:{source:'aria_workspace_action',actor_id:actor.id},source:'human'});
  return{capability:'operate_workspace',operation:op,completed:true,event};
 }
 if(op==='record_feedback'){
  if(!personId)throw Object.assign(new Error('personId required'),{status:400});
  const feedbackType=clean(parameters.feedback_type||parameters.type||'care_observation',100);
  const r=await pool.query(`INSERT INTO care_feedback(organization_id,person_id,action_id,actor_id,feedback_type,sentiment,note,context,observed_at,evidence_kind,verification_status,confidence,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NOW(),'human_report','reported',1,$9) RETURNING *`,
   [organizationId,personId,parameters.action_id||null,actor.id,feedbackType,clean(parameters.sentiment,60)||null,clean(parameters.note||parameters.content,3000)||null,JSON.stringify(parameters.context&&typeof parameters.context==='object'?parameters.context:{}),parameters.expires_at||null]);
  return{capability:'operate_workspace',operation:op,completed:true,feedback:r.rows[0]};
 }
 if(op==='mark_attendance'){
  if(!personId)throw Object.assign(new Error('personId required'),{status:400});
  return{capability:'operate_workspace',operation:op,completed:true,...await executeMarkAttendance({organizationId,actorId,personId,sessionId:parameters.session_id||parameters.sessionId||null,present:parameters.present!==false,historical:Boolean(parameters.historical)})};
 }
 if(op==='set_lifecycle'){
  if(!personId||!parameters.stage_id&&!parameters.stageId)throw Object.assign(new Error('personId and stageId are required.'),{status:400});
  const lifecycle=await transitionLifecycle(organizationId,personId,parameters.stage_id||parameters.stageId,clean(parameters.reason,1000),parameters.evidence&&typeof parameters.evidence==='object'?parameters.evidence:{},actor.id);
  return{capability:'operate_workspace',operation:op,completed:true,lifecycle};
 }
 throw Object.assign(new Error('This NYEOCARE action is not yet exposed through ARIA.'),{status:400,code:'ARIA_ACTION_NOT_EXPOSED'});
}

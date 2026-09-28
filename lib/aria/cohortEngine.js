import pool from'../db';
import{getPriorityQueue}from'./priorityQueue';

const LIMIT_MAX=100;
const clean=(v,max=300)=>String(v??'').trim().slice(0,max);

export function inferCohortFromText(input){
 const text=String(input||'').toLowerCase();
 let key=null;
 if(/past absentees|recent absentees|people who missed|those who were absent|absentees/.test(text)||/(?:everyone|everybody|all(?: the)? people).*?(?:mentioned|told you).*?(?:yesterday|earlier).*?(?:didn[’']?t|did not|were not|weren[’']?t).*?(?:attend|attendance|service)/.test(text)||/(?:people|everyone|those).*?(?:didn[’']?t|did not).*?(?:attend|attendance|service)/.test(text))key='last_event_absentees';
 else if(/(?:everyone|everybody|all(?: the)? people).*?(?:attended|came|joined|participated)|(?:people|everyone|those).*?(?:attended|came|joined|participated).*?(?:last|latest|most recent).*?(?:service|program|event|gathering)|(?:everyone|everybody|all(?: the)? people).*?(?:last|latest|most recent).*?(?:service|program|event|gathering)/.test(text))key='last_event_attendees';
 else if(/everyone in (?:the )?(?:system|organization)|all people|all members|everyone|everybody/.test(text)&&!/(?:didn[’']?t|did not|absent|missed)/.test(text))key='all_people';
 else if(/who needs follow[- ]?up|people who need follow[- ]?up|needs follow[- ]?up|people needing follow[- ]?up/.test(text))key='needs_follow_up';
 else if(/who needs attention|current attention|people needing attention/.test(text))key='current_attention';
 else if(/new people|newly known|new relationships|newcomers/.test(text))key='new_people';
 const countMatch=text.match(/\b(?:for|to)\s+(\d+)\s+(?:people|persons|members)\b/);
 const count=countMatch?Math.min(Math.max(Number(countMatch[1])||0,1),LIMIT_MAX):null;
 const all=/\b(all|everyone|everybody|all of them)\b/.test(text);
 return{key,count,all};
}

function mapPerson(r){
 return{person_id:r.person_id,name:clean(r.display_name||[r.first_name,r.last_name].filter(Boolean).join(' '),160),phone:r.phone||null,email:r.email||null,type:r.type||null,reason:r.reason||null,signal_type:r.signal_type||null,observation_id:r.observation_id||null,action_id:r.action_id||null};
}

export async function resolvePeopleCohort(organizationId,{key='current_attention',limit=10,personIds=null,days=30}={}){
 if(!organizationId)throw new Error('organizationId required');
 const explicit=[...new Set((Array.isArray(personIds)?personIds:[]).map(x=>String(x).trim()).filter(Boolean))].slice(0,LIMIT_MAX);
 let rows=[],sourceSession=null;
 if(explicit){
  const r=await pool.query(`SELECT id person_id,display_name,first_name,last_name,phone,email,type FROM people WHERE organization_id=$1 AND status='active' AND id=ANY($2::uuid[]) ORDER BY array_position($2::uuid[],id)`,[organizationId,explicit]);
  rows=r.rows.map(mapPerson);
 }else if(key==='all_people'){
  const r=await pool.query(`SELECT id person_id,display_name,first_name,last_name,phone,email,type FROM people WHERE organization_id=$1 AND status='active' ORDER BY display_name NULLS LAST,first_name,last_name,id`,[organizationId]);
  rows=r.rows.map(mapPerson);
 }else if(key==='current_attention'||key==='needs_follow_up'){
  const queue=await getPriorityQueue(organizationId,Math.min(Math.max(Number(limit)||10,1),LIMIT_MAX));
  if(key==='needs_follow_up')rows=queue.filter(x=>['extended_absence','emerging_attendance_decline','active_signal','pending_action'].includes(x.signal_type)).map(x=>mapPerson({...x,person_id:x.person_id,first_name:x.first_name,last_name:x.last_name,reason:x.reason,signal_type:x.signal_type,observation_id:x.observation_id,action_id:x.action_id}));
  else rows=queue.map(x=>mapPerson({...x,person_id:x.person_id,first_name:x.first_name,last_name:x.last_name,reason:x.reason,signal_type:x.signal_type,observation_id:x.observation_id,action_id:x.action_id}));
  }else if(key==='last_event_attendees'||key==='last_event_absentees'){
  const session=(await pool.query(`
   SELECT id,name,event_kind,event_scope,service_type,started_at,closed_at,optional,absence_meaningful
   FROM sessions
   WHERE organization_id=$1 AND status='closed' AND closed_at IS NOT NULL
   ORDER BY closed_at DESC,started_at DESC
   LIMIT 1
  `,[organizationId])).rows[0]||null;
  if(session){
   const present=key==='last_event_attendees';
   const r=await pool.query(`
    SELECT ar.people_id person_id,p.display_name,p.first_name,p.last_name,p.phone,p.email,p.type
    FROM attendance_records ar
    JOIN people p ON p.id=ar.people_id AND p.organization_id=ar.organization_id AND p.status='active'
    WHERE ar.organization_id=$1 AND ar.session_id=$2 AND ar.confirmed=true AND ar.present=$3
    ORDER BY p.display_name NULLS LAST,p.first_name,p.last_name,p.id
   `,[organizationId,session.id,present]);
   rows=r.rows.map(row=>({...mapPerson(row),source_session_id:session.id}));
   sourceSession={id:session.id,name:session.name,event_kind:session.event_kind,event_scope:session.event_scope,service_type:session.service_type,started_at:session.started_at,closed_at:session.closed_at,optional:session.optional,absence_meaningful:session.absence_meaningful,attendance_population:present?'attended':'absent'};
  }
 }else if(key==='new_people'){
  const r=await pool.query(`
   SELECT p.id person_id,p.display_name,p.first_name,p.last_name,p.phone,p.email,p.type,p.created_at,
          'Newly known to the organization.' reason,'new_relationship' signal_type
   FROM people p
   WHERE p.organization_id=$1 AND p.status='active' AND p.created_at>=NOW()-($2||' days')::interval
   ORDER BY p.created_at DESC
  `,[organizationId,String(Math.min(Math.max(Number(days)||30,1),180))]);
  rows=r.rows.map(mapPerson);
 }else{
  const r=await pool.query(`
   SELECT DISTINCT p.id person_id,p.display_name,p.first_name,p.last_name,p.phone,p.email,p.type,
          'This person currently has an unresolved care or follow-up recommendation.' reason,
          'needs_follow_up' signal_type
   FROM people p
   JOIN aria_actions a ON a.person_id=p.id AND a.organization_id=p.organization_id
   WHERE p.organization_id=$1 AND p.status='active' AND a.status IN('proposed','approved','executing')
     AND(a.expires_at IS NULL OR a.expires_at>NOW())
   ORDER BY p.display_name NULLS LAST,p.first_name
  `,[organizationId]);
  rows=r.rows.map(mapPerson);
 }
 const effectiveLimit=limit==null?LIMIT_MAX:Math.min(Math.max(Number(limit)||10,1),LIMIT_MAX);
 const limited=rows.slice(0,effectiveLimit);
 return{key,count:limited.length,total:rows.length,truncated:rows.length>limited.length,people:limited,source_session:sourceSession||null};
}

export function cohortLabel(key){
 return({last_event_absentees:'people who did not attend the last event',last_event_attendees:'people who attended the last event',all_people:'all people',past_absentees:'past absentees',needs_follow_up:'people who need follow-up',current_attention:'current attention signals',new_people:'newly known people'})[key]||'selected people';
}

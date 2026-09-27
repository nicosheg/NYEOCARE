// lib/dailyQueue.js
import pool from './db';

const DAY_CAPACITY=5;
const HORIZON_DAYS=31;

const priorityValue=v=>({critical:100,high:80,medium:55,low:25}[String(v||'').toLowerCase()]||10);
const taskKindForAction=m=>m?.first_session===true||m?.kind==='first_session_check_in'||m?.kind==='attendance_absence_check_in'||m?.kind==='returned_after_absence'?'follow_up':'action';
const timezoneDate=(date,timeZone='Africa/Lagos')=>{
 try{return new Intl.DateTimeFormat('en-CA',{timeZone}).format(date)}
 catch{return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lagos'}).format(date)}
};
const addDays=(dateString,days)=>{const d=new Date(`${dateString}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)};
const taskKey=(kind,id)=>`${kind}:${id}`;

async function organizationMeta(orgId){
 const q=await pool.query(`SELECT settings FROM organizations WHERE id=$1 LIMIT 1`,[orgId]);
 const settings=q.rows[0]?.settings||{};
 return{timeZone:settings?.timezone||'Africa/Lagos'};
}

async function candidatesFor(orgId){
 const [scan,actions,observations,messages]=await Promise.all([
  pool.query(`SELECT r.id,r.extracted_name,r.raw_name,r.extracted_phone,r.extracted_phones,r.row_number,r.reason,r.suggestion,r.status,r.created_at,r.updated_at
   FROM scan_review_items r
   WHERE r.organization_id=$1 AND r.status='pending'
   ORDER BY r.updated_at ASC,r.created_at ASC`,[orgId]),
  pool.query(`SELECT a.id,a.person_id,a.observation_id,a.type,a.status,a.priority,a.action_metadata,a.proposed_at,a.created_at,a.updated_at,
    p.first_name,p.last_name,p.display_name,p.phone,p.phone_numbers,p.type person_type,
    o.type observation_type,o.confidence
   FROM aria_actions a
   LEFT JOIN people p ON p.id=a.person_id AND p.organization_id=a.organization_id
   LEFT JOIN aria_observations o ON o.id=a.observation_id AND o.organization_id=a.organization_id
   WHERE a.organization_id=$1
     AND a.status IN('proposed','approved')
     AND(a.expires_at IS NULL OR a.expires_at>NOW())
     AND COALESCE(a.action_metadata->>'kind','')<>'scan_review_required'
   ORDER BY a.proposed_at ASC,a.created_at ASC`,[orgId]),
  pool.query(`SELECT o.id,o.person_id,o.type,o.confidence,o.severity,o.urgency,o.attention_score,o.evidence,o.metadata,o.detected_at,
    p.first_name,p.last_name,p.display_name,p.phone,p.phone_numbers,p.type person_type
   FROM aria_observations o
   LEFT JOIN people p ON p.id=o.person_id AND p.organization_id=o.organization_id
   WHERE o.organization_id=$1 AND o.status='active'
     AND(o.expires_at IS NULL OR o.expires_at>NOW())
     AND NOT EXISTS(
       SELECT 1 FROM aria_actions a
       WHERE a.organization_id=o.organization_id
         AND a.observation_id=o.id
         AND a.status IN('proposed','approved')
         AND(a.expires_at IS NULL OR a.expires_at>NOW())
     )
   ORDER BY COALESCE(o.attention_score,0) DESC,o.detected_at ASC`,[orgId]),
  pool.query(`SELECT m.id,m.sender_user_id,m.recipient_user_id,m.body,m.status,m.sent_at,m.seen_at,
    s.name sender_name,s.role sender_role,r.name recipient_name,r.role recipient_role
   FROM aria_internal_messages m
   JOIN users s ON s.id=m.sender_user_id AND s.organization_id=m.organization_id
   JOIN users r ON r.id=m.recipient_user_id AND r.organization_id=m.organization_id
   WHERE m.organization_id=$1
     AND m.status='sent'
     AND m.seen_at IS NULL
     AND r.active=true
   ORDER BY m.sent_at ASC,m.id ASC`,[orgId])
 ]);
 const out=[];
 for(const r of scan.rows){
  out.push({
   task_kind:'scan_review',source_id:String(r.id),person_id:null,priority:85,
   title:r.extracted_name||r.raw_name||'Scanned identity',label:'SCAN REVIEW',category:'scan',
   message:r.reason||'ARIA found a scanned identity that needs a decision.',
   knowledge:'ARIA paused this input instead of treating uncertain scan evidence as confirmed truth.',
   suggestion:r.suggestion||'Open Review Center and confirm or correct the record.',
   action:{type:'review',label:'Review scan'},
   metadata:{row_number:r.row_number||null},created_at:r.created_at,updated_at:r.updated_at
  });
 }
 for(const a of actions.rows){
  const m=a.action_metadata||{},kind=taskKindForAction(m),name=a.display_name||[a.first_name,a.last_name].filter(Boolean).join(' ').trim()||'This person';
  const first=kind==='follow_up',message=String(m.summary||m.message||'').trim()||`${name} has a signal worth your attention.`;
  out.push({
   task_kind:kind,source_id:String(a.id),person_id:a.person_id,priority:first?75:priorityValue(a.priority),
   title:name,label:first?'FOLLOW-UP':String(a.type||'ACTION').replace(/_/g,' ').toUpperCase(),category:'care',
   message,knowledge:String(m.knowledge||'ARIA has a signal, but not enough context to explain why it happened.'),
   suggestion:String(m.suggestion||'Review the signal and decide what to do.'),
   action:{type:'care',label:first?'Review check-in':'Review action'},
   action_id:a.id,action_type:a.type,action_status:a.status,care_session_id:m.session_id||null,
   metadata:m,observation_id:a.observation_id||null,confidence:a.confidence||null,
   created_at:a.created_at,updated_at:a.updated_at
  });
 }
 for(const o of observations.rows){
  const name=o.display_name||[o.first_name,o.last_name].filter(Boolean).join(' ').trim()||'This person';
  const first=String(o.type||'')==='UNUSUAL_ABSENCE';
  const score=first?70:Math.max(priorityValue(o.urgency),Number(o.attention_score)||0);
  const message=first?`${name} wasn’t recorded at the latest gathering.`:String(o.evidence?.summary||o.metadata?.summary||'').trim()||`ARIA found a ${String(o.type||'').replace(/_/g,' ').toLowerCase()} signal with ${name}.`;
  out.push({
   task_kind:first?'follow_up':'action',source_id:String(o.id),person_id:o.person_id,priority:score,
   title:name,label:first?'FOLLOW-UP':String(o.type||'ARIA').replace(/_/g,' ').toUpperCase(),category:'care',
   message,knowledge:first?'This is an immediate absence signal. ARIA does not yet know whether anything is wrong.':'ARIA found a signal worth your attention.',
   suggestion:first?'A simple check-in is the next useful step.':'Review the signal and decide what to do.',
   action:{type:'care',label:first?'Review check-in':'Review signal'},
   observation_id:o.id,confidence:o.confidence||null,metadata:o.metadata||{},created_at:o.detected_at,updated_at:o.detected_at
  });
 }
 for(const m of messages.rows){
  out.push({
   task_kind:'internal_message',
   source_id:String(m.id),
   fixed_assignee_id:m.recipient_user_id,
   person_id:null,
   priority:95,
   title:`Message from ${m.sender_name||'an organization operator'}`,
   label:'MESSAGE',
   category:'message',
   message:m.body,
   knowledge:`${m.sender_name||'An operator'} sent you a private message inside NYEOCARE.`,
   suggestion:'Open the message to mark it as seen.',
   action:{type:'message',label:'Read message'},
   internal_message_id:String(m.id),
   sender_user_id:m.sender_user_id,
   sender_name:m.sender_name||'Organization operator',
   sender_role:m.sender_role||'user',
   recipient_user_id:m.recipient_user_id,
   recipient_name:m.recipient_name||'You',
   recipient_role:m.recipient_role||'user',
   sent_at:m.sent_at,
   seen_at:m.seen_at||null,
   created_at:m.sent_at,
   updated_at:m.sent_at
  });
 }
 const dedup=new Map();
 const personRank=item=>item.task_kind==='follow_up'?3:item.task_kind==='action'?2:item.task_kind==='observation'?1:0;
 for(const item of out){
  const personKey=item.person_id?String(item.person_id):null;
  const groupKey=personKey&&['follow_up','action','observation'].includes(item.task_kind)
    ?`person:${personKey}`
    :taskKey(item.task_kind,item.source_id);
  const prior=dedup.get(groupKey);
  if(!prior){
   dedup.set(groupKey,item);
   continue;
  }
  const currentScore=Number(item.priority)||0,priorScore=Number(prior.priority)||0;
  if(currentScore>priorScore||(currentScore===priorScore&&personRank(item)>personRank(prior)))dedup.set(groupKey,item);
 }
 return[...dedup.values()].sort((a,b)=>Number(b.priority)-Number(a.priority)||new Date(a.created_at||0)-new Date(b.created_at||0));
}

async function ensureQueue(orgId,userId=null){
 const meta=await organizationMeta(orgId);
 const today=timezoneDate(new Date(),meta.timeZone);
 let operators=(await pool.query(`SELECT id,name,email,role FROM users WHERE organization_id=$1 AND active=true AND role IN('owner','admin') ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END,name,id`,[orgId])).rows;
 if(!operators.length&&userId){
  const me=(await pool.query(`SELECT id,name,email,role FROM users WHERE organization_id=$1 AND id=$2 AND active=true LIMIT 1`,[orgId,userId])).rows[0];
  if(me)operators=[me];
 }
 const sourceItems=await candidatesFor(orgId);
 const fixedRecipients=[...new Map(sourceItems.filter(x=>x.fixed_assignee_id).map(x=>[String(x.fixed_assignee_id),{id:x.fixed_assignee_id,name:x.recipient_name||'Recipient',role:x.recipient_role||'user'}])).values()];
 const assigneeDirectory=new Map([...operators,...fixedRecipients].map(x=>[String(x.id),x]));
 if(!assigneeDirectory.size)return{today,items:[],later_count:0,open_count:sourceItems.length,operators:[],timeZone:meta.timeZone};

 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('nyeocare:daily-queue:'||$1,0))`,[orgId]);
  const sourceMap=new Map(sourceItems.map(x=>[taskKey(x.task_kind,x.source_id),x]));
  const canonicalByPerson=new Map(sourceItems.filter(x=>x.person_id).map(x=>[String(x.person_id),x]));
  const existing=(await client.query(`SELECT id,assigned_user_id,queue_date,task_kind,source_id,status,priority,defer_count,payload,person_id
    FROM aria_daily_queue_items
    WHERE organization_id=$1 AND status IN('pending','deferred') AND queue_date>=$2
    ORDER BY queue_date,priority DESC,created_at`,[orgId,today])).rows;
  const existingByKey=new Map(existing.map(x=>[taskKey(x.task_kind,x.source_id),x]));
  for(const row of existing){
   const key=taskKey(row.task_kind,row.source_id);
   const canonical=row.person_id?canonicalByPerson.get(String(row.person_id)):null;
   const isStale=!sourceMap.has(key);
   const isNonCanonicalPersonItem=Boolean(canonical&&key!==taskKey(canonical.task_kind,canonical.source_id));
   if(isStale||isNonCanonicalPersonItem){
    await client.query(`UPDATE aria_daily_queue_items SET status='dismissed',completed_at=NOW(),updated_at=NOW() WHERE id=$1`,[row.id]);
    existingByKey.delete(key);
   }
  }
  const counts=new Map();
  for(const row of existingByKey.values()){
   if(row.task_kind==='internal_message')continue;
   const key=`${row.queue_date}:${row.assigned_user_id}`;
   counts.set(key,(counts.get(key)||0)+1);
  }
  const cursorByDay=new Map();
  const ordered=[...sourceItems].sort((a,b)=>Number(b.priority)-Number(a.priority)||new Date(a.created_at||0)-new Date(b.created_at||0));
  for(const item of ordered){
   if(existingByKey.has(taskKey(item.task_kind,item.source_id)))continue;
   let placed=false;
   const eligible=item.fixed_assignee_id
    ? [assigneeDirectory.get(String(item.fixed_assignee_id))].filter(Boolean)
    : operators;
   for(let offset=0;offset<HORIZON_DAYS&&!placed;offset++){
    const day=addDays(today,offset);
    const cursor=cursorByDay.get(day)||0;
    const candidatePool=item.fixed_assignee_id
      ? eligible
      : [...operators.keys()].map((_,i)=>operators[(cursor+i)%operators.length]);
    const chosen=item.task_kind==='internal_message'
      ? candidatePool[0]
      : candidatePool.find(u=>(counts.get(`${day}:${u.id}`)||0)<DAY_CAPACITY);
    if(!chosen)continue;
    const key=`${day}:${chosen.id}`;
    const inserted=await client.query(`INSERT INTO aria_daily_queue_items
      (organization_id,assigned_user_id,queue_date,task_kind,source_id,person_id,priority,status,payload)
      VALUES($1,$2,$3,$4,$5,$6,$7,'pending',$8::jsonb)
      ON CONFLICT(organization_id,task_kind,source_id) DO NOTHING
      RETURNING id`,
      [orgId,chosen.id,day,item.task_kind,item.source_id,item.person_id||null,Number(item.priority)||0,JSON.stringify(item)]);
    if(inserted.rows.length){
      existingByKey.set(taskKey(item.task_kind,item.source_id),{id:inserted.rows[0].id,assigned_user_id:chosen.id,queue_date:day,status:'pending',priority:item.priority,payload:item});
      if(item.task_kind!=='internal_message')counts.set(key,(counts.get(key)||0)+1);
      if(!item.fixed_assignee_id)cursorByDay.set(day,(operators.findIndex(x=>String(x.id)===String(chosen.id))+1)%operators.length);
    }
    placed=true;
   }
  }
  await client.query('COMMIT');
 }catch(err){await client.query('ROLLBACK').catch(()=>{});throw err}
 finally{client.release()}
 return{
  today,
  items:[],
  later_count:0,
  open_count:sourceItems.length,
  operators,
  timeZone:meta.timeZone
 };
}

export async function getDailyQueue(orgId,userId){
 const result=await ensureQueue(orgId,userId);
 const rows=(await pool.query(`SELECT id,assigned_user_id,queue_date,task_kind,source_id,person_id,priority,status,defer_count,payload
   FROM aria_daily_queue_items
   WHERE organization_id=$1 AND assigned_user_id=$2 AND queue_date=$3 AND status IN('pending','deferred')
   ORDER BY priority DESC,created_at`,[orgId,userId,result.today])).rows;
 const later=Number((await pool.query(`SELECT COUNT(*)::int count FROM aria_daily_queue_items WHERE organization_id=$1 AND assigned_user_id=$2 AND queue_date>$3 AND status IN('pending','deferred')`,[orgId,userId,result.today])).rows[0]?.count)||0;
 return{...result,items:rows,later_count:later};
}

export async function deferDailyQueueItem({orgId,userId,queueItemId}){
 const meta=await organizationMeta(orgId),today=timezoneDate(new Date(),meta.timeZone),client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('nyeocare:daily-queue:'||$1,0))`,[orgId]);
  const q=await client.query(`SELECT id FROM aria_daily_queue_items WHERE id=$1 AND organization_id=$2 AND assigned_user_id=$3 AND status IN('pending','deferred') FOR UPDATE`,[queueItemId,orgId,userId]);
  if(!q.rows.length){await client.query('ROLLBACK');return{ok:false,code:'QUEUE_ITEM_NOT_FOUND'};}
  const counts=(await client.query(`SELECT queue_date,COUNT(*)::int count FROM aria_daily_queue_items WHERE organization_id=$1 AND assigned_user_id=$2 AND queue_date>$3 AND status IN('pending','deferred') GROUP BY queue_date ORDER BY queue_date`,[orgId,userId,today])).rows;
  const countMap=new Map(counts.map(x=>[String(x.queue_date),Number(x.count)]));
  let nextDate=null;
  for(let i=1;i<=HORIZON_DAYS;i++){const d=addDays(today,i);if((countMap.get(d)||0)<DAY_CAPACITY){nextDate=d;break;}}
  if(!nextDate)nextDate=addDays(today,HORIZON_DAYS);
  const u=await client.query(`UPDATE aria_daily_queue_items SET queue_date=$1,status='deferred',defer_count=defer_count+1,last_deferred_at=NOW(),updated_at=NOW() WHERE id=$2 RETURNING queue_date,defer_count`,[nextDate,queueItemId]);
  await client.query('COMMIT');
  return{ok:true,queue_date:u.rows[0].queue_date,defer_count:u.rows[0].defer_count};
 }catch(err){await client.query('ROLLBACK').catch(()=>{});throw err}
 finally{client.release()}
}
export const DAILY_QUEUE_DAY_CAPACITY=DAY_CAPACITY;
export const DAILY_QUEUE_HORIZON_DAYS=HORIZON_DAYS;

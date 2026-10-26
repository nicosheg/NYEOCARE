// lib/dailyQueue.js
import pool from './db';
import { normalizeFollowUpPolicy } from './aria/followUpPolicy';
import { explainAriaAction } from './aria/actionExplainability';
import { canonicalAriaActionKey } from './aria/actionIdentity.js';

const DAY_CAPACITY=5;
const HORIZON_DAYS=31;

const priorityValue=v=>({critical:100,high:80,medium:55,low:25}[String(v||'').toLowerCase()]||10);
const taskKindForAction=m=>m?.first_session===true||m?.kind==='first_session_check_in'||m?.kind==='care_first_check_in'||m?.kind==='attendance_absence_check_in'||m?.kind==='returned_after_absence'?'follow_up':'action';
const userActionLabel=v=>{const t=String(v||'').replace(/_/g,' ').trim().toUpperCase();if(t==='ARIA ACTION'||t==='ACTION')return'NEXT STEP';if(t==='SEND MESSAGE'||t==='MESSAGE')return'MESSAGE';if(t==='REQUEST REVIEW'||t==='REVIEW')return'REVIEW';if(t==='ESCALATE'||t==='ESCALATION')return'ESCALATION';if(t==='DO NOTHING')return'NO ACTION';return t||'NEXT STEP';};
const timezoneDate=(date,timeZone='Africa/Lagos')=>{
 try{return new Intl.DateTimeFormat('en-CA',{timeZone}).format(date)}
 catch{return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lagos'}).format(date)}
};
const addDays=(dateString,days)=>{const d=new Date(`${dateString}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)};
const dayOffset=(dateString,baseDate)=>Math.round((Date.parse(`${dateString}T12:00:00Z`)-Date.parse(`${baseDate}T12:00:00Z`))/86400000);
const taskKey=(kind,id)=>`${kind}:${id}`;
const isRequiredFirstVisit=item=>item?.task_kind==='follow_up'&&item?.metadata?.first_visit_required===true;

async function organizationMeta(orgId){
 const q=await pool.query(`SELECT settings FROM organizations WHERE id=$1 LIMIT 1`,[orgId]);
 const settings=q.rows[0]?.settings||{};
 return{timeZone:settings?.timezone||'Africa/Lagos',followUpPolicy:normalizeFollowUpPolicy(settings?.aria?.follow_up_policy)};
}

async function candidatesFor(orgId){
 const [scan,actions,messages]=await Promise.all([
  pool.query(`SELECT r.id,r.extracted_name,r.raw_name,r.extracted_phones->>0 AS extracted_phone,r.extracted_phones,r.row_number,r.reason,r.suggestion,r.status,r.created_at,r.updated_at
   FROM scan_review_items r
   WHERE r.organization_id=$1 AND r.status='pending'
   ORDER BY r.updated_at ASC,r.created_at ASC`,[orgId]),
  pool.query(`SELECT a.id,a.action_key,a.person_id,a.observation_id,a.type,a.status,a.priority,a.action_metadata,a.proposed_at,a.created_at,a.updated_at,
    p.first_name,p.last_name,p.display_name,p.phone,p.phone_numbers,p.type person_type,
    o.type observation_type,o.confidence,o.evidence observation_evidence,o.metadata observation_metadata,o.severity observation_severity,o.urgency observation_urgency,o.detected_at observation_detected_at
   FROM aria_actions a
   LEFT JOIN people p ON p.id=a.person_id AND p.organization_id=a.organization_id
   LEFT JOIN aria_observations o ON o.id=a.observation_id AND o.organization_id=a.organization_id
   WHERE a.organization_id=$1
     AND a.status IN('proposed','approved')
     AND(a.expires_at IS NULL OR a.expires_at>NOW())
     AND (a.person_id IS NULL OR p.status='active')
     AND COALESCE(a.action_metadata->>'kind','') <>'scan_review_required'
     -- Historical bug guard: person creation is not attendance and must not create welcome work.
     AND NOT (
       COALESCE(a.action_metadata->>'kind','')='new_person_welcome'
       AND COALESCE(a.action_metadata->>'source_event_type','')='PERSON_CREATED'
     )
   ORDER BY a.proposed_at ASC,a.created_at ASC`,[orgId]),
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
   task_kind:'scan_review',source_id:String(r.id),canonical_work_key:'scan_review:'+String(r.id),person_id:null,priority:85,
   title:r.extracted_name||r.raw_name||'Scanned identity',label:'SCAN REVIEW',category:'scan',
   message:r.reason||'ARIA found a scanned identity that needs a decision.',
   knowledge:'ARIA paused this input instead of treating uncertain scan evidence as confirmed truth.',
   suggestion:r.suggestion||'Open Review Center and confirm or correct the record.',
   action:{type:'review',label:'Review scan'},
   metadata:{row_number:r.row_number||null},created_at:r.created_at,updated_at:r.updated_at
  });
 }
 for(const a of actions.rows){
  const m=a.action_metadata||{},kind=taskKindForAction(m);
  const canonicalWorkKey=m.canonical_work_key||canonicalAriaActionKey({organizationId:orgId,personId:a.person_id,actionMetadata:m,actionKey:a.action_key||a.id});
  const name=a.display_name||[a.first_name,a.last_name].filter(Boolean).join(' ').trim()||(a.person_id?'Unidentified person record':'Organization action');
  const welcome=m?.kind==='new_person_welcome';
  const explanation=explainAriaAction({
   personName:name,taskKind:kind,actionType:a.type,observationType:a.observation_type,
   evidence:a.observation_evidence||{},observationMetadata:a.observation_metadata||{},
   actionMetadata:m,confidence:a.confidence,detectedAt:a.observation_detected_at||a.created_at
  });
  out.push({
   task_kind:kind,source_id:String(a.id),canonical_work_key:canonicalWorkKey,person_id:a.person_id,priority:m?.first_visit_required===true?100:kind==='follow_up'?75:priorityValue(a.priority),
   title:name,label:kind==='follow_up'?'FOLLOW-UP':welcome?'WELCOME':userActionLabel(a.type),category:'care',
   message:explanation.what_happened,knowledge:explanation.what_aria_knows,suggestion:explanation.next_step,
   why_attention:explanation.why_attention,what_is_unknown:explanation.what_is_unknown,evidence_facts:explanation.evidence_facts,
   source_label:explanation.source_label,recorded_at:explanation.recorded_at,confidence_explanation:explanation.confidence,
   action:{type:'care',label:explanation.action_label},
   draft_action_type:welcome||m?.first_visit_required===true?'welcome_and_onboard':null,
   has_contact_number:Boolean(a.phone||(Array.isArray(a.phone_numbers)&&a.phone_numbers.length)),
   action_id:a.id,action_type:a.type,action_status:a.status,care_session_id:m.session_id||null,
   observation_id:a.observation_id||null,observation_type:a.observation_type||null,confidence:a.confidence??null,
   metadata:m,created_at:a.created_at,updated_at:a.updated_at
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
 const sourceRank=item=>item.action_id?3:item.task_kind==='scan_review'?2:item.observation_id?1:2;
 for(const item of out){
  const groupKey=item.canonical_work_key||taskKey(item.task_kind,item.source_id);
  const prior=dedup.get(groupKey);
  if(!prior){dedup.set(groupKey,item);continue;}
  const currentRank=sourceRank(item),priorRank=sourceRank(prior);
  const currentScore=Number(item.priority)||0,priorScore=Number(prior.priority)||0;
  if(currentRank>priorRank||(currentRank===priorRank&&currentScore>priorScore))dedup.set(groupKey,item);
 }
 return[...dedup.values()].sort((a,b)=>Number(b.priority)-Number(a.priority)||new Date(a.created_at||0)-new Date(b.created_at||0));
}

async function ensureQueue(orgId,userId=null){
 const meta=await organizationMeta(orgId);
 const today=timezoneDate(new Date(),meta.timeZone);
 const dayCapacity=meta.followUpPolicy.workerDailyCapacity;
 let operators=(await pool.query(`SELECT id,name,email,role FROM users WHERE organization_id=$1 AND active=true AND role IN('owner','admin','leader','worker','user') ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'leader' THEN 2 ELSE 3 END,name,id`,[orgId])).rows;
 if(!operators.length&&userId){
  const me=(await pool.query(`SELECT id,name,email,role FROM users WHERE organization_id=$1 AND id=$2 AND active=true LIMIT 1`,[orgId,userId])).rows[0];
  if(me)operators=[me];
 }
 // Expire stale proposals durably instead of merely hiding them from the queue.
 // Batched row locks keep cross-device queue refreshes bounded and prevent duplicate processing.
 await pool.query(`
  WITH candidates AS (
   SELECT id
   FROM aria_actions
   WHERE organization_id=$1 AND status IN('proposed','approved')
     AND expires_at IS NOT NULL AND expires_at<=NOW()
   ORDER BY expires_at ASC,id ASC
   LIMIT 250
   FOR UPDATE SKIP LOCKED
  ), expired AS (
   UPDATE aria_actions a
   SET status='cancelled',
       failure_reason='Proposal expired before operator disposition; no care outcome is assumed.',
       action_metadata=COALESCE(a.action_metadata,'{}'::jsonb)||jsonb_build_object(
        'resolution_reason','proposal_expired_without_operator_disposition',
        'resolution_source','canonical_daily_queue_sync',
        'resolved_at',NOW()
       ),
       updated_at=NOW()
   FROM candidates c
   WHERE a.id=c.id AND a.organization_id=$1
     AND a.status IN('proposed','approved')
   RETURNING a.id,a.organization_id
  )
  UPDATE aria_daily_queue_items q
  SET status='dismissed',
      payload=COALESCE(q.payload,'{}'::jsonb)||jsonb_build_object(
       'resolution_reason','source_proposal_expired_without_operator_disposition',
       'resolution_source','canonical_daily_queue_sync',
       'resolved_at',NOW()
      ),
      updated_at=NOW()
  FROM expired e
  WHERE q.organization_id=e.organization_id
    AND q.source_id=e.id::text
    AND q.task_kind IN('action','follow_up')
    AND q.status IN('pending','deferred')`,[orgId]);
 const sourceItems=await candidatesFor(orgId);
 const fixedRecipients=[...new Map(sourceItems.filter(x=>x.fixed_assignee_id).map(x=>[String(x.fixed_assignee_id),{id:x.fixed_assignee_id,name:x.recipient_name||'Recipient',role:x.recipient_role||'user'}])).values()];
 const assigneeDirectory=new Map([...operators,...fixedRecipients].map(x=>[String(x.id),x]));
 if(!assigneeDirectory.size)return{today,items:[],sourceItems,later_count:0,open_count:sourceItems.length,operators:[],timeZone:meta.timeZone,capacityPerOperator:meta.followUpPolicy.workerDailyCapacity,followUpPolicy:meta.followUpPolicy};

 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('nyeocare:daily-queue:'||$1,0))`,[orgId]);
  const sourceMap=new Map(sourceItems.map(x=>[taskKey(x.task_kind,x.source_id),x]));
  const existing=(await client.query(`SELECT id,assigned_user_id,queue_date,task_kind,source_id,status,priority,defer_count,payload,person_id,created_at
    FROM aria_daily_queue_items
    WHERE organization_id=$1 AND status IN('pending','deferred')
    ORDER BY queue_date,priority DESC,created_at
    FOR UPDATE`,[orgId])).rows;
  const existingByKey=new Map(existing.map(x=>[taskKey(x.task_kind,x.source_id),x]));
  for(const row of existing){
   const key=taskKey(row.task_kind,row.source_id);
   const isStale=!sourceMap.has(key);
   if(isStale){
    await client.query(`UPDATE aria_daily_queue_items SET status='dismissed',payload=COALESCE(payload,'{}'::jsonb)||jsonb_build_object('resolution_reason','source_no_longer_active_or_not_canonical','resolution_source','canonical_daily_queue_sync','resolved_at',NOW()),updated_at=NOW() WHERE id=$1`,[row.id]);
    existingByKey.delete(key);
   }
  }
  const counts=new Map();
  for(const row of existingByKey.values()){
   if(row.task_kind==='internal_message')continue;
   const queueDate=String(row.queue_date).slice(0,10);
   if(queueDate<today)continue;
   const key=`${queueDate}:${row.assigned_user_id}`;
   counts.set(key,(counts.get(key)||0)+1);
  }

  // First-visit care carries a real deadline. Never leave a required outcome
  // parked on a future day just because routine capacity is full: distribute
  // required items across the least-loaded active operators and keep any
  // unavoidable overflow visible today.
  let requiredAssignmentCursor=0;
  const pickTodayOperator=(excludeUserId=null)=>{
   if(!operators.length)return null;
   const loads=operators.map((operator,index)=>({
    operator,index,load:counts.get(`${today}:${operator.id}`)||0
   }));
   let eligible=loads.filter(x=>String(x.operator.id)!==String(excludeUserId));
   if(!eligible.length)eligible=loads;
   const underCapacity=eligible.filter(x=>x.load<dayCapacity);
   const candidates=underCapacity.length?underCapacity:eligible;
   const minimum=Math.min(...candidates.map(x=>x.load));
   const tied=candidates.filter(x=>x.load===minimum);
   const chosen=tied[requiredAssignmentCursor%tied.length];
   requiredAssignmentCursor=(chosen.index+1)%operators.length;
   return chosen.operator;
  };

  // A required first-visit item is always placed today. If its 24-hour (or
  // org-configured) deadline is missed, give it to another active operator.
  // Escalation is persisted on the action with a 24-hour repeat interval so
  // page refreshes cannot cause assignment ping-pong.
  const nowMs=Date.now();
  const escalationIntervalMs=24*60*60*1000;
  for(const [key,row] of existingByKey){
   const source=sourceMap.get(key);
   if(!isRequiredFirstVisit(source))continue;
   const scheduledDate=String(row.queue_date).slice(0,10);
   const activeAssignee=operators.some(operator=>String(operator.id)===String(row.assigned_user_id));
   const dueAtMs=Date.parse(source?.metadata?.first_visit_due_at||'');
   const lastEscalatedMs=Date.parse(source?.metadata?.first_visit_escalated_at||'');
   const deadlineMissed=Number.isFinite(dueAtMs)&&dueAtMs<=nowMs;
   const escalationDue=deadlineMissed&&operators.length>1&&
     (!Number.isFinite(lastEscalatedMs)||nowMs-lastEscalatedMs>=escalationIntervalMs);
   const mustBeVisibleToday=scheduledDate!==today||row.status!=='pending'||!activeAssignee;
   if(!mustBeVisibleToday&&!escalationDue)continue;

   const changeAssignee=escalationDue||!activeAssignee;
   const previousAssigneeId=row.assigned_user_id;
   if(row.task_kind!=='internal_message'&&scheduledDate>=today){
    const oldKey=`${scheduledDate}:${row.assigned_user_id}`;
    counts.set(oldKey,Math.max(0,(counts.get(oldKey)||0)-1));
   }
   const chosen=pickTodayOperator(changeAssignee?row.assigned_user_id:null);
   if(!chosen)continue;
   const updated=await client.query(`UPDATE aria_daily_queue_items
     SET queue_date=$1,assigned_user_id=$2,status='pending',updated_at=NOW()
     WHERE id=$3 RETURNING queue_date,assigned_user_id,status`,
     [today,chosen.id,row.id]);
   if(!updated.rows.length)continue;
   row.queue_date=updated.rows[0].queue_date;
   row.assigned_user_id=updated.rows[0].assigned_user_id;
   row.status='pending';
   const dayKey=`${today}:${chosen.id}`;
   counts.set(dayKey,(counts.get(dayKey)||0)+1);

   if(escalationDue){
    await client.query(`UPDATE aria_actions
      SET action_metadata=COALESCE(action_metadata,'{}'::jsonb)||jsonb_build_object(
       'first_visit_escalated_at',NOW(),
       'first_visit_escalation_count',COALESCE(NULLIF(action_metadata->>'first_visit_escalation_count','')::integer,0)+1,
       'first_visit_escalation_from',$3::text,
       'first_visit_escalation_to',$4::text
      ),updated_at=NOW()
      WHERE organization_id=$1 AND id::text=$2 AND status IN('proposed','approved')`,
      [orgId,row.source_id,previousAssigneeId,chosen.id]);
   }
  }

  // Open tasks must never disappear just because their scheduled day passed.
  // Reuse the existing row (the unique key prevents re-inserting it), preserving
  // its history while assigning a new date and returning it to pending.
  const overdueRows=[...existingByKey.values()]
   .filter(row=>String(row.queue_date).slice(0,10)<today)
   .sort((a,b)=>Number(b.priority)-Number(a.priority)||new Date(a.created_at||0)-new Date(b.created_at||0));
  const maxExistingOffset=[...existingByKey.values()].reduce((max,row)=>
   Math.max(max,dayOffset(String(row.queue_date).slice(0,10),today)),0);
  const recoveryHorizon=Math.max(HORIZON_DAYS,maxExistingOffset+overdueRows.length+1);
  for(const row of overdueRows){
   let placement=null;
   if(row.task_kind==='internal_message'){
    // Private messages are recipient-specific and do not consume care capacity.
    placement={day:today,operatorId:row.assigned_user_id};
   }else{
    const preferred=operators.find(user=>String(user.id)===String(row.assigned_user_id));
    const eligible=preferred?[preferred,...operators.filter(user=>String(user.id)!==String(preferred.id))]:operators;
    for(let offset=0;offset<recoveryHorizon&&!placement;offset++){
     const day=addDays(today,offset);
     for(const candidate of eligible){
      if((counts.get(`${day}:${candidate.id}`)||0)<dayCapacity){
       placement={day,operatorId:candidate.id};
       break;
      }
     }
    }
   }
   if(!placement)continue;
   const updated=await client.query(`UPDATE aria_daily_queue_items
     SET queue_date=$1,assigned_user_id=$2,status='pending',updated_at=NOW()
     WHERE id=$3 RETURNING queue_date,assigned_user_id`,
     [placement.day,placement.operatorId,row.id]);
   if(!updated.rows.length)continue;
   row.queue_date=updated.rows[0].queue_date;
   row.assigned_user_id=updated.rows[0].assigned_user_id;
   row.status='pending';
   if(row.task_kind!=='internal_message'){
    const key=`${String(row.queue_date).slice(0,10)}:${row.assigned_user_id}`;
    counts.set(key,(counts.get(key)||0)+1);
   }
  }
  const cursorByDay=new Map();
  const ordered=[...sourceItems].sort((a,b)=>Number(b.priority)-Number(a.priority)||new Date(a.created_at||0)-new Date(b.created_at||0));
  for(const item of ordered){
   if(existingByKey.has(taskKey(item.task_kind,item.source_id)))continue;
   if(isRequiredFirstVisit(item)){
    const chosen=pickTodayOperator();
    if(!chosen)continue;
    const inserted=await client.query(`INSERT INTO aria_daily_queue_items
      (organization_id,assigned_user_id,queue_date,task_kind,source_id,person_id,priority,status,payload)
      VALUES($1,$2,$3,$4,$5,$6,$7,'pending',$8::jsonb)
      ON CONFLICT(organization_id,task_kind,source_id) DO NOTHING
      RETURNING id`,
      [orgId,chosen.id,today,item.task_kind,item.source_id,item.person_id||null,Number(item.priority)||0,JSON.stringify(item)]);
    if(inserted.rows.length){
     existingByKey.set(taskKey(item.task_kind,item.source_id),{
      id:inserted.rows[0].id,assigned_user_id:chosen.id,queue_date:today,task_kind:item.task_kind,
      source_id:item.source_id,person_id:item.person_id||null,status:'pending',priority:item.priority,payload:item
     });
     const dayKey=`${today}:${chosen.id}`;
     counts.set(dayKey,(counts.get(dayKey)||0)+1);
    }
    continue;
   }
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
      : candidatePool.find(u=>(counts.get(`${day}:${u.id}`)||0)<dayCapacity);
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
  sourceItems,
  later_count:0,
  open_count:sourceItems.length,
  operators,
  timeZone:meta.timeZone,
  capacityPerOperator:dayCapacity,
  followUpPolicy:meta.followUpPolicy
 };
}

export async function getDailyQueue(orgId,userId){
 const result=await ensureQueue(orgId,userId);
 const sourceItems=Array.isArray(result.sourceItems)?result.sourceItems:[];
 // Duplicate identity checks only need pair decisions for people who actually
 // have eligible welcome/context/required-first-visit work. Avoid loading every
 // identity decision in a large organization on every Home/briefing request.
 const identityCandidates=sourceItems.filter(item=>Boolean(item?.person_id)&&(
  item?.metadata?.kind==='new_person_welcome'||
  item?.metadata?.kind==='new_person_context_review'||
  item?.metadata?.first_visit_required===true||
  item?.requires_context_review===true||
  item?.metadata?.requires_context_review===true
 ));
 const identityCandidateIds=[...new Set(identityCandidates.map(item=>String(item.person_id)).filter(Boolean))];
 const [rowsResult,laterResult,identityDecisionResult]=await Promise.all([
  pool.query(`SELECT id,assigned_user_id,queue_date,task_kind,source_id,person_id,priority,status,defer_count,payload
   FROM aria_daily_queue_items
   WHERE organization_id=$1 AND assigned_user_id=$2 AND queue_date=$3 AND status IN('pending','deferred')
   ORDER BY priority DESC,created_at`,[orgId,userId,result.today]),
  pool.query(`SELECT COUNT(*)::int count FROM aria_daily_queue_items WHERE organization_id=$1 AND assigned_user_id=$2 AND queue_date>$3 AND status IN('pending','deferred')`,[orgId,userId,result.today]),
  identityCandidateIds.length
   ? pool.query(`SELECT person_a_id::text person_a_id,person_b_id::text person_b_id
      FROM identity_pair_decisions
      WHERE organization_id=$1 AND decision='not_duplicate'
        AND (person_a_id=ANY($2::uuid[]) OR person_b_id=ANY($2::uuid[]))`,[orgId,identityCandidateIds])
   : Promise.resolve({rows:[]})
 ]);
 const rows=rowsResult.rows;
 const later=Number(laterResult.rows[0]?.count)||0;
 const notDuplicateIdentityPairs=identityDecisionResult.rows.map(row=>({
  person_a_id:String(row.person_a_id),person_b_id:String(row.person_b_id)
 }));
 const sourceByKey=new Map((result.sourceItems||[]).map(item=>[taskKey(item.task_kind,item.source_id),item]));
 const items=rows.map(row=>{
  const current=sourceByKey.get(taskKey(row.task_kind,row.source_id));
  return current?{...row,payload:current,priority:current.priority,person_id:current.person_id||row.person_id}:row;
 });
 const todayLoad=items.filter(row=>row.task_kind!=='internal_message').length;
 const requiredFollowUpCount=items.filter(row=>row.task_kind==='follow_up'&&row.payload?.metadata?.first_visit_required===true).length;
 const{sourceItems:ignoredSourceItems,...queueState}=result;
 return{...queueState,items,candidateItems:identityCandidates,notDuplicateIdentityPairs,later_count:later,todayLoad,capacityExceeded:Math.max(0,todayLoad-(result.capacityPerOperator||DAY_CAPACITY)),requiredFollowUpCount};
}

export async function deferDailyQueueItem({orgId,userId,queueItemId}){
 const meta=await organizationMeta(orgId),today=timezoneDate(new Date(),meta.timeZone),client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended('nyeocare:daily-queue:'||$1,0))`,[orgId]);
  const q=await client.query(`SELECT q.id,q.task_kind,q.source_id,a.action_metadata FROM aria_daily_queue_items q LEFT JOIN aria_actions a ON q.task_kind='follow_up' AND a.id::text=q.source_id AND a.organization_id=q.organization_id WHERE q.id=$1 AND q.organization_id=$2 AND q.assigned_user_id=$3 AND q.status IN('pending','deferred') FOR UPDATE OF q`,[queueItemId,orgId,userId]);
  if(!q.rows.length){await client.query('ROLLBACK');return{ok:false,code:'QUEUE_ITEM_NOT_FOUND'};}
  if(q.rows[0].action_metadata?.first_visit_required===true){await client.query('ROLLBACK');return{ok:false,code:'REQUIRED_FOLLOW_UP_CANNOT_DEFER'};}
  const counts=(await client.query(`SELECT queue_date,COUNT(*)::int count FROM aria_daily_queue_items WHERE organization_id=$1 AND assigned_user_id=$2 AND queue_date>$3 AND status IN('pending','deferred') GROUP BY queue_date ORDER BY queue_date`,[orgId,userId,today])).rows;
  const countMap=new Map(counts.map(x=>[String(x.queue_date),Number(x.count)]));
  let nextDate=null;
  for(let i=1;i<=HORIZON_DAYS;i++){const d=addDays(today,i);if((countMap.get(d)||0)<meta.followUpPolicy.workerDailyCapacity){nextDate=d;break;}}
  if(!nextDate)nextDate=addDays(today,HORIZON_DAYS);
  const u=await client.query(`UPDATE aria_daily_queue_items SET queue_date=$1,status='deferred',defer_count=defer_count+1,last_deferred_at=NOW(),updated_at=NOW() WHERE id=$2 RETURNING queue_date,defer_count`,[nextDate,queueItemId]);
  await client.query('COMMIT');
  return{ok:true,queue_date:u.rows[0].queue_date,defer_count:u.rows[0].defer_count};
 }catch(err){await client.query('ROLLBACK').catch(()=>{});throw err}
 finally{client.release()}
}
export const DAILY_QUEUE_DAY_CAPACITY=DAY_CAPACITY;
export const DAILY_QUEUE_HORIZON_DAYS=HORIZON_DAYS;

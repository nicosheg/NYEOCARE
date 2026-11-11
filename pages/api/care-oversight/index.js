// pages/api/care-oversight/index.js
import pool from '../../../lib/db';
import {withAdmin} from '../../../lib/apiHelpers';
import {getDirectorBriefing} from '../../../lib/aria/directorEngine';
import {getDailyQueue} from '../../../lib/dailyQueue';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const localDate=timeZone=>{
 try{return new Intl.DateTimeFormat('en-CA',{timeZone}).format(new Date())}
 catch{return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lagos'}).format(new Date())}
};

export default withAdmin(async function handler(req,res){
 res.setHeader('Cache-Control','private,no-store,max-age=0,must-revalidate');
 if(req.method==='POST'){
  if(String(req.body?.action||'')!=='set_champion'){res.setHeader('Allow','GET, POST');return res.status(400).json({error:'Unknown Care Oversight action.'});}
  const nextId=String(req.body?.user_id||'').trim();
  if(nextId&&!uuid.test(nextId))return res.status(400).json({error:'Choose an active operator.'});
  try{
   if(nextId){
    const candidate=(await pool.query(`SELECT id FROM users
     WHERE id=$1::uuid AND organization_id=$2 AND active=true AND role='user' LIMIT 1`,[nextId,req.org.id])).rows[0];
    if(!candidate)return res.status(404).json({error:'That operator is not available in this organization.'});
    await pool.query(`UPDATE organizations
     SET settings=COALESCE(settings,'{}'::jsonb)||jsonb_build_object(
       'adoption',COALESCE(settings->'adoption','{}'::jsonb)||jsonb_build_object('operator_champion_user_id',$2::text)
     ),updated_at=NOW()
     WHERE id=$1`,[req.org.id,nextId]);
   }else{
    await pool.query(`UPDATE organizations
     SET settings=jsonb_set(COALESCE(settings,'{}'::jsonb),'{adoption}',
       COALESCE(settings->'adoption','{}'::jsonb)-'operator_champion_user_id',true),updated_at=NOW()
     WHERE id=$1`,[req.org.id]);
   }
   return res.status(200).json({success:true});
  }catch(error){
   console.error('[CARE OVERSIGHT] champion update failed:',error?.message||error);
   return res.status(500).json({error:'Unable to update the operator champion.'});
  }
 }
 if(req.method!=='GET'){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'Method not allowed'});}
 try{
  const org=(await pool.query(`SELECT id,name,settings FROM organizations WHERE id=$1 LIMIT 1`,[req.org.id])).rows[0];
  if(!org)return res.status(404).json({error:'Organization not found.'});
  const timeZone=String(org.settings?.timezone||'Africa/Lagos');
  const today=localDate(timeZone);
  await getDailyQueue(req.org.id,req.user.id);
  const weekStart=(await pool.query(`SELECT date_trunc('week',NOW() AT TIME ZONE $1)::date::text week_start`,[timeZone])).rows[0]?.week_start;
  const visibilityClause=req.user.role==='owner'?'TRUE':"(u.role='user' OR u.id=$3)";
  const supportVisibility=req.user.role==='owner'?'TRUE':"(s.role='user' OR s.id=$2)";
  const visibilityParams=req.user.role==='owner'?[req.org.id,today]:[req.org.id,today,req.user.id];
  const supportParams=req.user.role==='owner'?[req.org.id]:[req.org.id,req.user.id];
  const championId=String(org.settings?.adoption?.operator_champion_user_id||'');

  const [
   director,
   workSummary,
   outcomeSummary,
   careLoop,
   reviewSummary,
   adoption,
   pulse,
   workloads,
   assignments,
   supportRequests,
   champion,
   candidates
  ]=await Promise.all([
   getDirectorBriefing(req.org.id,{limit:6}).catch(error=>{console.error('[CARE OVERSIGHT] director briefing degraded:',error?.message||error);return null;}),
   pool.query(`SELECT
     COUNT(*) FILTER (WHERE status IN('pending','deferred'))::int open_count,
     COUNT(*) FILTER (WHERE status IN('pending','deferred') AND queue_date<=$2::date)::int due_count,
     COUNT(*) FILTER (WHERE status IN('pending','deferred') AND queue_date<$2::date)::int overdue_count,
     COUNT(*) FILTER (WHERE task_kind='follow_up' AND status IN('pending','deferred') AND queue_date<=$2::date)::int follow_ups_due
    FROM aria_daily_queue_items WHERE organization_id=$1`,[req.org.id,today]),
   pool.query(`SELECT COUNT(*)::int count
    FROM care_feedback
    WHERE organization_id=$1 AND observed_at>=NOW()-INTERVAL '7 days'`,[req.org.id]),
   pool.query(`SELECT
      COUNT(*)::int due_count,
      COUNT(*) FILTER (WHERE status='completed' AND payload ? 'follow_up_outcome')::int completed_with_outcome
     FROM aria_daily_queue_items
     WHERE organization_id=$1 AND task_kind='follow_up'
       AND queue_date BETWEEN $2::date-6 AND $2::date
       AND status IN('pending','deferred','completed')`,[req.org.id,today]),
   pool.query(`SELECT
     (SELECT COUNT(*)::int FROM scan_review_items WHERE organization_id=$1 AND status='pending') scan_reviews,
     (SELECT COUNT(*)::int FROM person_identity_review_items WHERE organization_id=$1 AND status='pending') identity_reviews`,[req.org.id]),
   pool.query(`WITH work AS(
     SELECT assigned_user_id,
       COUNT(*) FILTER (WHERE status='completed' AND task_kind IN('follow_up','action','scan_review'))::int completed_count,
       COUNT(DISTINCT (completed_at AT TIME ZONE $2)::date)
         FILTER (WHERE status='completed' AND task_kind IN('follow_up','action','scan_review') AND completed_at>=NOW()-INTERVAL '30 days')::int repeat_days
     FROM aria_daily_queue_items
     WHERE organization_id=$1 AND completed_at IS NOT NULL
     GROUP BY assigned_user_id
    )
    SELECT COUNT(*)::int active_operators,
      COUNT(*) FILTER (WHERE COALESCE(work.completed_count,0)>0)::int first_value_operators,
      COUNT(*) FILTER (WHERE COALESCE(work.repeat_days,0)>=2)::int repeat_operators
    FROM users u LEFT JOIN work ON work.assigned_user_id=u.id
    WHERE u.organization_id=$1 AND u.active=true AND u.role='user'`,[req.org.id,timeZone]),
   pool.query(`SELECT week_start::text week_start,
       COUNT(*) FILTER (WHERE submitted_at IS NOT NULL)::int responses,
       ROUND(AVG(ease_score) FILTER (WHERE submitted_at IS NOT NULL),1)::float ease,
       ROUND(AVG(clarity_score) FILTER (WHERE submitted_at IS NOT NULL),1)::float clarity,
       ROUND(AVG(confidence_score) FILTER (WHERE submitted_at IS NOT NULL),1)::float confidence
     FROM operator_experience_pulses
     WHERE organization_id=$1 AND week_start>=($2::date-21) AND week_start<=$2::date
     GROUP BY week_start ORDER BY week_start DESC`,[req.org.id,weekStart||today]),
   pool.query(`SELECT u.id::text id,u.name,u.role,
      COUNT(q.id) FILTER (WHERE q.status IN('pending','deferred'))::int open_count,
      COUNT(q.id) FILTER (WHERE q.status IN('pending','deferred') AND q.queue_date<=$2::date)::int due_count,
      COUNT(q.id) FILTER (WHERE q.status IN('pending','deferred') AND q.queue_date<$2::date)::int overdue_count
     FROM users u LEFT JOIN aria_daily_queue_items q
       ON q.organization_id=u.organization_id AND q.assigned_user_id=u.id
     WHERE u.organization_id=$1 AND u.active=true AND ${visibilityClause}
     GROUP BY u.id,u.name,u.role
     ORDER BY CASE u.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,u.name,u.id`,visibilityParams),
   pool.query(`SELECT q.id::text queue_item_id,q.task_kind,q.status,q.queue_date::text queue_date,q.priority,
      q.assigned_user_id::text assigned_user_id,u.name assigned_to_name,u.role assigned_to_role,
      COALESCE(q.payload->>'title','Responsibility') title,COALESCE(q.payload->>'message','') message
     FROM aria_daily_queue_items q
     JOIN users u ON u.id=q.assigned_user_id AND u.organization_id=q.organization_id
     WHERE q.organization_id=$1 AND q.status IN('pending','deferred') AND q.queue_date<=$2::date
       AND ${visibilityClause}
       AND q.task_kind<>'internal_message'
     ORDER BY CASE q.task_kind WHEN 'follow_up' THEN 0 WHEN 'scan_review' THEN 1 ELSE 2 END,
       q.priority DESC,q.queue_date ASC,q.created_at ASC
     LIMIT 18`,visibilityParams),
   pool.query(`SELECT m.id::text id,m.body,m.sent_at,m.seen_at,m.metadata,
      s.id::text sender_user_id,s.name sender_name,s.role sender_role,
      r.name recipient_name,r.role recipient_role,
      linked.payload->>'title' task_title,linked.task_kind
     FROM aria_internal_messages m
     JOIN users s ON s.id=m.sender_user_id AND s.organization_id=m.organization_id
     JOIN users r ON r.id=m.recipient_user_id AND r.organization_id=m.organization_id
     LEFT JOIN aria_daily_queue_items message_queue
       ON message_queue.organization_id=m.organization_id AND message_queue.task_kind='internal_message' AND message_queue.source_id=m.id::text
      LEFT JOIN aria_daily_queue_items linked
       ON linked.organization_id=m.organization_id AND linked.id::text=m.metadata->>'queue_item_id'
     WHERE m.organization_id=$1 AND m.status='sent'
       AND m.metadata->>'kind'='operator_support_request'
       AND m.sent_at>=NOW()-INTERVAL '30 days'
       AND ${supportVisibility}
     ORDER BY m.seen_at ASC NULLS FIRST,m.sent_at DESC
     LIMIT 20`,supportParams),
   pool.query(`SELECT u.id::text id,u.name,u.role
     FROM users u
     WHERE u.organization_id=$1 AND u.active=true AND u.role='user' AND u.id::text=$2
     LIMIT 1`,[req.org.id,championId]),
   pool.query(`SELECT id::text id,name,role FROM users
     WHERE organization_id=$1 AND active=true AND role='user'
     ORDER BY name,id`,[req.org.id])
  ]);

  const work=workSummary.rows[0]||{},loop=careLoop.rows[0]||{};
  const loopDue=Number(loop.due_count)||0,loopCompleted=Number(loop.completed_with_outcome)||0;
  const pulseRows=pulse.rows||[];
  const currentPulse=pulseRows.find(row=>String(row.week_start)===String(weekStart))||null;
  return res.status(200).json({
   organization:{id:org.id,name:org.name||'Organization',time_zone:timeZone},
   generated_at:new Date().toISOString(),today,director,
   summary:{
    open_responsibilities:Number(work.open_count)||0,
    due_today:Number(work.due_count)||0,
    overdue:Number(work.overdue_count)||0,
    follow_ups_due:Number(work.follow_ups_due)||0,
    support_requests:(supportRequests.rows||[]).filter(row=>!row.seen_at).length,
    reviews:(Number(reviewSummary.rows[0]?.scan_reviews)||0)+(Number(reviewSummary.rows[0]?.identity_reviews)||0),
    outcomes_recorded_7d:Number(outcomeSummary.rows[0]?.count)||0
   },
   care_loop:{due:loopDue,completed_with_outcome:loopCompleted,rate:loopDue?Math.round(loopCompleted/loopDue*100):null,window_days:7},
   adoption:{
    active_operators:Number(adoption.rows[0]?.active_operators)||0,
    first_value_operators:Number(adoption.rows[0]?.first_value_operators)||0,
    repeat_operators:Number(adoption.rows[0]?.repeat_operators)||0,
    window_days:30
   },
   operator_pulse:{
    current:currentPulse,recent:pulseRows,
    disclosure:'Only team-level averages are displayed here. Individual responses are not shown in Care Oversight.'
   },
   workloads:workloads.rows||[],
   assignments:assignments.rows||[],
   support_requests:(supportRequests.rows||[]).map(row=>({
    id:row.id,body:row.body,sent_at:row.sent_at,seen_at:row.seen_at,
    sender:{id:row.sender_user_id,name:row.sender_name,role:row.sender_role},
    recipient:{name:row.recipient_name,role:row.recipient_role},
    task_title:row.task_title||'Assigned responsibility',
    task_kind:row.task_kind||row.metadata?.task_kind||'action',
    queue_item_id:row.metadata?.queue_item_id||null,
    reason:row.metadata?.reason||'unclear'
   })),
   operator_champion:champion.rows[0]||null,
   operator_candidates:candidates.rows||[],
   permissions:{can_reassign:true,can_manage_champion:true,role:req.user.role}
  });
 }catch(error){
  console.error('[CARE OVERSIGHT] bootstrap failed:',error?.message||error);
  return res.status(500).json({error:'Unable to load Care Oversight.'});
 }
});

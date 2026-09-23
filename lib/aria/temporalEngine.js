
import pool from'../db';
import{evidence}from'./epistemic';

const clean=(v,max=600)=>String(v??'').trim().slice(0,max);
const cap=(v,d=25,max=60)=>Math.min(Math.max(Number(v)||d,1),max);

export async function getOrganizationChanges(organizationId,{days=30,limit=25}={}){
 if(!organizationId)throw new Error('organizationId required');
 const d=cap(days,30,180),n=cap(limit,25,60);
 const daysSql=String(d);
 const [highlightsRes,countsRes]=await Promise.all([
  pool.query(
   "SELECT occurred_at,kind,label,detail,source,source_id FROM("+
   "SELECT e.occurred_at,'aria_event' kind,COALESCE(e.type,'ARIA event') label,LEFT(COALESCE(e.metadata->>'summary',e.type,'ARIA event'),220) detail,e.source,e.id::text source_id FROM aria_events e WHERE e.organization_id=$1 AND e.occurred_at>=NOW()-($2||' days')::interval "+
   "UNION ALL SELECT p.created_at,'person_added','Person added',LEFT(COALESCE(p.display_name,trim(concat_ws(' ',p.first_name,p.last_name)),'Unnamed person'),220),'people',p.id::text FROM people p WHERE p.organization_id=$1 AND p.created_at>=NOW()-($2||' days')::interval "+
   "UNION ALL SELECT s.started_at,'session_started',COALESCE(s.name,'Attendance session'),COALESCE(s.service_type,'Attendance session'),'sessions',s.id::text FROM sessions s WHERE s.organization_id=$1 AND s.started_at>=NOW()-($2||' days')::interval "+
   "UNION ALL SELECT s.closed_at,'session_closed',COALESCE(s.name,'Attendance session'),'Session closed','sessions',s.id::text FROM sessions s WHERE s.organization_id=$1 AND s.closed_at IS NOT NULL AND s.closed_at>=NOW()-($2||' days')::interval "+
   "UNION ALL SELECT i.created_at,'invitation_sent','Invitation',COALESCE(NULLIF(i.email,''),'Invitation created'),'organization_invites',i.id::text FROM organization_invites i WHERE i.organization_id=$1 AND i.created_at>=NOW()-($2||' days')::interval "+
   "UNION ALL SELECT f.observed_at,'care_feedback','Care feedback',COALESCE(NULLIF(f.note,''),f.feedback_type),'care_feedback',f.id::text FROM care_feedback f WHERE f.organization_id=$1 AND f.observed_at>=NOW()-($2||' days')::interval "+
   ")x ORDER BY occurred_at DESC NULLS LAST LIMIT $3",
   [organizationId,daysSql,n]
  ),
  pool.query(
   "SELECT COUNT(*) FILTER(WHERE p.created_at>=NOW()-INTERVAL '7 days')::int people_added_7d,"+
   "COUNT(*) FILTER(WHERE p.created_at>=NOW()-INTERVAL '14 days' AND p.created_at<NOW()-INTERVAL '7 days')::int people_added_previous_7d,"+
   "(SELECT COUNT(*) FROM sessions s WHERE s.organization_id=$1 AND s.started_at>=NOW()-INTERVAL '7 days')::int sessions_7d,"+
   "(SELECT COUNT(*) FROM sessions s WHERE s.organization_id=$1 AND s.started_at>=NOW()-INTERVAL '14 days' AND s.started_at<NOW()-INTERVAL '7 days')::int sessions_previous_7d,"+
   "(SELECT COUNT(*) FROM participation_records pr WHERE pr.organization_id=$1 AND pr.occurred_at>=NOW()-INTERVAL '7 days')::int participation_7d,"+
   "(SELECT COUNT(*) FROM participation_records pr WHERE pr.organization_id=$1 AND pr.occurred_at>=NOW()-INTERVAL '14 days' AND pr.occurred_at<NOW()-INTERVAL '7 days')::int participation_previous_7d,"+
   "(SELECT COUNT(*) FROM aria_actions a WHERE a.organization_id=$1 AND a.proposed_at>=NOW()-INTERVAL '7 days')::int proposals_7d,"+
   "(SELECT COUNT(*) FROM aria_actions a WHERE a.organization_id=$1 AND a.proposed_at>=NOW()-INTERVAL '14 days' AND a.proposed_at<NOW()-INTERVAL '7 days')::int proposals_previous_7d,"+
   "(SELECT COUNT(*) FROM care_feedback f WHERE f.organization_id=$1 AND f.observed_at>=NOW()-INTERVAL '7 days')::int feedback_7d,"+
   "(SELECT COUNT(*) FROM care_feedback f WHERE f.organization_id=$1 AND f.observed_at>=NOW()-INTERVAL '14 days' AND f.observed_at<NOW()-INTERVAL '7 days')::int feedback_previous_7d FROM people p WHERE p.organization_id=$1",
   [organizationId]
  )
 ]);
 const highlights=highlightsRes.rows.map(x=>({...x,evidence:evidence({
   kind:x.kind==='aria_event'?'observation':'fact',
   status:x.kind==='aria_event'?'observed':'verified',
   source:x.source,sourceId:x.source_id,
   statement:clean(x.label)+(x.detail?': '+clean(x.detail,220):''),
   occurredAt:x.occurred_at,confidence:.95
 })}));
 return{window_days:d,highlights,counts:countsRes.rows[0]||{},scope:'Current organization only.'};
}

export async function getPersonTimeline({organizationId,personId,limit=40}){
 if(!organizationId||!personId)throw new Error('organizationId and personId are required');
 const n=cap(limit,40,100);
 const r=await pool.query(
  "SELECT occurred_at,kind,title,detail,source,source_id,status,evidence_kind FROM("+
  "SELECT te.occurred_at,'timeline' kind,COALESCE(te.title,'Timeline event') title,LEFT(COALESCE(te.description,''),600) detail,COALESCE(te.source,'unknown') source,te.id::text source_id,NULL::text status,CASE WHEN te.source IN('human','conversation_import') THEN 'human_report' ELSE 'observation' END evidence_kind FROM timeline_events te WHERE te.people_id=$2 "+
  "UNION ALL SELECT pr.occurred_at,'participation',COALESCE(pr.participation_type,'Participation'),LEFT(COALESCE(pr.value->>'summary',pr.participation_type,'Confirmed participation'),600),'attendance',pr.id::text,'confirmed','fact' FROM participation_records pr WHERE pr.organization_id=$1 AND pr.person_id=$2 "+
  "UNION ALL SELECT pc.occurred_at,'communication',COALESCE(initcap(pc.direction)||' communication',pc.channel,'Communication'),LEFT(COALESCE(pc.content,pc.subject,''),600),pc.channel,pc.id::text,pc.status,CASE WHEN pc.direction='inbound' THEN 'human_report' ELSE 'fact' END FROM person_communications pc WHERE pc.organization_id=$1 AND pc.person_id=$2 AND pc.status<>'draft' "+
  "UNION ALL SELECT f.observed_at,'care_feedback','Care feedback',LEFT(COALESCE(f.note,f.feedback_type,''),600),'care_feedback',f.id::text,f.feedback_type,'human_report' FROM care_feedback f WHERE f.organization_id=$1 AND f.person_id=$2 "+
  "UNION ALL SELECT o.detected_at,'aria_observation',o.type,LEFT(COALESCE(o.evidence->>'summary',o.metadata->>'summary',o.type),600),'aria_observation',o.id::text,o.status,'observation' FROM aria_observations o WHERE o.organization_id=$1 AND o.person_id=$2 "+
  "UNION ALL SELECT a.created_at,'aria_action',a.type,LEFT(COALESCE(a.action_metadata->>'summary',a.action_metadata->>'reason',a.type),600),'aria_action',a.id::text,a.status,'observation' FROM aria_actions a WHERE a.organization_id=$1 AND a.person_id=$2"+
  ")x ORDER BY occurred_at DESC NULLS LAST LIMIT $3",
  [organizationId,personId,n]
 );
 return r.rows.map(x=>({...x,evidence:evidence({
  kind:x.evidence_kind==='human_report'?'human_report':x.kind==='participation'?'fact':'observation',
  status:x.status==='confirmed'||x.kind==='participation'?'verified':x.kind==='aria_observation'?'observed':'reported',
  source:x.source,sourceId:x.source_id,
  statement:[x.title,x.detail].filter(Boolean).join(': '),
  occurredAt:x.occurred_at,confidence:x.kind==='participation'?1:.8
 })}));
}

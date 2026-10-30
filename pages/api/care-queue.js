// pages/api/care-queue.js
import pool from'../../lib/db';import{withOrg}from'../../lib/apiHelpers';import{resolveCareWorkInTransaction}from'../../lib/aria/canonicalCare';
function nextAction(type,action){if(action){return({SEND_MESSAGE:'Reach out personally',REQUEST_REVIEW:'Review this person',ESCALATE:'Give this person closer attention',MARK_ATTENDANCE:'Review attendance',SCAN:'Review the latest scan',DO_NOTHING:'Keep observing'})[action.type]||'Review this signal'}return({NEW_PERSON:'Welcome this person',UNUSUAL_ABSENCE:'Check in with this person',LOW_ENGAGEMENT:'Reach out personally',ATTENDANCE_CHANGE:'Review their recent attendance',CARE_RISK:'Give this person closer attention',POSSIBLE_DUPLICATE:'Review this person',PATTERN:'Review the emerging pattern'})[type]||'Review this signal'}
function signalText(o){const e=o?.evidence||{};if(e.inference)return e.inference;return({NEW_PERSON:'A new person was discovered.',UNUSUAL_ABSENCE:'A change from this person’s usual attendance pattern was noticed.',LOW_ENGAGEMENT:'Engagement appears to be changing.',ATTENDANCE_CHANGE:'A change in attendance was detected.',CARE_RISK:'ARIA detected a care-related signal.',POSSIBLE_DUPLICATE:'This person may need a record review.',PATTERN:'ARIA detected an emerging pattern.'})[o?.type]||'ARIA detected a meaningful signal.'}
async function handler(req,res){if(req.method==='POST')return report(req,res);if(req.method!=='GET'){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'Method not allowed'})}const orgId=req.org.id;
try{
 const result=await pool.query(`
 WITH latest_obs AS(
  SELECT * FROM(
    SELECT o.*,ROW_NUMBER() OVER(PARTITION BY o.person_id ORDER BY o.attention_score DESC,o.detected_at DESC) rn
    FROM aria_observations o
    WHERE o.organization_id=$1 AND o.status='active' AND(o.expires_at IS NULL OR o.expires_at>NOW())
  )x WHERE rn=1
 ),
 pending_action AS(
  SELECT * FROM(
    SELECT a.*,ROW_NUMBER() OVER(
      PARTITION BY a.person_id
      ORDER BY CASE a.priority WHEN'critical'then 4 WHEN'high'then 3 WHEN'medium'then 2 ELSE 1 END DESC,a.proposed_at ASC
    ) rn
    FROM aria_actions a
    WHERE a.organization_id=$1 AND a.status IN('proposed','approved')
      AND(a.expires_at IS NULL OR a.expires_at>NOW())
  )x WHERE rn=1
 )
 SELECT
  p.id person_id,p.first_name,p.last_name,p.phone,
  o.id observation_id,o.type observation_type,o.confidence,o.severity,o.urgency,o.attention_score,o.evidence,o.detected_at,
  a.id action_id,a.type action_type,a.status action_status,a.priority action_priority,a.action_metadata,
  aps.engagement_state,aps.care_state,aps.relationship_state,aps.followup_state,aps.attention_level,
  COALESCE(aps.open_observation_count,0) open_observation_count,
  COALESCE(aps.open_action_count,0) open_action_count,aps.updated_at state_updated_at
 FROM people p
 LEFT JOIN latest_obs o ON o.person_id=p.id
 LEFT JOIN pending_action a ON a.person_id=p.id
 LEFT JOIN aria_person_state aps ON aps.person_id=p.id AND aps.organization_id=p.organization_id
 WHERE p.organization_id=$1 AND p.status='active'
   AND(o.id IS NOT NULL OR a.id IS NOT NULL OR COALESCE(aps.open_observation_count,0)>0 OR COALESCE(aps.open_action_count,0)>0)
 ORDER BY
  CASE COALESCE(a.priority,o.severity,aps.attention_level,'low')
    WHEN'critical'then 4 WHEN'high'then 3 WHEN'medium'then 2 ELSE 1 END DESC,
  COALESCE(o.attention_score,0) DESC,
  COALESCE(a.proposed_at,o.detected_at) ASC
 LIMIT 100
 `,[orgId]);
 return res.status(200).json(result.rows.map(row=>({
  id:row.observation_id||row.action_id||`care:${row.person_id}`,
  person_id:row.person_id,
  first_name:row.first_name,
  last_name:row.last_name,
  phone:row.phone,
  priority:row.action_priority||row.severity||row.attention_level||'low',
  risk_level:row.action_priority||row.severity||row.attention_level||'low',
  text:row.observation_type
    ?signalText({type:row.observation_type,evidence:row.evidence})
    :'ARIA has a pending action for this person.',
  observation_type:row.observation_type,
  observation_id:row.observation_id,
  confidence:row.confidence,
  severity:row.severity,
  urgency:row.urgency,
  attention_score:row.attention_score,
  evidence:row.evidence||null,
  detected_at:row.detected_at,
  action_id:row.action_id,
  action_type:row.action_type,
  action_status:row.action_status,
  suggestion:nextAction(row.observation_type,row.action_type?{type:row.action_type}:null),
  engagement_state:row.engagement_state,
  care_state:row.care_state,
  relationship_state:row.relationship_state,
  followup_state:row.followup_state,
  attention_level:row.attention_level,
  open_observation_count:Number(row.open_observation_count)||0,
  open_action_count:Number(row.open_action_count)||0,
  state_updated_at:row.state_updated_at
 })));
}catch(err){console.error('[ARIA] Care Queue error:',err);return res.status(500).json({error:'Unable to load ARIA care queue.'})}}
async function report(req,res){
 const orgId=req.org.id;
 const b=req.body||{};
 const personId=String(b.person_id||'');
 const kind=String(b.kind||'');
 if(!personId||!kind)return res.status(400).json({error:'person_id and kind are required'});
 if(!['travel','temporary_unavailable','preferred_service','not_attending','other'].includes(kind))return res.status(400).json({error:'Invalid care context'});
 try{
  const actionId=b.action_id?String(b.action_id):null;
  const observationId=b.observation_id?String(b.observation_id):null;
  const p=await pool.query("SELECT id FROM people WHERE id=$1 AND organization_id=$2 AND status='active' LIMIT 1",[personId,orgId]);
  if(!p.rows.length)return res.status(404).json({error:'Person not found'});
  let service=b.service_type||null;
  if(service){
   const s=String(service).trim().toLowerCase();
   const days={sunday:7,monday:1,tuesday:2,wednesday:3,thursday:4,friday:5,saturday:6};
   if(days[s])service='weekday:'+days[s];
  }
  const starts=b.starts_on||new Date().toISOString().slice(0,10);
  const ends=b.ends_on||null;
  const note=b.note||null;
  const db=await pool.connect();
  try{
   await db.query('BEGIN');
   const r=await db.query("INSERT INTO aria_care_contexts(organization_id,person_id,kind,starts_on,ends_on,service_type,note,metadata,created_by)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)RETURNING id,kind,starts_on,ends_on,service_type,note",[orgId,personId,kind,starts,ends,service,note,JSON.stringify(b.metadata||{}),req.user?.id||null]);
   if(note)await db.query("INSERT INTO timeline_events(people_id,event_type,title,description,metadata,source,occurred_at)VALUES($1,'care_context','ARIA care context',$2,$3,'care',$4)",[personId,note,JSON.stringify({kind,ends_on:ends,service_type:service}),new Date().toISOString()]);
   const resolved=await resolveCareWorkInTransaction({db,organizationId:orgId,actorId:req.user?.id,personId,actionId,observationId,reason:'Human context recorded from care queue.',source:'operator'});
   await db.query('COMMIT');
   return res.status(201).json({...r.rows[0],resolved});
  }catch(error){
   await db.query('ROLLBACK').catch(()=>{});
   throw error;
  }finally{
   db.release();
  }
 }catch(e){
  console.error('[ARIA] Care report error:',e);
  return res.status(500).json({error:'Unable to save what you learned.'});
 }
}
export default withOrg(handler);

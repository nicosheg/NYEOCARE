// lib/aria/careEngine.js
import pool from'../db';

const TYPES={
 welcome_and_onboard:{type:'SEND_MESSAGE',priority:'medium',template:'welcome'},
 continue_onboarding:{type:'SEND_MESSAGE',priority:'medium',template:'onboarding'},
 thoughtful_check_in:{type:'SEND_MESSAGE',priority:'low',template:'thoughtful_check_in'},
 strengthen_relationship:{type:'SEND_MESSAGE',priority:'low',template:'strengthen_relationship'},
 adjust_care_approach:{type:'SEND_MESSAGE',priority:'medium',template:'adjust_approach'}
};

const PROACTIVE_RETENTION_DAYS=30;
const PROACTIVE_RECOGNITION_DAYS=21;
const PROACTIVE_BELONGING_DAYS=30;

async function loadProactiveOpportunities(orgId){
 const r=await pool.query(`
  WITH base AS(
    SELECT
      p.id AS person_id,p.first_name,p.last_name,p.display_name,p.type,
      COALESCE(em.participation_count,0)::int participation_count,
      COALESCE(em.participation_streak,0)::int participation_streak,
      COALESCE(em.recent_frequency,0)::numeric recent_frequency,
      COALESCE(em.trend,0)::numeric trend,
      em.last_seen,
      li.last_interaction_at,
      COALESCE(rs.score,0)::int relationship_score,
      COALESCE(rs.relationship_state,'known') relationship_state
    FROM people p
    LEFT JOIN engagement_metrics em ON em.organization_id=p.organization_id AND em.person_id=p.id
    LEFT JOIN relationship_scores rs ON rs.organization_id=p.organization_id AND rs.person_id=p.id
    LEFT JOIN last_interactions li ON li.person_id=p.id
    WHERE p.organization_id=$1 AND p.status='active'
  ),
  recent_outreach AS(
    SELECT pc.person_id,MAX(pc.occurred_at) last_outreach_at
    FROM person_communications pc
    WHERE pc.organization_id=$1 AND pc.direction='outbound'
      AND pc.occurred_at>=NOW()-INTERVAL '90 days'
    GROUP BY pc.person_id
  ),
  last_interactions AS(
    SELECT person_id,occurred_at AS last_interaction_at
    FROM(
      SELECT pc.person_id,pc.occurred_at
      FROM person_communications pc
      WHERE pc.organization_id=$1 AND pc.status NOT IN('draft','failed','cancelled')
      UNION ALL
      SELECT cf.person_id,cf.observed_at
      FROM care_feedback cf
      WHERE cf.organization_id=$1
      UNION ALL
      SELECT ac.person_id,ac.created_at
      FROM aria_attendance_contexts ac
      WHERE ac.organization_id=$1 AND ac.source='human'
      UNION ALL
      SELECT te.people_id,te.occurred_at
      FROM timeline_events te
      JOIN people tp ON tp.id=te.people_id AND tp.organization_id=$1
      WHERE COALESCE(te.source,'')='human'
        AND te.event_type NOT IN('identity_review','aria_draft','person_archived','person_updated')
    ) interactions
    GROUP BY person_id
  ),
  open_actions AS(
    SELECT DISTINCT person_id
    FROM aria_actions
    WHERE organization_id=$1 AND status IN('proposed','approved','executing') AND person_id IS NOT NULL
  ),
  active_roles AS(
    SELECT DISTINCT person_id FROM person_roles
    WHERE organization_id=$1 AND status='active'
      AND(start_date IS NULL OR start_date<=CURRENT_DATE)
      AND(end_date IS NULL OR end_date>=CURRENT_DATE)
  ),
  active_memberships AS(
    SELECT DISTINCT person_id FROM person_memberships
    WHERE organization_id=$1 AND status='active'
      AND(start_date IS NULL OR start_date<=CURRENT_DATE)
      AND(end_date IS NULL OR end_date>=CURRENT_DATE)
  ),
  opportunities AS(
    SELECT
      b.person_id,'recognition' kind,'SEND_MESSAGE' action_type,'low' priority,
      'recognition' template,
      COALESCE(b.display_name,trim(concat_ws(' ',b.first_name,b.last_name))) person_name,
      'Their sustained participation is a good moment for specific recognition rather than waiting for a problem.' reason,
      'Consider a brief, sincere note that appreciates their contribution without making attendance feel like an obligation.' suggestion,
      'ARIA noticed a good moment to recognize this person.' summary,
      COALESCE(ro.last_outreach_at,NULL) last_outreach_at
    FROM base b
    LEFT JOIN recent_outreach ro ON ro.person_id=b.person_id
    LEFT JOIN open_actions oa ON oa.person_id=b.person_id
    WHERE b.participation_count>=4
      AND b.last_seen>=NOW()-INTERVAL '21 days'
      AND(oa.person_id IS NULL)
      AND(ro.last_outreach_at IS NULL OR ro.last_outreach_at<NOW()-INTERVAL '30 days')
      AND(b.last_interaction_at IS NULL OR b.last_interaction_at<NOW()-INTERVAL '14 days')

    UNION ALL

    SELECT
      b.person_id,'belonging' kind,'REQUEST_REVIEW' action_type,'low' priority,
      'belonging',
      COALESCE(b.display_name,trim(concat_ws(' ',b.first_name,b.last_name))),
      'The relationship is forming, but durable connection may still be shallow.',
      'Consider whether a person, group or simple introduction could help this person feel more connected.',
      'A possible belonging opportunity is worth a human look.',
      NULL
    FROM base b
    LEFT JOIN open_actions oa ON oa.person_id=b.person_id
    LEFT JOIN active_memberships am ON am.person_id=b.person_id
    WHERE b.participation_count BETWEEN 2 AND 3
      AND b.last_seen>=NOW()-INTERVAL '30 days'
      AND oa.person_id IS NULL
      AND am.person_id IS NULL
      AND(b.last_interaction_at IS NULL OR b.last_interaction_at<NOW()-INTERVAL '14 days')
      AND EXISTS(SELECT 1 FROM organization_groups g WHERE g.organization_id=$1 AND g.active=true)

    UNION ALL

    SELECT
      b.person_id,'serve_discovery' kind,'REQUEST_REVIEW' action_type,'low' priority,
      'serve_discovery',
      COALESCE(b.display_name,trim(concat_ws(' ',b.first_name,b.last_name))),
      'Sustained participation and a healthy relationship can make a human conversation about contribution timely.',
      'Consider inviting them to explore a team, department or serving opportunity that genuinely fits their interests.',
      'A possible contribution opportunity is worth a human look.',
      NULL
    FROM base b
    LEFT JOIN open_actions oa ON oa.person_id=b.person_id
    LEFT JOIN active_roles ar ON ar.person_id=b.person_id
    WHERE b.participation_count>=6
      AND b.last_seen>=NOW()-INTERVAL '30 days'
      AND b.relationship_score>=60
      AND oa.person_id IS NULL
      AND ar.person_id IS NULL
      AND(b.last_interaction_at IS NULL OR b.last_interaction_at<NOW()-INTERVAL '21 days')
      AND EXISTS(
        SELECT 1 FROM organization_groups g
        WHERE g.organization_id=$1 AND g.active=true
          AND lower(COALESCE(g.group_type,'')) IN('volunteer','department','service','ministry','team','serving')
      )
  )
  SELECT * FROM opportunities
  ORDER BY CASE kind WHEN'recognition'THEN 3 WHEN'belonging'THEN 2 ELSE 1 END DESC,person_name
  LIMIT 100
 `,[orgId]);
 return r.rows;
}

export async function generateCareRecommendations(orgId){
 if(!orgId)throw new Error('orgId required');
 const r=await pool.query(`SELECT p.id person_id,p.first_name,p.last_name,p.display_name,p.phone,pi.lifecycle_state,pi.next_best_action,pi.action_reason,pi.attention_level,pi.attention_score FROM people p JOIN people_intelligence pi ON pi.organization_id=p.organization_id AND pi.person_id=p.id WHERE p.organization_id=$1 AND p.status='active' AND pi.next_best_action IS NOT NULL`,[orgId]);
 const open=await pool.query(`SELECT DISTINCT person_id FROM aria_actions WHERE organization_id=$1 AND status IN('proposed','approved','executing') AND person_id=ANY($2::uuid[])`,[orgId,r.rows.map(x=>x.person_id)]);
 const openPeople=new Set(open.rows.map(x=>String(x.person_id)));
 const payload=r.rows.map(row=>{
  const spec=TYPES[row.next_best_action];
  if(!spec||openPeople.has(String(row.person_id)))return null;
  return{person_id:row.person_id,action_type:spec.type,priority:spec.priority,template:spec.template,reason:row.action_reason||'ARIA identified a meaningful opportunity to care.',action_key:`care:${orgId}:${row.person_id}:${row.next_best_action}`};
 }).filter(Boolean);

 const proactive=await loadProactiveOpportunities(orgId);
 const proactivePayload=proactive.map(row=>({
  person_id:row.person_id,
  action_type:row.action_type,
  priority:row.priority,
  template:row.template,
  reason:row.reason,
  summary:row.summary,
  suggestion:row.suggestion,
  kind:row.kind,
  action_key:`proactive:${orgId}:${row.person_id}:${row.kind}`
 })).filter(x=>!openPeople.has(String(x.person_id)));

 if(!payload.length&&!proactivePayload.length)return[];

 const combined=[...payload,...proactivePayload];
 const inserted=await pool.query(`
  INSERT INTO aria_actions(organization_id,person_id,type,status,priority,action_metadata,action_key,proposed_at)
  SELECT $1,x.person_id,x.action_type,'proposed',x.priority,jsonb_build_object(
    'kind',COALESCE(x.kind,'care'),
    'template',x.template,
    'reason',x.reason,
    'summary',COALESCE(x.summary,x.reason),
    'suggestion',COALESCE(x.suggestion,'Review this opportunity and decide what to do.'),
    'requires_human_approval',true,
    'draft_required',x.action_type='SEND_MESSAGE',
    'channel','whatsapp',
    'proactive',COALESCE(x.kind,'care')<>'care'
  ),x.action_key,NOW()
  FROM jsonb_to_recordset($2::jsonb) AS x(
    person_id uuid,action_type text,priority text,template text,reason text,summary text,suggestion text,kind text,action_key text
  )
  ON CONFLICT(organization_id,action_key) DO NOTHING
  RETURNING id,person_id,type,priority,action_metadata
 `,[orgId,JSON.stringify(combined)]);
 return inserted.rows.map(action=>({actionId:action.id,personId:action.person_id,actionType:action.type,priority:action.priority,reason:action.action_metadata?.reason||null,kind:action.action_metadata?.kind||'care'}));
}

export async function getCareOpportunities(orgId,limit=50){
 if(!orgId)throw new Error('orgId required');
 const n=Math.min(Math.max(Number(limit)||50,1),100);
 const r=await pool.query(`SELECT ps.*,p.first_name,p.last_name,p.display_name,p.phone,p.email,pi.next_best_action,pi.action_reason,pi.evidence FROM aria_person_state ps JOIN people p ON p.id=ps.person_id AND p.organization_id=ps.organization_id LEFT JOIN people_intelligence pi ON pi.person_id=ps.person_id AND pi.organization_id=ps.organization_id WHERE ps.organization_id=$1 AND ps.followup_state='recommended' AND p.status='active' ORDER BY CASE ps.attention_level WHEN'critical'then 4 WHEN'high'then 3 WHEN'medium'then 2 ELSE 1 END DESC,ps.updated_at DESC LIMIT $2`,[orgId,n]);
 return r.rows;
}

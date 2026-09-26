// lib/aria/priorityQueue.js
import pool from'../db';

export async function getPriorityQueue(orgId,limit=10){
 if(!orgId)throw new Error('orgId required');
 const n=Math.min(Math.max(Number(limit)||10,1),100);
 const result=await pool.query(`
  WITH base AS(
   SELECT p.id person_id,p.first_name,p.last_name,p.phone,
    COALESCE(em.participation_count,0)::int participation_count,
    COALESCE(em.participation_streak,0)::int participation_streak,
    COALESCE(em.inactivity_streak,0)::int inactivity_streak,
    COALESCE(em.recent_frequency,0)::numeric recent_frequency,
    COALESCE(em.baseline_frequency,0)::numeric baseline_frequency,
    COALESCE(em.trend,0)::numeric trend,
    COALESCE(em.deviation,0)::numeric deviation,
    em.last_seen,
    COALESCE(pi.attention_score,0)::numeric attention_score,
    COALESCE(pi.next_best_action,'') next_best_action,
    COALESCE(rs.score,0)::int relationship_score,
    COALESCE(rs.relationship_state,'known') relationship_state,
    COALESCE(o.open_observations,0)::int open_observations,
    COALESCE(a.open_actions,0)::int open_actions,
    COALESCE(a.action_priority,0)::int action_priority,
    CASE WHEN ro.last_outreach_at IS NULL OR ro.last_outreach_at<NOW()-INTERVAL '30 days' THEN true ELSE false END outreach_cooldown_ok,
    CASE WHEN am.person_id IS NULL THEN false ELSE true END has_active_membership,
    CASE WHEN ar.person_id IS NULL THEN false ELSE true END has_active_role,
    COALESCE(gc.engagement_group_available,false) engagement_group_available,
    COALESCE(gc.serving_group_available,false) serving_group_available,
    top_observation.id AS observation_id,
    top_observation.type AS observation_type,
    top_observation.evidence AS observation_evidence,
    top_observation.detected_at AS observation_detected_at,
    top_action.id AS action_id,
    top_action.type AS action_type,
    top_action.status AS action_status,
    top_action.action_metadata AS action_metadata
   FROM people p
   LEFT JOIN engagement_metrics em ON em.organization_id=p.organization_id AND em.person_id=p.id
   LEFT JOIN people_intelligence pi ON pi.organization_id=p.organization_id AND pi.person_id=p.id
   LEFT JOIN relationship_scores rs ON rs.organization_id=p.organization_id AND rs.person_id=p.id
   LEFT JOIN(
    SELECT organization_id,person_id,MAX(occurred_at) last_outreach_at
    FROM person_communications
    WHERE direction='outbound' AND occurred_at>=NOW()-INTERVAL '90 days'
    GROUP BY organization_id,person_id
   )ro ON ro.organization_id=p.organization_id AND ro.person_id=p.id
   LEFT JOIN(
    SELECT organization_id,person_id
    FROM person_memberships
    WHERE status='active' AND(start_date IS NULL OR start_date<=CURRENT_DATE)
      AND(end_date IS NULL OR end_date>=CURRENT_DATE)
    GROUP BY organization_id,person_id
   )am ON am.organization_id=p.organization_id AND am.person_id=p.id
   LEFT JOIN(
    SELECT organization_id,person_id
    FROM person_roles
    WHERE status='active' AND(start_date IS NULL OR start_date<=CURRENT_DATE)
      AND(end_date IS NULL OR end_date>=CURRENT_DATE)
    GROUP BY organization_id,person_id
   )ar ON ar.organization_id=p.organization_id AND ar.person_id=p.id
   LEFT JOIN(
    SELECT organization_id,bool_or(active) engagement_group_available,
      bool_or(active AND lower(COALESCE(group_type,'')) IN('volunteer','department','service','ministry','team','serving')) serving_group_available
    FROM organization_groups
    GROUP BY organization_id
   )gc ON gc.organization_id=p.organization_id
   LEFT JOIN(
    SELECT organization_id,person_id,COUNT(*)::int open_observations
    FROM aria_observations
    WHERE status='active' AND(expires_at IS NULL OR expires_at>NOW())
    GROUP BY organization_id,person_id
   )o ON o.organization_id=p.organization_id AND o.person_id=p.id
   LEFT JOIN LATERAL(
    SELECT id,type,evidence,detected_at
    FROM aria_observations
    WHERE organization_id=p.organization_id AND person_id=p.id AND status='active' AND(expires_at IS NULL OR expires_at>NOW())
    ORDER BY attention_score DESC,detected_at DESC
    LIMIT 1
   )top_observation ON true
   LEFT JOIN LATERAL(
    SELECT id,type,status,action_metadata
    FROM aria_actions
    WHERE organization_id=p.organization_id AND person_id=p.id AND status IN('proposed','approved','executing')
      AND(expires_at IS NULL OR expires_at>NOW())
    ORDER BY CASE priority WHEN'critical'then 4 WHEN'high'then 3 WHEN'medium'then 2 ELSE 1 END DESC,proposed_at ASC
    LIMIT 1
   )top_action ON true
   LEFT JOIN(
    SELECT organization_id,person_id,COUNT(*)::int open_actions,
     MAX(CASE priority WHEN'critical'then 4 WHEN'high'then 3 WHEN'medium'then 2 ELSE 1 END)::int action_priority
    FROM aria_actions
    WHERE status IN('proposed','approved','executing')
    GROUP BY organization_id,person_id
   )a ON a.organization_id=p.organization_id AND a.person_id=p.id
   WHERE p.organization_id=$1 AND p.status='active'
  ),
  scored AS(
   SELECT *,
    CASE
     WHEN participation_count>=4
       AND last_seen>=NOW()-INTERVAL '21 days'
       AND open_actions=0
       AND outreach_cooldown_ok
      THEN'recognition_opportunity'
     WHEN participation_count BETWEEN 2 AND 3
       AND last_seen>=NOW()-INTERVAL '30 days'
       AND open_actions=0
       AND has_active_membership=false
       AND engagement_group_available
      THEN'belonging_opportunity'
     WHEN participation_count>=6
       AND last_seen>=NOW()-INTERVAL '30 days'
       AND relationship_score>=60
       AND open_actions=0
       AND has_active_role=false
       AND serving_group_available
      THEN'contribution_opportunity'
     WHEN inactivity_streak>=4 THEN'extended_absence'
     WHEN trend<=-.25 OR deviation<=-.25 THEN'emerging_attendance_decline'
     WHEN participation_count=1 THEN'new_relationship'
     WHEN open_observations>0 THEN'active_signal'
     WHEN open_actions>0 THEN'pending_action'
     ELSE NULL
    END signal_type
   FROM base
  )
  SELECT person_id,first_name,last_name,phone,participation_count,participation_streak,
   inactivity_streak,recent_frequency recent_attendance,baseline_frequency previous_attendance,
   last_seen last_attendance,trend,deviation,attention_score,next_best_action,
   relationship_score,relationship_state,open_observations,open_actions,signal_type,
   CASE
    WHEN signal_type='recognition_opportunity' THEN'ARIA noticed a good moment to recognize sustained participation.'
    WHEN signal_type='belonging_opportunity' THEN'This relationship may benefit from a more intentional connection point.'
    WHEN signal_type='contribution_opportunity' THEN'The person may be ready to explore a meaningful way to contribute.'
    WHEN signal_type='extended_absence' THEN'Attendance has been quiet longer than the recent pattern suggests.'
    WHEN signal_type='emerging_attendance_decline' THEN'Recent participation is below the person''s previous pattern.'
    WHEN signal_type='new_relationship' THEN'This person is newly known and may benefit from intentional welcome.'
    WHEN signal_type='active_signal' THEN'ARIA has an active observation that deserves review.'
    WHEN signal_type='pending_action' THEN'ARIA has a pending human-approved action for this person.'
    ELSE'ARIA found a meaningful change worth reviewing.'
   END reason,
   (attention_score+action_priority*10+
    CASE WHEN signal_type='recognition_opportunity' THEN 24
         WHEN signal_type='belonging_opportunity' THEN 20
         WHEN signal_type='contribution_opportunity' THEN 18
         ELSE 0 END+
    CASE WHEN inactivity_streak>0 THEN LEAST(32,inactivity_streak*8) ELSE 0 END+
    CASE WHEN trend<0 THEN LEAST(20,ABS(trend)*20) ELSE 0 END+
    CASE WHEN deviation<0 THEN LEAST(15,ABS(deviation)*15) ELSE 0 END)::int priority_score
  FROM scored
  WHERE signal_type IS NOT NULL
  ORDER BY priority_score DESC,first_name ASC
  LIMIT $2
 `,[orgId,n]);
 return result.rows;
}

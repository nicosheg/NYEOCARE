// lib/aria/attendanceIntelligence.js
import pool from '../db';

const TARGET_CTE = `
WITH target AS (
  SELECT DISTINCT ar.people_id AS person_id
  FROM attendance_records ar
  WHERE ar.organization_id=$1 AND ar.session_id=$2
    AND ar.present=true AND ar.confirmed=true
  UNION
  SELECT DISTINCT o.person_id
  FROM aria_observations o
  WHERE o.organization_id=$1 AND o.person_id IS NOT NULL
    AND o.metadata->>'session_id'=$2::text
    AND o.status='active'
)
`;

export async function refreshAttendanceIntelligence(sessionId, orgId) {
  if (!sessionId || !orgId) throw new Error('sessionId and orgId are required');

  const client = await pool.connect();
  const timings = {};
  try {
    await client.query('BEGIN');

    let started = Date.now();
    await client.query(`${TARGET_CTE},
history AS (
  SELECT pr.person_id,
    COUNT(*)::int AS participation_count,
    MIN(pr.occurred_at) AS first_seen,
    MAX(pr.occurred_at) AS last_seen,
    COUNT(*) FILTER (WHERE pr.occurred_at>=NOW()-INTERVAL '28 days')::int AS recent_count,
    COUNT(*) FILTER (WHERE pr.occurred_at>=NOW()-INTERVAL '56 days' AND pr.occurred_at<NOW()-INTERVAL '28 days')::int AS prior_count,
    COUNT(*) FILTER (WHERE pr.occurred_at>=NOW()-INTERVAL '84 days')::int AS baseline_count
  FROM participation_records pr
  JOIN target t ON t.person_id=pr.person_id
  WHERE pr.organization_id=$1
  GROUP BY pr.person_id
),
weeks AS (
  SELECT pr.person_id,
    FLOOR(EXTRACT(EPOCH FROM (NOW()-pr.occurred_at))/604800)::int AS week_index
  FROM participation_records pr
  JOIN target t ON t.person_id=pr.person_id
  WHERE pr.organization_id=$1
    AND pr.occurred_at>=NOW()-INTERVAL '84 days'
  GROUP BY pr.person_id,FLOOR(EXTRACT(EPOCH FROM (NOW()-pr.occurred_at))/604800)::int
),
week_stats AS (
  SELECT person_id,COUNT(*)::int AS baseline_weeks
  FROM weeks GROUP BY person_id
),
streak AS (
  SELECT t.person_id,
    CASE
      WHEN EXISTS(SELECT 1 FROM weeks w0 WHERE w0.person_id=t.person_id AND w0.week_index=0)
      THEN COALESCE(MIN(gs.n) FILTER (WHERE w.week_index IS NULL),12)
      ELSE 0
    END::int AS participation_streak
  FROM target t
  CROSS JOIN generate_series(0,12) gs(n)
  LEFT JOIN weeks w ON w.person_id=t.person_id AND w.week_index=gs.n
  GROUP BY t.person_id
),
metrics AS (
  SELECT t.person_id,
    COALESCE(h.participation_count,0)::int participation_count,
    COALESCE(ws.baseline_weeks,0)::int baseline_weeks,
    COALESCE(s.participation_streak,0)::int participation_streak,
    COALESCE(h.first_seen,em.first_seen) first_seen,
    COALESCE(h.last_seen,em.last_seen) last_seen,
    COALESCE(h.recent_count,0)::int recent_count,
    COALESCE(h.prior_count,0)::int prior_count,
    COALESCE(h.baseline_count,0)::int baseline_count
  FROM target t
  LEFT JOIN history h ON h.person_id=t.person_id
  LEFT JOIN week_stats ws ON ws.person_id=t.person_id
  LEFT JOIN streak s ON s.person_id=t.person_id
  LEFT JOIN engagement_metrics em ON em.organization_id=$1 AND em.person_id=t.person_id
),
calc AS (
  SELECT *,
    (baseline_weeks::numeric / LEAST(12,GREATEST(1,CEIL(EXTRACT(EPOCH FROM (NOW()-COALESCE(first_seen,NOW())))/604800)))) * 100 AS participation_rate_raw,
    baseline_count::numeric/12 AS baseline_frequency,
    recent_count::numeric/4 AS recent_frequency,
    prior_count::numeric/4 AS prior_frequency,
    FLOOR(EXTRACT(EPOCH FROM (NOW()-COALESCE(last_seen,NOW())))/604800)::int AS inactivity_streak_raw
  FROM metrics
),
final AS (
  SELECT *,
    LEAST(100,GREATEST(0,ROUND(participation_rate_raw)))::int participation_rate,
    LEAST(1,GREATEST(-1,
      CASE WHEN prior_frequency=0 THEN CASE WHEN recent_frequency>0 THEN 1 ELSE 0 END
      ELSE (recent_frequency-prior_frequency)/prior_frequency END
    )) trend,
    LEAST(1,GREATEST(-1,
      (recent_frequency-GREATEST(0.25,baseline_frequency))/GREATEST(0.25,baseline_frequency)
    )) deviation,
    LEAST(1,GREATEST(0,participation_count::numeric/8)) confidence,
    LEAST(100,GREATEST(0,inactivity_streak_raw)) inactivity_streak
  FROM calc
)
INSERT INTO engagement_metrics(
 organization_id,person_id,participation_count,participation_rate,participation_streak,
 inactivity_streak,baseline_frequency,recent_frequency,trend,deviation,
 first_seen,last_seen,last_meaningful_event,confidence,evidence,calculated_at,updated_at
)
SELECT $1,person_id,participation_count,participation_rate,participation_streak,
 inactivity_streak::int,baseline_frequency,recent_frequency,trend,deviation,
 first_seen,last_seen,last_seen,confidence,
 jsonb_build_object(
  'sample_size',participation_count,'baseline_days',84,'recent_days',28,
  'days_since_last',GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (NOW()-COALESCE(last_seen,NOW())))/86400))::int,
  'baseline_frequency',baseline_frequency,'recent_frequency',recent_frequency,
  'prior_frequency',prior_frequency,'trend',trend,'deviation',deviation,
  'participation_streak',participation_streak,'inactivity_streak',inactivity_streak
 ),NOW(),NOW()
FROM final
ON CONFLICT(organization_id,person_id) DO UPDATE SET
 participation_count=EXCLUDED.participation_count,
 participation_rate=EXCLUDED.participation_rate,
 participation_streak=EXCLUDED.participation_streak,
 inactivity_streak=EXCLUDED.inactivity_streak,
 baseline_frequency=EXCLUDED.baseline_frequency,
 recent_frequency=EXCLUDED.recent_frequency,
 trend=EXCLUDED.trend,
 deviation=EXCLUDED.deviation,
 first_seen=EXCLUDED.first_seen,
 last_seen=EXCLUDED.last_seen,
 last_meaningful_event=EXCLUDED.last_meaningful_event,
 confidence=EXCLUDED.confidence,
 evidence=EXCLUDED.evidence,
 calculated_at=NOW(),
 updated_at=NOW()`,[orgId,sessionId]);
    timings.engagementMs = Date.now()-started;

    started = Date.now();
    await client.query(`${TARGET_CTE},
mem AS (
  SELECT pm.organization_id,pm.person_id,COUNT(*)::int memory_count
  FROM person_memory pm
  JOIN target t ON t.person_id=pm.person_id
  WHERE pm.organization_id=$1 AND pm.active=true
  GROUP BY pm.organization_id,pm.person_id
),
outcomes AS (
  SELECT io.organization_id,io.person_id,
    COUNT(*) FILTER (WHERE io.outcome IN('positive','helpful','worked','returned','became_regular','relationship_strengthened'))::int positive_count,
    COUNT(*) FILTER (WHERE io.outcome IN('negative','ineffective','did_not_work','unsuccessful','no_response'))::int negative_count
  FROM intelligence_outcomes io
  JOIN target t ON t.person_id=io.person_id
  WHERE io.organization_id=$1
  GROUP BY io.organization_id,io.person_id
),
scored AS (
 SELECT p.organization_id,p.id AS person_id,
   LEAST(100,GREATEST(0,ROUND(
    35+
    LEAST(25,COALESCE(em.participation_rate,0)*.25)+
    LEAST(15,COALESCE(em.participation_streak,0)*3)+
    LEAST(10,COALESCE(mem.memory_count,0)*2)+
    LEAST(10,COALESCE(outcomes.positive_count,0)*2)-
    LEAST(8,COALESCE(outcomes.negative_count,0)*2)+
    GREATEST(-5,LEAST(5,COALESCE(em.trend,0)*5))
   )))::int AS score
 FROM people p
 JOIN target t ON t.person_id=p.id
 LEFT JOIN engagement_metrics em ON em.organization_id=p.organization_id AND em.person_id=p.id
 LEFT JOIN mem ON mem.organization_id=p.organization_id AND mem.person_id=p.id
 LEFT JOIN outcomes ON outcomes.organization_id=p.organization_id AND outcomes.person_id=p.id
 WHERE p.organization_id=$1 AND p.status='active'
)
INSERT INTO relationship_scores(organization_id,person_id,score,relationship_state,evidence,calculated_at,updated_at)
SELECT organization_id,person_id,score,
 CASE WHEN score>=80 THEN 'strong' WHEN score>=60 THEN 'healthy' WHEN score>=40 THEN 'developing' ELSE 'known' END,
 jsonb_build_object(
  'participation_rate',COALESCE(em.participation_rate,0),
  'participation_streak',COALESCE(em.participation_streak,0),
  'memory_count',COALESCE(mem.memory_count,0),
  'positive_outcomes',COALESCE(outcomes.positive_count,0),
  'negative_outcomes',COALESCE(outcomes.negative_count,0),
  'trend',COALESCE(em.trend,0),'confidence',COALESCE(em.confidence,0)
 ),NOW(),NOW()
FROM scored
JOIN engagement_metrics em ON em.organization_id=scored.organization_id AND em.person_id=scored.person_id
LEFT JOIN mem ON mem.organization_id=scored.organization_id AND mem.person_id=scored.person_id
LEFT JOIN outcomes ON outcomes.organization_id=scored.organization_id AND outcomes.person_id=scored.person_id
ON CONFLICT(organization_id,person_id) DO UPDATE SET
 score=EXCLUDED.score,relationship_state=EXCLUDED.relationship_state,
 evidence=EXCLUDED.evidence,calculated_at=NOW(),updated_at=NOW()`,[orgId,sessionId]);
    timings.relationshipMs = Date.now()-started;

    started = Date.now();
    await client.query(`${TARGET_CTE},
obs AS (
 SELECT o.organization_id,o.person_id,
   COALESCE(MAX(o.attention_score),0)::float max_attention,
   COALESCE(MAX(CASE o.severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END),0)::int max_severity
 FROM aria_observations o
 JOIN target t ON t.person_id=o.person_id
 WHERE o.organization_id=$1 AND o.status='active' AND(o.expires_at IS NULL OR o.expires_at>NOW())
 GROUP BY o.organization_id,o.person_id
),
fb AS (
 SELECT c.organization_id,c.person_id,COUNT(*)::int total,
   COALESCE(SUM(CASE WHEN c.feedback_type IN('negative','ineffective','did_not_work','wrong_approach','wrong_timing','timing_wrong') THEN -1 ELSE 1 END),0)::float effect
 FROM care_feedback c
 JOIN target t ON t.person_id=c.person_id
 WHERE c.organization_id=$1 AND c.observed_at>=NOW()-INTERVAL '180 days'
 GROUP BY c.organization_id,c.person_id
),
mem AS (
 SELECT pm.organization_id,pm.person_id,COUNT(*)::int memory_count
 FROM person_memory pm JOIN target t ON t.person_id=pm.person_id
 WHERE pm.organization_id=$1 AND pm.active=true
 GROUP BY pm.organization_id,pm.person_id
),
learn AS (
 SELECT DISTINCT ON (l.person_id) l.organization_id,l.person_id,l.learning_key
 FROM aria_learning l JOIN target t ON t.person_id=l.person_id
 WHERE l.organization_id=$1 AND l.learning_type='care_response' AND l.active=true
 ORDER BY l.person_id,l.confidence DESC,l.updated_at DESC
),
features AS (
 SELECT p.organization_id,p.id person_id,
   COALESCE(em.participation_count,0)::int participation_count,
   COALESCE(em.participation_rate,0)::numeric participation_rate,
   COALESCE(em.participation_streak,0)::numeric participation_streak,
   COALESCE(em.trend,0)::numeric trend,
   COALESCE(em.confidence,0)::numeric confidence,
   COALESCE(rs.score,0)::numeric relationship_score,
   COALESCE(mem.memory_count,0)::int memory_count,
   COALESCE(fb.total,0)::int feedback_count,
   COALESCE(fb.effect,0)::numeric feedback_effect,
   COALESCE(obs.max_severity,0)::int max_severity,
   COALESCE(obs.max_attention,0)::numeric max_attention,
   learn.learning_key
 FROM people p
 JOIN target t ON t.person_id=p.id
 LEFT JOIN engagement_metrics em ON em.organization_id=p.organization_id AND em.person_id=p.id
 LEFT JOIN relationship_scores rs ON rs.organization_id=p.organization_id AND rs.person_id=p.id
 LEFT JOIN mem ON mem.organization_id=p.organization_id AND mem.person_id=p.id
 LEFT JOIN fb ON fb.organization_id=p.organization_id AND fb.person_id=p.id
 LEFT JOIN obs ON obs.organization_id=p.organization_id AND obs.person_id=p.id
 LEFT JOIN learn ON learn.organization_id=p.organization_id AND learn.person_id=p.id
 WHERE p.organization_id=$1 AND p.status='active'
),
calc AS (
 SELECT *,
   CASE WHEN participation_count=0 THEN 'new' WHEN participation_count=1 THEN 'onboarding' WHEN participation_count<4 THEN 'developing' ELSE 'established' END lifecycle_state,
   LEAST(100,GREATEST(0,ROUND(45+participation_rate*.3+participation_streak*4+relationship_score*.2)))::int engagement_score,
   LEAST(100,GREATEST(0,ROUND(max_severity*15+max_attention*.5+GREATEST(0,-trend)*20+GREATEST(0,-feedback_effect)*10)))::int attention_score
 FROM features
),
actions AS (
 SELECT *,
  CASE
   WHEN participation_count=0 THEN 'welcome_and_onboard'
   WHEN lifecycle_state='onboarding' THEN 'continue_onboarding'
   WHEN feedback_count>0 AND feedback_effect/feedback_count<-.25 THEN 'adjust_care_approach'
   WHEN trend<-.45 THEN 'thoughtful_check_in'
   WHEN learning_key='negative_response' THEN 'adjust_care_approach'
   WHEN memory_count>0 AND relationship_score>=60 THEN 'strengthen_relationship'
   ELSE NULL
  END next_best_action,
  CASE
   WHEN participation_count=0 THEN 'This person is newly known and deserves an intentional welcome.'
   WHEN lifecycle_state='onboarding' THEN 'This relationship is still forming.'
   WHEN feedback_count>0 AND feedback_effect/feedback_count<-.25 THEN 'Recent human feedback suggests the previous care approach should change.'
   WHEN trend<-.45 THEN 'A meaningful change in the relationship deserves human understanding.'
   WHEN learning_key='negative_response' THEN 'ARIA learned that a recent care approach did not land well.'
   WHEN memory_count>0 AND relationship_score>=60 THEN 'There is meaningful relationship context that can help someone care personally.'
   ELSE NULL
  END action_reason
 FROM calc
)
INSERT INTO people_intelligence(
 organization_id,person_id,lifecycle_state,engagement_score,attention_score,attention_level,
 next_best_action,action_reason,evidence,feature_snapshot,model_version,calculated_at,updated_at
)
SELECT organization_id,person_id,lifecycle_state,engagement_score,attention_score,
 CASE WHEN attention_score>=80 THEN 'critical' WHEN attention_score>=60 THEN 'high' WHEN attention_score>=35 THEN 'medium' ELSE 'low' END,
 next_best_action,action_reason,
 jsonb_build_object(
  'model','care-v2','lifecycle_state',lifecycle_state,'participation_count',participation_count,
  'participation_rate',participation_rate,'participation_streak',participation_streak,'trend',trend,
  'relationship_score',relationship_score,'memory_count',memory_count,
  'active_observation_attention',max_attention,'active_observation_severity',max_severity,
  'human_feedback_count',feedback_count,'learning_signal',learning_key
 ),
 jsonb_build_object(
  'participation_count',participation_count,'participation_rate',participation_rate,
  'participation_streak',participation_streak,'trend',trend,'relationship_score',relationship_score,
  'memory_count',memory_count,'feedback_count',feedback_count
 ),
 'care-v2',NOW(),NOW()
FROM actions
ON CONFLICT(organization_id,person_id) DO UPDATE SET
 lifecycle_state=EXCLUDED.lifecycle_state,engagement_score=EXCLUDED.engagement_score,
 attention_score=EXCLUDED.attention_score,attention_level=EXCLUDED.attention_level,
 next_best_action=EXCLUDED.next_best_action,action_reason=EXCLUDED.action_reason,
 evidence=EXCLUDED.evidence,feature_snapshot=EXCLUDED.feature_snapshot,
 model_version=EXCLUDED.model_version,calculated_at=NOW(),updated_at=NOW()`,[orgId,sessionId]);
    timings.peopleMs = Date.now()-started;

    started = Date.now();
    await client.query(`${TARGET_CTE}
INSERT INTO aria_person_state(
 person_id,organization_id,engagement_state,care_state,relationship_state,
 followup_state,attention_level,open_observation_count,open_action_count,
 last_meaningful_event,lifecycle_state,engagement_score,next_best_action,attention_reason,updated_at
)
SELECT p.id,p.organization_id,
 CASE WHEN pi.lifecycle_state='new' THEN 'first_time' ELSE pi.lifecycle_state END,
 CASE
  WHEN GREATEST(COALESCE(pi.attention_score,0),COALESCE(obs.max_attention,0))>=80 THEN 'urgent_action_required'
  WHEN GREATEST(COALESCE(pi.attention_score,0),COALESCE(obs.max_attention,0))>=60 THEN 'needs_human_review'
  WHEN GREATEST(COALESCE(pi.attention_score,0),COALESCE(obs.max_attention,0))>=35 THEN 'care_opportunity'
  ELSE 'healthy'
 END,
 COALESCE(rs.relationship_state,'known'),
 CASE WHEN pi.next_best_action IS NOT NULL THEN 'recommended' ELSE 'none' END,
 CASE
  WHEN GREATEST(COALESCE(pi.attention_score,0),COALESCE(obs.max_attention,0))>=80 THEN 'critical'
  WHEN GREATEST(COALESCE(pi.attention_score,0),COALESCE(obs.max_attention,0))>=60 THEN 'high'
  WHEN GREATEST(COALESCE(pi.attention_score,0),COALESCE(obs.max_attention,0))>=35 THEN 'medium'
  ELSE 'low'
 END,
 COALESCE(obs.open_count,0),COALESCE(a.open_count,0),
 em.last_meaningful_event,COALESCE(pi.lifecycle_state,'new'),COALESCE(pi.engagement_score,0),
 pi.next_best_action,pi.action_reason,NOW()
FROM people p
JOIN target t ON t.person_id=p.id
LEFT JOIN people_intelligence pi ON pi.organization_id=p.organization_id AND pi.person_id=p.id
LEFT JOIN relationship_scores rs ON rs.organization_id=p.organization_id AND rs.person_id=p.id
LEFT JOIN engagement_metrics em ON em.organization_id=p.organization_id AND em.person_id=p.id
LEFT JOIN (
 SELECT o.organization_id,o.person_id,COUNT(*)::int open_count,COALESCE(MAX(o.attention_score),0)::float max_attention
 FROM aria_observations o
 JOIN target t2 ON t2.person_id=o.person_id
 WHERE o.organization_id=$1 AND o.status='active' AND(o.expires_at IS NULL OR o.expires_at>NOW())
 GROUP BY o.organization_id,o.person_id
) obs ON obs.organization_id=p.organization_id AND obs.person_id=p.id
LEFT JOIN (
 SELECT a.organization_id,a.person_id,COUNT(*)::int open_count
 FROM aria_actions a
 JOIN target t3 ON t3.person_id=a.person_id
 WHERE a.organization_id=$1 AND a.status IN('proposed','approved','executing')
 GROUP BY a.organization_id,a.person_id
) a ON a.organization_id=p.organization_id AND a.person_id=p.id
WHERE p.organization_id=$1 AND p.status='active'
ON CONFLICT(organization_id,person_id) DO UPDATE SET
 engagement_state=EXCLUDED.engagement_state,care_state=EXCLUDED.care_state,
 relationship_state=EXCLUDED.relationship_state,followup_state=EXCLUDED.followup_state,
 attention_level=EXCLUDED.attention_level,open_observation_count=EXCLUDED.open_observation_count,
 open_action_count=EXCLUDED.open_action_count,last_meaningful_event=EXCLUDED.last_meaningful_event,
 lifecycle_state=EXCLUDED.lifecycle_state,engagement_score=EXCLUDED.engagement_score,
 next_best_action=EXCLUDED.next_best_action,attention_reason=EXCLUDED.attention_reason,updated_at=NOW()`,[orgId,sessionId]);
    timings.stateMs = Date.now()-started;

    await client.query('COMMIT');
    return timings;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

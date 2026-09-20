-- Durable attendance intelligence for NYEOCARE.
-- The user-facing attendance close is atomic; ARIA work is durable and asynchronous.
CREATE EXTENSION IF NOT EXISTS pgmq;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

DO $queue$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pgmq.list_queues() WHERE queue_name='nyeocare-attendance') THEN
    PERFORM pgmq.create('nyeocare-attendance');
  END IF;
END
$queue$;

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS aria_processing_stage text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS aria_processing_progress integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS aria_processing_processed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS aria_processing_total integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS aria_processing_heartbeat_at timestamptz;

ALTER TABLE public.sessions DROP CONSTRAINT IF EXISTS sessions_aria_processing_progress_check;
ALTER TABLE public.sessions
  ADD CONSTRAINT sessions_aria_processing_progress_check
  CHECK (aria_processing_progress BETWEEN 0 AND 100);

CREATE INDEX IF NOT EXISTS sessions_org_background_processing_idx
ON public.sessions(organization_id,closed_at DESC)
WHERE status='closed' AND aria_processing_status IN('pending','processing');

CREATE OR REPLACE FUNCTION public.nyeocare_attendance_stage(p_session_id uuid, p_org_id text, p_stage text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session record;
  v_present integer := 0;
  v_active integer := 0;
  v_target integer := 0;
  v_returning integer := 0;
  v_absence integer := 0;
  v_stage text := lower(trim(p_stage));
  v_progress integer;
  v_started timestamptz := clock_timestamp();
BEGIN
  SELECT id,name,service_type,started_at,status
  INTO v_session
  FROM public.sessions
  WHERE id=p_session_id AND organization_id=p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attendance session not found.';
  END IF;

  IF v_session.status <> 'closed' THEN
    RAISE EXCEPTION 'Attendance session must be closed before ARIA processing.';
  END IF;

  SELECT COUNT(*)::int INTO v_active
  FROM public.people
  WHERE organization_id=p_org_id AND COALESCE(status,'active')='active';

  SELECT COUNT(*)::int INTO v_present
  FROM public.attendance_records
  WHERE organization_id=p_org_id AND session_id=p_session_id
    AND present=true AND confirmed=true;

  UPDATE public.sessions
  SET aria_processing_status='processing',
      aria_processing_stage=v_stage,
      aria_processing_total=GREATEST(v_active,1),
      aria_processing_processed=CASE
        WHEN v_stage='persist' THEN v_present
        ELSE aria_processing_processed END,
      aria_processing_heartbeat_at=NOW(),
      aria_processing_error=NULL
  WHERE id=p_session_id AND organization_id=p_org_id;

  IF v_stage='persist' THEN
    UPDATE public.attendance_records
    SET confirmed=true, reviewed_at=COALESCE(reviewed_at,NOW())
    WHERE organization_id=p_org_id AND session_id=p_session_id
      AND present=true AND confirmed=false;

    INSERT INTO public.participation_records(
      organization_id,person_id,session_id,participation_type,value,occurred_at
    )
    SELECT p_org_id,ar.people_id,p_session_id,'attendance',
           jsonb_build_object('present',true,'source','attendance_confirmation'),
           COALESCE(ar.marked_at,v_session.started_at,ar.attendance_date::timestamptz)
    FROM public.attendance_records ar
    JOIN public.people p ON p.id=ar.people_id AND p.organization_id=ar.organization_id
    WHERE ar.organization_id=p_org_id AND ar.session_id=p_session_id
      AND ar.present=true AND ar.confirmed=true
      AND COALESCE(p.status,'active')<>'merged'
    ON CONFLICT (organization_id,person_id,session_id,participation_type)
      WHERE participation_type='attendance' DO NOTHING;

    INSERT INTO public.aria_events(
      organization_id,person_id,type,actor_id,source,event_key,metadata,occurred_at
    )
    SELECT p_org_id,pr.person_id,'PARTICIPATION_CONFIRMED',NULL,'attendance',
           'participation:'||pr.id||':confirmed',
           jsonb_build_object('session_id',p_session_id,'participation_id',pr.id),
           NOW()
    FROM public.participation_records pr
    WHERE pr.organization_id=p_org_id AND pr.session_id=p_session_id
      AND pr.participation_type='attendance'
    ON CONFLICT (organization_id,event_key) DO NOTHING;

    SELECT COUNT(*)::int INTO v_target
    FROM public.attendance_records
    WHERE organization_id=p_org_id AND session_id=p_session_id
      AND present=true AND confirmed=true;

    v_progress:=10;

  ELSIF v_stage='return_signals' THEN
    WITH returners AS (
      SELECT DISTINCT pr.person_id
      FROM public.participation_records pr
      WHERE pr.organization_id=p_org_id AND pr.session_id=p_session_id
        AND pr.participation_type='attendance'
        AND (
          EXISTS (
            SELECT 1 FROM public.aria_observations o
            WHERE o.organization_id=p_org_id AND o.person_id=pr.person_id
              AND o.type='UNUSUAL_ABSENCE' AND o.status='active'
              AND COALESCE(o.metadata->>'session_id','')<>p_session_id::text
          )
          OR EXISTS (
            SELECT 1 FROM public.aria_actions a
            WHERE a.organization_id=p_org_id AND a.person_id=pr.person_id
              AND a.status IN('proposed','approved')
              AND a.action_metadata->>'kind' IN('attendance_absence_check_in','first_session_check_in')
              AND COALESCE(a.action_metadata->>'session_id','')<>p_session_id::text
          )
        )
    )
    SELECT COUNT(*)::int INTO v_returning FROM returners;

    INSERT INTO public.aria_observations(
      organization_id,person_id,type,confidence,severity,urgency,attention_score,
      evidence,metadata,detected_at,status
    )
    SELECT p_org_id,r.person_id,'RETURNED_AFTER_ABSENCE',1,'low','low',16,
      jsonb_build_object(
        'sources',jsonb_build_array('attendance'),
        'facts',jsonb_build_array('Person was recorded as present after a previous absence signal.'),
        'inference','The person returned after previously being absent; no reason for the earlier absence is assumed.',
        'session_id',p_session_id::text
      ),
      jsonb_build_object(
        'source_event_id','attendance:'||p_session_id||':return:'||r.person_id,
        'session_id',p_session_id::text
      ),
      NOW(),'active'
    FROM (
      SELECT DISTINCT pr.person_id
      FROM public.participation_records pr
      WHERE pr.organization_id=p_org_id AND pr.session_id=p_session_id
        AND pr.participation_type='attendance'
        AND (
          EXISTS (
            SELECT 1 FROM public.aria_observations o
            WHERE o.organization_id=p_org_id AND o.person_id=pr.person_id
              AND o.type='UNUSUAL_ABSENCE' AND o.status='active'
              AND COALESCE(o.metadata->>'session_id','')<>p_session_id::text
          )
          OR EXISTS (
            SELECT 1 FROM public.aria_actions a
            WHERE a.organization_id=p_org_id AND a.person_id=pr.person_id
              AND a.status IN('proposed','approved')
              AND a.action_metadata->>'kind' IN('attendance_absence_check_in','first_session_check_in')
              AND COALESCE(a.action_metadata->>'session_id','')<>p_session_id::text
          )
        )
    ) r
    ON CONFLICT DO NOTHING;

    UPDATE public.aria_attendance_contexts ac
    SET resolved_at=NOW()
    WHERE ac.organization_id=p_org_id
      AND ac.session_id<>p_session_id
      AND ac.resolved_at IS NULL
      AND EXISTS (
        SELECT 1 FROM public.participation_records pr
        WHERE pr.organization_id=p_org_id AND pr.person_id=ac.person_id
          AND pr.session_id=p_session_id AND pr.participation_type='attendance'
      );

    UPDATE public.aria_observations o
    SET status='resolved',resolved_at=NOW()
    WHERE o.organization_id=p_org_id
      AND o.type='UNUSUAL_ABSENCE' AND o.status='active'
      AND COALESCE(o.metadata->>'session_id','')<>p_session_id::text
      AND EXISTS (
        SELECT 1 FROM public.participation_records pr
        WHERE pr.organization_id=p_org_id AND pr.person_id=o.person_id
          AND pr.session_id=p_session_id AND pr.participation_type='attendance'
      );

    UPDATE public.aria_actions a
    SET status='cancelled',
        failure_reason='Person returned; previous attendance follow-up is no longer current.',
        updated_at=NOW()
    WHERE a.organization_id=p_org_id
      AND a.status IN('proposed','approved')
      AND a.action_metadata->>'kind' IN('attendance_absence_check_in','first_session_check_in')
      AND COALESCE(a.action_metadata->>'session_id','')<>p_session_id::text
      AND EXISTS (
        SELECT 1 FROM public.participation_records pr
        WHERE pr.organization_id=p_org_id AND pr.person_id=a.person_id
          AND pr.session_id=p_session_id AND pr.participation_type='attendance'
      );

    INSERT INTO public.aria_actions(
      organization_id,person_id,observation_id,type,status,priority,action_metadata,action_key
    )
    SELECT o.organization_id,o.person_id,o.id,'SEND_MESSAGE','proposed','low',
      jsonb_build_object(
        'kind','returned_after_absence',
        'channel','whatsapp',
        'summary',COALESCE(NULLIF(p.first_name,''),'This person')||' is back after being away.',
        'knowledge','ARIA knows only that the person returned after a previous absence signal.',
        'suggestion','Review the suggested personal welcome-back message.',
        'personalized',false,'draft_required',true,
        'requires_human_approval',true,'notify_organization',true,
        'draft_message','Welcome back, '||COALESCE(NULLIF(TRIM(p.first_name||' '||p.last_name),''),'there')||'. It is good to see you today. Hope you had a good week.',
        'session_id',o.metadata->>'session_id'
      ),
      'attendance:return_after_absence:'||(o.metadata->>'session_id')||':'||o.person_id,
      NOW()
    FROM public.aria_observations o
    JOIN public.people p ON p.id=o.person_id AND p.organization_id=o.organization_id
    WHERE o.organization_id=p_org_id AND o.type='RETURNED_AFTER_ABSENCE'
      AND o.metadata->>'session_id'=p_session_id::text
    ON CONFLICT (organization_id,action_key) DO NOTHING;

    v_progress:=25;

  ELSIF v_stage='absence_signals' THEN
    WITH history AS (
      SELECT pr.person_id,
        COUNT(*) FILTER (
          WHERE pr.occurred_at>=v_session.started_at-INTERVAL '84 days'
            AND pr.occurred_at<v_session.started_at
        )::int prior_84,
        COUNT(*) FILTER (
          WHERE pr.occurred_at>=v_session.started_at-INTERVAL '28 days'
            AND pr.occurred_at<v_session.started_at
        )::int prior_28,
        MAX(pr.occurred_at) FILTER (WHERE pr.occurred_at<v_session.started_at) prior_last
      FROM public.participation_records pr
      WHERE pr.organization_id=p_org_id
        AND pr.occurred_at>=v_session.started_at-INTERVAL '84 days'
        AND pr.occurred_at<v_session.started_at
      GROUP BY pr.person_id
    ),
    latest AS (
      SELECT
        v_session.id,
        v_session.name,
        v_session.service_type,
        v_session.started_at,
        COALESCE(NULLIF(v_session.service_type,''),
          'weekday:'||EXTRACT(ISODOW FROM v_session.started_at)::int::text) service_key
    ),
    candidates AS (
      SELECT p.id person_id,h.prior_84,h.prior_28,h.prior_last,
        COALESCE(rs.score,0)::numeric relationship_score,
        (h.prior_28*20+LEAST(h.prior_84,8)*5+COALESCE(rs.score,0)*.4)::numeric priority_score,
        latest.id session_id,latest.name session_name,latest.service_type
      FROM public.people p
      JOIN history h ON h.person_id=p.id
      CROSS JOIN latest
      LEFT JOIN public.relationship_scores rs
        ON rs.organization_id=p.organization_id AND rs.person_id=p.id
      WHERE p.organization_id=p_org_id AND p.status='active'
        AND h.prior_84>=2 AND h.prior_28>=1
        AND NOT EXISTS(
          SELECT 1 FROM public.attendance_records ar
          WHERE ar.organization_id=p_org_id AND ar.people_id=p.id
            AND ar.session_id=p_session_id AND ar.present=true AND ar.confirmed=true
        )
        AND NOT EXISTS(
          SELECT 1 FROM public.aria_attendance_contexts ac
          WHERE ac.organization_id=p_org_id AND ac.person_id=p.id AND ac.session_id=p_session_id
        )
        AND NOT EXISTS(
          SELECT 1 FROM public.aria_care_contexts c
          WHERE c.organization_id=p_org_id AND c.person_id=p.id
            AND c.kind IN('travel','temporary_unavailable','not_attending')
            AND (c.ends_on IS NULL OR c.ends_on>CURRENT_DATE)
        )
        AND NOT EXISTS(
          SELECT 1 FROM public.aria_care_contexts c
          WHERE c.organization_id=p_org_id AND c.person_id=p.id
            AND c.kind='preferred_service' AND c.ends_on IS NULL
            AND c.service_type IS NOT NULL AND c.service_type<>latest.service_key
        )
      ORDER BY priority_score DESC,prior_last DESC NULLS LAST,p.id
      LIMIT 50
    )
    INSERT INTO public.aria_observations(
      organization_id,person_id,type,confidence,severity,urgency,attention_score,
      evidence,metadata,detected_at,expires_at,status
    )
    SELECT p_org_id,c.person_id,'UNUSUAL_ABSENCE',1,'low','low',16,
      jsonb_build_object(
        'sources',jsonb_build_array('attendance'),
        'facts',jsonb_build_array('Person was not recorded as present in this completed session.'),
        'inference','This is an attendance-change signal grounded in the person''s recent confirmed history, not a claim that anything is wrong.',
        'session_id',c.session_id,'session_name',c.session_name,'service_type',c.service_type,
        'prior_attendance_84d',c.prior_84,'recent_attendance_28d',c.prior_28,'last_attended_at',c.prior_last
      ),
      jsonb_build_object(
        'source_event_id','attendance:'||p_session_id||':absence:'||c.person_id,
        'session_id',p_session_id::text
      ),
      NOW(),NOW()+INTERVAL '14 days','active'
    FROM candidates c
    ON CONFLICT DO NOTHING;

    INSERT INTO public.aria_actions(
      organization_id,person_id,observation_id,type,status,priority,action_metadata,action_key
    )
    SELECT o.organization_id,o.person_id,o.id,'SEND_MESSAGE','proposed','medium',
      jsonb_build_object(
        'kind','attendance_absence_check_in',
        'reason','ARIA noticed this person was not observed in a completed session after recent confirmed attendance.',
        'summary',COALESCE(NULLIF(p.first_name,''),'This person')||' wasn''t recorded at '||COALESCE(o.evidence->>'session_name','the latest gathering')||'.',
        'knowledge','The signal is based on confirmed attendance history. ARIA does not know the reason for the absence.',
        'suggestion','Review a simple check-in before taking any further action.',
        'requires_human_approval',true,'draft_required',true,'channel','whatsapp',
        'pattern_claim',false,'session_id',o.metadata->>'session_id',
        'session_name',o.evidence->>'session_name','service_type',o.evidence->>'service_type',
        'prior_attendance_84d',NULLIF(o.evidence->>'prior_attendance_84d','')::int,
        'recent_attendance_28d',NULLIF(o.evidence->>'recent_attendance_28d','')::int,
        'last_attended_at',o.evidence->>'last_attended_at'
      ),
      'attendance:absence_check_in:'||(o.metadata->>'session_id')||':'||o.person_id
    FROM public.aria_observations o
    JOIN public.people p ON p.id=o.person_id AND p.organization_id=o.organization_id
    WHERE o.organization_id=p_org_id AND o.type='UNUSUAL_ABSENCE'
      AND o.metadata->>'session_id'=p_session_id::text
    ON CONFLICT (organization_id,action_key) DO NOTHING;

    SELECT COUNT(*)::int INTO v_absence
    FROM public.aria_observations
    WHERE organization_id=p_org_id AND type='UNUSUAL_ABSENCE'
      AND metadata->>'session_id'=p_session_id::text;

    v_progress:=40;

  ELSIF v_stage='engagement' THEN
    WITH target AS (
      SELECT DISTINCT ar.people_id person_id
      FROM public.attendance_records ar
      WHERE ar.organization_id=p_org_id AND ar.session_id=p_session_id
        AND ar.present=true AND ar.confirmed=true
      UNION
      SELECT DISTINCT o.person_id
      FROM public.aria_observations o
      WHERE o.organization_id=p_org_id AND o.person_id IS NOT NULL
        AND o.metadata->>'session_id'=p_session_id::text AND o.status='active'
    ),
    history AS (
      SELECT pr.person_id,COUNT(*)::int participation_count,
        MIN(pr.occurred_at) first_seen,MAX(pr.occurred_at) last_seen,
        COUNT(*) FILTER (WHERE pr.occurred_at>=NOW()-INTERVAL '28 days')::int recent_count,
        COUNT(*) FILTER (WHERE pr.occurred_at>=NOW()-INTERVAL '56 days' AND pr.occurred_at<NOW()-INTERVAL '28 days')::int prior_count,
        COUNT(*) FILTER (WHERE pr.occurred_at>=NOW()-INTERVAL '84 days')::int baseline_count
      FROM public.participation_records pr JOIN target t ON t.person_id=pr.person_id
      WHERE pr.organization_id=p_org_id GROUP BY pr.person_id
    ),
    weeks AS (
      SELECT pr.person_id,
        FLOOR(EXTRACT(EPOCH FROM (NOW()-pr.occurred_at))/604800)::int week_index
      FROM public.participation_records pr JOIN target t ON t.person_id=pr.person_id
      WHERE pr.organization_id=p_org_id AND pr.occurred_at>=NOW()-INTERVAL '84 days'
      GROUP BY pr.person_id,FLOOR(EXTRACT(EPOCH FROM (NOW()-pr.occurred_at))/604800)::int
    ),
    week_stats AS (
      SELECT person_id,COUNT(*)::int baseline_weeks FROM weeks GROUP BY person_id
    ),
    streak AS (
      SELECT t.person_id,
        CASE WHEN EXISTS(SELECT 1 FROM weeks w0 WHERE w0.person_id=t.person_id AND w0.week_index=0)
          THEN COALESCE(MIN(gs.n) FILTER (WHERE w.week_index IS NULL),12) ELSE 0 END::int participation_streak
      FROM target t CROSS JOIN generate_series(0,12) gs(n)
      LEFT JOIN weeks w ON w.person_id=t.person_id AND w.week_index=gs.n
      GROUP BY t.person_id
    ),
    metrics AS (
      SELECT t.person_id,COALESCE(h.participation_count,0)::int participation_count,
        COALESCE(ws.baseline_weeks,0)::int baseline_weeks,
        COALESCE(s.participation_streak,0)::int participation_streak,
        h.first_seen,h.last_seen,COALESCE(h.recent_count,0)::int recent_count,
        COALESCE(h.prior_count,0)::int prior_count,COALESCE(h.baseline_count,0)::int baseline_count
      FROM target t LEFT JOIN history h ON h.person_id=t.person_id
      LEFT JOIN week_stats ws ON ws.person_id=t.person_id LEFT JOIN streak s ON s.person_id=t.person_id
    ),
    calc AS (
      SELECT *,
        (baseline_weeks::numeric/LEAST(12,GREATEST(1,CEIL(EXTRACT(EPOCH FROM (NOW()-COALESCE(first_seen,NOW())))/604800))))*100 participation_rate_raw,
        baseline_count::numeric/12 baseline_frequency,recent_count::numeric/4 recent_frequency,
        prior_count::numeric/4 prior_frequency,
        FLOOR(EXTRACT(EPOCH FROM (NOW()-COALESCE(last_seen,NOW())))/604800)::int inactivity_streak_raw
      FROM metrics
    ),
    final AS (
      SELECT *,
        LEAST(100,GREATEST(0,ROUND(participation_rate_raw)))::int participation_rate,
        LEAST(1,GREATEST(-1,CASE WHEN prior_frequency=0 THEN CASE WHEN recent_frequency>0 THEN 1 ELSE 0 END ELSE (recent_frequency-prior_frequency)/prior_frequency END)) trend,
        LEAST(1,GREATEST(-1,(recent_frequency-GREATEST(0.25,baseline_frequency))/GREATEST(0.25,baseline_frequency))) deviation,
        LEAST(1,GREATEST(0,participation_count::numeric/8)) confidence,
        LEAST(100,GREATEST(0,inactivity_streak_raw)) inactivity_streak
      FROM calc
    )
    INSERT INTO public.engagement_metrics(
      organization_id,person_id,participation_count,participation_rate,participation_streak,
      inactivity_streak,baseline_frequency,recent_frequency,trend,deviation,
      first_seen,last_seen,last_meaningful_event,confidence,evidence,calculated_at,updated_at
    )
    SELECT p_org_id,person_id,participation_count,participation_rate,participation_streak,
      inactivity_streak::int,baseline_frequency,recent_frequency,trend,deviation,
      first_seen,last_seen,last_seen,confidence,
      jsonb_build_object(
        'sample_size',participation_count,'baseline_days',84,'recent_days',28,
        'days_since_last',GREATEST(0,FLOOR(EXTRACT(EPOCH FROM (NOW()-COALESCE(last_seen,NOW())))/86400))::int,
        'baseline_frequency',baseline_frequency,'recent_frequency',recent_frequency,'prior_frequency',prior_frequency,
        'trend',trend,'deviation',deviation,'participation_streak',participation_streak,'inactivity_streak',inactivity_streak
      ),NOW(),NOW()
    FROM final
    ON CONFLICT(organization_id,person_id) DO UPDATE SET
      participation_count=EXCLUDED.participation_count,participation_rate=EXCLUDED.participation_rate,
      participation_streak=EXCLUDED.participation_streak,inactivity_streak=EXCLUDED.inactivity_streak,
      baseline_frequency=EXCLUDED.baseline_frequency,recent_frequency=EXCLUDED.recent_frequency,
      trend=EXCLUDED.trend,deviation=EXCLUDED.deviation,first_seen=EXCLUDED.first_seen,last_seen=EXCLUDED.last_seen,
      last_meaningful_event=EXCLUDED.last_meaningful_event,confidence=EXCLUDED.confidence,evidence=EXCLUDED.evidence,
      calculated_at=NOW(),updated_at=NOW();

    v_progress:=55;

  ELSIF v_stage='relationship' THEN
    WITH target AS (
      SELECT DISTINCT ar.people_id person_id
      FROM public.attendance_records ar
      WHERE ar.organization_id=p_org_id AND ar.session_id=p_session_id AND ar.present=true AND ar.confirmed=true
      UNION
      SELECT DISTINCT o.person_id FROM public.aria_observations o
      WHERE o.organization_id=p_org_id AND o.person_id IS NOT NULL
        AND o.metadata->>'session_id'=p_session_id::text AND o.status='active'
    ),
    mem AS (
      SELECT pm.organization_id,pm.person_id,COUNT(*)::int memory_count
      FROM public.person_memory pm JOIN target t ON t.person_id=pm.person_id
      WHERE pm.organization_id=p_org_id AND pm.active=true GROUP BY pm.organization_id,pm.person_id
    ),
    outcomes AS (
      SELECT io.organization_id,io.person_id,
        COUNT(*) FILTER (WHERE io.outcome IN('positive','helpful','worked','returned','became_regular','relationship_strengthened'))::int positive_count,
        COUNT(*) FILTER (WHERE io.outcome IN('negative','ineffective','did_not_work','unsuccessful','no_response'))::int negative_count
      FROM public.intelligence_outcomes io JOIN target t ON t.person_id=io.person_id
      WHERE io.organization_id=p_org_id GROUP BY io.organization_id,io.person_id
    ),
    scored AS (
      SELECT p.organization_id,p.id person_id,
        LEAST(100,GREATEST(0,ROUND(
          35+LEAST(25,COALESCE(em.participation_rate,0)*.25)+LEAST(15,COALESCE(em.participation_streak,0)*3)+
          LEAST(10,COALESCE(mem.memory_count,0)*2)+LEAST(10,COALESCE(outcomes.positive_count,0)*2)-
          LEAST(8,COALESCE(outcomes.negative_count,0)*2)+GREATEST(-5,LEAST(5,COALESCE(em.trend,0)*5))
        )))::int score
      FROM public.people p JOIN target t ON t.person_id=p.id
      LEFT JOIN public.engagement_metrics em ON em.organization_id=p.organization_id AND em.person_id=p.id
      LEFT JOIN mem ON mem.organization_id=p.organization_id AND mem.person_id=p.id
      LEFT JOIN outcomes ON outcomes.organization_id=p.organization_id AND outcomes.person_id=p.id
      WHERE p.organization_id=p_org_id AND p.status='active'
    )
    INSERT INTO public.relationship_scores(organization_id,person_id,score,relationship_state,evidence,calculated_at,updated_at)
    SELECT scored.organization_id,scored.person_id,scored.score,
      CASE WHEN scored.score>=80 THEN 'strong' WHEN score>=60 THEN 'healthy' WHEN score>=40 THEN 'developing' ELSE 'known' END,
      jsonb_build_object(
        'participation_rate',COALESCE(em.participation_rate,0),'participation_streak',COALESCE(em.participation_streak,0),
        'memory_count',COALESCE(mem.memory_count,0),'positive_outcomes',COALESCE(outcomes.positive_count,0),
        'negative_outcomes',COALESCE(outcomes.negative_count,0),'trend',COALESCE(em.trend,0),'confidence',COALESCE(em.confidence,0)
      ),NOW(),NOW()
    FROM scored
    JOIN public.engagement_metrics em ON em.organization_id=scored.organization_id AND em.person_id=scored.person_id
    LEFT JOIN mem ON mem.organization_id=scored.organization_id AND mem.person_id=scored.person_id
    LEFT JOIN outcomes ON outcomes.organization_id=scored.organization_id AND outcomes.person_id=scored.person_id
    ON CONFLICT(organization_id,person_id) DO UPDATE SET
      score=EXCLUDED.score,relationship_state=EXCLUDED.relationship_state,evidence=EXCLUDED.evidence,
      calculated_at=NOW(),updated_at=NOW();

    v_progress:=70;

  ELSIF v_stage='people_intelligence' THEN
    WITH target AS (
      SELECT DISTINCT ar.people_id person_id
      FROM public.attendance_records ar
      WHERE ar.organization_id=p_org_id AND ar.session_id=p_session_id AND ar.present=true AND ar.confirmed=true
      UNION
      SELECT DISTINCT o.person_id FROM public.aria_observations o
      WHERE o.organization_id=p_org_id AND o.person_id IS NOT NULL
        AND o.metadata->>'session_id'=p_session_id::text AND o.status='active'
    ),
    obs AS (
      SELECT o.organization_id,o.person_id,COALESCE(MAX(o.attention_score),0)::float max_attention,
        COALESCE(MAX(CASE o.severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END),0)::int max_severity
      FROM public.aria_observations o JOIN target t ON t.person_id=o.person_id
      WHERE o.organization_id=p_org_id AND o.status='active' AND(o.expires_at IS NULL OR o.expires_at>NOW())
      GROUP BY o.organization_id,o.person_id
    ),
    fb AS (
      SELECT c.organization_id,c.person_id,COUNT(*)::int total,
        COALESCE(SUM(CASE WHEN c.feedback_type IN('negative','ineffective','did_not_work','wrong_approach','wrong_timing','timing_wrong') THEN -1 ELSE 1 END),0)::float effect
      FROM public.care_feedback c JOIN target t ON t.person_id=c.person_id
      WHERE c.organization_id=p_org_id AND c.observed_at>=NOW()-INTERVAL '180 days'
      GROUP BY c.organization_id,c.person_id
    ),
    mem AS (
      SELECT pm.organization_id,pm.person_id,COUNT(*)::int memory_count
      FROM public.person_memory pm JOIN target t ON t.person_id=pm.person_id
      WHERE pm.organization_id=p_org_id AND pm.active=true GROUP BY pm.organization_id,pm.person_id
    ),
    learn AS (
      SELECT DISTINCT ON (l.person_id) l.organization_id,l.person_id,l.learning_key
      FROM public.aria_learning l JOIN target t ON t.person_id=l.person_id
      WHERE l.organization_id=p_org_id AND l.learning_type='care_response' AND l.active=true
      ORDER BY l.person_id,l.confidence DESC,l.updated_at DESC
    ),
    features AS (
      SELECT p.organization_id,p.id person_id,COALESCE(em.participation_count,0)::int participation_count,
        COALESCE(em.participation_rate,0)::numeric participation_rate,COALESCE(em.participation_streak,0)::numeric participation_streak,
        COALESCE(em.trend,0)::numeric trend,COALESCE(em.confidence,0)::numeric confidence,
        COALESCE(rs.score,0)::numeric relationship_score,COALESCE(mem.memory_count,0)::int memory_count,
        COALESCE(fb.total,0)::int feedback_count,COALESCE(fb.effect,0)::numeric feedback_effect,
        COALESCE(obs.max_severity,0)::int max_severity,COALESCE(obs.max_attention,0)::numeric max_attention,learn.learning_key
      FROM public.people p JOIN target t ON t.person_id=p.id
      LEFT JOIN public.engagement_metrics em ON em.organization_id=p.organization_id AND em.person_id=p.id
      LEFT JOIN public.relationship_scores rs ON rs.organization_id=p.organization_id AND rs.person_id=p.id
      LEFT JOIN mem ON mem.organization_id=p.organization_id AND mem.person_id=p.id
      LEFT JOIN fb ON fb.organization_id=p.organization_id AND fb.person_id=p.id
      LEFT JOIN obs ON obs.organization_id=p.organization_id AND obs.person_id=p.id
      LEFT JOIN learn ON learn.organization_id=p.organization_id AND learn.person_id=p.id
      WHERE p.organization_id=p_org_id AND p.status='active'
    ),
    calc AS (
      SELECT *,
        CASE WHEN participation_count=0 THEN 'new' WHEN participation_count=1 THEN 'onboarding'
             WHEN participation_count<4 THEN 'developing' ELSE 'established' END lifecycle_state,
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
          ELSE NULL END next_best_action,
        CASE
          WHEN participation_count=0 THEN 'This person is newly known and deserves an intentional welcome.'
          WHEN lifecycle_state='onboarding' THEN 'This relationship is still forming.'
          WHEN feedback_count>0 AND feedback_effect/feedback_count<-.25 THEN 'Recent human feedback suggests the previous care approach should change.'
          WHEN trend<-.45 THEN 'A meaningful change in the relationship deserves human understanding.'
          WHEN learning_key='negative_response' THEN 'ARIA learned that a recent care approach did not land well.'
          WHEN memory_count>0 AND relationship_score>=60 THEN 'There is meaningful relationship context that can help someone care personally.'
          ELSE NULL END action_reason
      FROM calc
    )
    INSERT INTO public.people_intelligence(
      organization_id,person_id,lifecycle_state,engagement_score,attention_score,attention_level,
      next_best_action,action_reason,evidence,feature_snapshot,model_version,calculated_at,updated_at
    )
    SELECT organization_id,person_id,lifecycle_state,engagement_score,attention_score,
      CASE WHEN attention_score>=80 THEN 'critical' WHEN attention_score>=60 THEN 'high'
           WHEN attention_score>=35 THEN 'medium' ELSE 'low' END,
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
      model_version=EXCLUDED.model_version,calculated_at=NOW(),updated_at=NOW();

    v_progress:=85;

  ELSIF v_stage='person_state' THEN
    WITH target AS (
      SELECT DISTINCT ar.people_id person_id
      FROM public.attendance_records ar
      WHERE ar.organization_id=p_org_id AND ar.session_id=p_session_id AND ar.present=true AND ar.confirmed=true
      UNION
      SELECT DISTINCT o.person_id FROM public.aria_observations o
      WHERE o.organization_id=p_org_id AND o.person_id IS NOT NULL
        AND o.metadata->>'session_id'=p_session_id::text AND o.status='active'
    ),
    obs AS (
      SELECT o.organization_id,o.person_id,COUNT(*)::int open_count,COALESCE(MAX(o.attention_score),0)::float max_attention
      FROM public.aria_observations o JOIN target t ON t.person_id=o.person_id
      WHERE o.organization_id=p_org_id AND o.status='active' AND(o.expires_at IS NULL OR o.expires_at>NOW())
      GROUP BY o.organization_id,o.person_id
    ),
    actions AS (
      SELECT a.organization_id,a.person_id,COUNT(*)::int open_count
      FROM public.aria_actions a JOIN target t ON t.person_id=a.person_id
      WHERE a.organization_id=p_org_id AND a.status IN('proposed','approved','executing')
      GROUP BY a.organization_id,a.person_id
    )
    INSERT INTO public.aria_person_state(
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
        ELSE 'healthy' END,
      COALESCE(rs.relationship_state,'known'),
      CASE WHEN pi.next_best_action IS NOT NULL THEN 'recommended' ELSE 'none' END,
      CASE
        WHEN GREATEST(COALESCE(pi.attention_score,0),COALESCE(obs.max_attention,0))>=80 THEN 'critical'
        WHEN GREATEST(COALESCE(pi.attention_score,0),COALESCE(obs.max_attention,0))>=60 THEN 'high'
        WHEN GREATEST(COALESCE(pi.attention_score,0),COALESCE(obs.max_attention,0))>=35 THEN 'medium'
        ELSE 'low' END,
      COALESCE(obs.open_count,0),COALESCE(actions.open_count,0),
      em.last_meaningful_event,COALESCE(pi.lifecycle_state,'new'),COALESCE(pi.engagement_score,0),
      pi.next_best_action,pi.action_reason,NOW()
    FROM public.people p JOIN target t ON t.person_id=p.id
    LEFT JOIN public.people_intelligence pi ON pi.organization_id=p.organization_id AND pi.person_id=p.id
    LEFT JOIN public.relationship_scores rs ON rs.organization_id=p.organization_id AND rs.person_id=p.id
    LEFT JOIN public.engagement_metrics em ON em.organization_id=p.organization_id AND em.person_id=p.id
    LEFT JOIN obs ON obs.organization_id=p.organization_id AND obs.person_id=p.id
    LEFT JOIN actions ON actions.organization_id=p.organization_id AND actions.person_id=p.id
    WHERE p.organization_id=p_org_id AND p.status='active'
    ON CONFLICT(organization_id,person_id) DO UPDATE SET
      engagement_state=EXCLUDED.engagement_state,care_state=EXCLUDED.care_state,
      relationship_state=EXCLUDED.relationship_state,followup_state=EXCLUDED.followup_state,
      attention_level=EXCLUDED.attention_level,open_observation_count=EXCLUDED.open_observation_count,
      open_action_count=EXCLUDED.open_action_count,last_meaningful_event=EXCLUDED.last_meaningful_event,
      lifecycle_state=EXCLUDED.lifecycle_state,engagement_score=EXCLUDED.engagement_score,
      next_best_action=EXCLUDED.next_best_action,attention_reason=EXCLUDED.attention_reason,updated_at=NOW();

    v_progress:=95;

  ELSIF v_stage='complete' THEN
    UPDATE public.sessions
    SET aria_processing_status='completed',
        aria_processing_stage='complete',
        aria_processing_progress=100,
        aria_processing_processed=aria_processing_total,
        aria_processing_heartbeat_at=NOW(),
        aria_processing_completed_at=NOW(),
        aria_processing_error=NULL
    WHERE id=p_session_id AND organization_id=p_org_id AND status='closed';

    RETURN jsonb_build_object(
      'session_id',p_session_id,'stage',v_stage,'progress',100,
      'duration_ms',ROUND(EXTRACT(EPOCH FROM (clock_timestamp()-v_started))*1000)::int
    );
  ELSE
    RAISE EXCEPTION 'Unknown attendance processing stage: %',v_stage;
  END IF;

  UPDATE public.sessions
  SET aria_processing_status='processing',
      aria_processing_stage=v_stage,
      aria_processing_progress=v_progress,
      aria_processing_processed=CASE
        WHEN v_stage IN('persist','engagement','relationship','people_intelligence','person_state') THEN
          GREATEST(v_present,v_target)
        ELSE aria_processing_processed END,
      aria_processing_heartbeat_at=NOW(),
      aria_processing_error=NULL
  WHERE id=p_session_id AND organization_id=p_org_id AND status='closed';

  RETURN jsonb_build_object(
    'session_id',p_session_id,'stage',v_stage,'progress',v_progress,
    'present',v_present,'target',GREATEST(v_target,v_present),
    'returning',v_returning,'absence',v_absence,
    'duration_ms',ROUND(EXTRACT(EPOCH FROM (clock_timestamp()-v_started))*1000)::int
  );
END
$function$

CREATE OR REPLACE FUNCTION public.nyeocare_process_attendance_queue(p_batch_size integer DEFAULT 2)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_message record;
  v_msg jsonb;
  v_session uuid;
  v_org text;
  v_stage text;
  v_next text;
  v_processed integer := 0;
  v_delay integer;
  v_job_lock bigint := hashtextextended('nyeocare-attendance-worker',0);
BEGIN
  IF NOT pg_try_advisory_xact_lock(v_job_lock) THEN
    RETURN 0;
  END IF;

  FOR v_message IN
    SELECT * FROM pgmq.read(
      'nyeocare-attendance',
      300,
      GREATEST(1,LEAST(5,p_batch_size))
    )
  LOOP
    v_msg:=v_message.message;
    v_session:=NULLIF(v_msg->>'session_id','')::uuid;
    v_org:=NULLIF(v_msg->>'organization_id','');
    v_stage:=COALESCE(NULLIF(v_msg->>'stage',''),'persist');

    BEGIN
      IF v_session IS NULL OR v_org IS NULL THEN
        PERFORM pgmq.delete('nyeocare-attendance',v_message.msg_id);
        CONTINUE;
      END IF;

      UPDATE public.sessions
      SET aria_processing_started_at=COALESCE(aria_processing_started_at,NOW()),
          aria_processing_status='processing',
          aria_processing_stage=v_stage,
          aria_processing_heartbeat_at=NOW(),
          aria_processing_error=NULL
      WHERE id=v_session AND organization_id=v_org AND status='closed';

      IF v_stage='persist' THEN v_next:='return_signals';
      ELSIF v_stage='return_signals' THEN v_next:='absence_signals';
      ELSIF v_stage='absence_signals' THEN v_next:='engagement';
      ELSIF v_stage='engagement' THEN v_next:='relationship';
      ELSIF v_stage='relationship' THEN v_next:='people_intelligence';
      ELSIF v_stage='people_intelligence' THEN v_next:='person_state';
      ELSIF v_stage='person_state' THEN v_next:='complete';
      ELSIF v_stage='complete' THEN v_next:=NULL;
      ELSE RAISE EXCEPTION 'Invalid queue stage: %',v_stage;
      END IF;

      PERFORM public.nyeocare_attendance_stage(v_session,v_org,v_stage);

      IF v_next IS NULL THEN
        PERFORM pgmq.archive('nyeocare-attendance',v_message.msg_id);
      ELSE
        PERFORM pgmq.send(
          'nyeocare-attendance',
          jsonb_build_object(
            'organization_id',v_org,
            'session_id',v_session::text,
            'actor_id',v_msg->>'actor_id',
            'stage',v_next,
            'enqueued_at',NOW()
          )
        );
        PERFORM pgmq.archive('nyeocare-attendance',v_message.msg_id);
      END IF;

      v_processed:=v_processed+1;

    EXCEPTION WHEN OTHERS THEN
      v_delay:=LEAST(
        300,
        GREATEST(
          10,
          (30*power(2,LEAST(GREATEST(v_message.read_ct-1,0),4)))::int
        )
      );

      UPDATE public.sessions
      SET aria_processing_status='processing',
          aria_processing_error=LEFT(SQLERRM,2000),
          aria_processing_stage=v_stage,
          aria_processing_heartbeat_at=NOW(),
          aria_processing_started_at=COALESCE(aria_processing_started_at,NOW())
      WHERE id=v_session AND organization_id=v_org AND status='closed';

      PERFORM pgmq.set_vt('nyeocare-attendance',v_message.msg_id,v_delay);
    END;
  END LOOP;

  RETURN v_processed;
END
$function$

REVOKE EXECUTE ON FUNCTION public.nyeocare_attendance_stage(uuid,text,text) FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.nyeocare_process_attendance_queue(integer) FROM PUBLIC,anon,authenticated;

DO $cron$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname='nyeocare-attendance-worker' LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
  PERFORM cron.schedule(
    'nyeocare-attendance-worker',
    '2 seconds',
    $$SELECT public.nyeocare_process_attendance_queue(2);$$
  );
END
$cron$;

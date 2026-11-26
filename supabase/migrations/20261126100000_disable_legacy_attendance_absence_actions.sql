-- supabase/migrations/20261126100000_disable_legacy_attendance_absence_actions.sql
-- The durable Supabase worker still calls the legacy SQL attendance stage.
-- Its absence branch predates register provenance and the current opt-in policy.
-- Keep the evidence pipeline, but stop that legacy stage from inventing care work.

ALTER FUNCTION public.nyeocare_attendance_stage(uuid,text,text)
  RENAME TO nyeocare_attendance_stage_legacy_20261126;

CREATE FUNCTION public.nyeocare_attendance_stage(
  p_session_id uuid,
  p_org_id text,
  p_stage text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO public, pg_catalog
AS $function$
DECLARE
  v_stage text := lower(trim(p_stage));
  v_result jsonb;
  v_suppressed integer := 0;
BEGIN
  IF v_stage = 'absence_signals' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.sessions s
      WHERE s.id = p_session_id
        AND s.organization_id = p_org_id
        AND s.status = 'closed'
    ) THEN
      RAISE EXCEPTION 'Attendance session must be closed before ARIA processing.';
    END IF;

    RETURN jsonb_build_object(
      'stage', v_stage,
      'skipped', true,
      'reason', 'automatic_attendance_care_paused',
      'message', 'Attendance non-observation remains evidence; no care responsibility is created by this legacy stage.'
    );
  END IF;

  IF v_stage = 'return_signals' THEN
    -- Preserve the existing return observation and old-context reconciliation,
    -- but do not turn a person's return into an automatic outreach obligation.
    v_result := public.nyeocare_attendance_stage_legacy_20261126(
      p_session_id, p_org_id, p_stage
    );

    UPDATE public.aria_actions a
    SET status = 'cancelled',
        failure_reason = 'Automatic return outreach is paused. The return observation remains in ARIA history.',
        updated_at = NOW()
    WHERE a.organization_id = p_org_id
      AND a.status IN ('proposed', 'approved')
      AND a.action_metadata->>'kind' = 'returned_after_absence'
      AND a.action_metadata->>'session_id' = p_session_id::text;

    GET DIAGNOSTICS v_suppressed = ROW_COUNT;

    UPDATE public.aria_daily_queue_items q
    SET status = 'dismissed',
        completed_at = COALESCE(q.completed_at, NOW()),
        updated_at = NOW()
    WHERE q.organization_id = p_org_id
      AND q.task_kind = 'follow_up'
      AND q.status IN ('pending', 'deferred')
      AND EXISTS (
        SELECT 1
        FROM public.aria_actions a
        WHERE a.organization_id = q.organization_id
          AND a.id::text = q.source_id
          AND a.action_metadata->>'kind' = 'returned_after_absence'
          AND a.action_metadata->>'session_id' = p_session_id::text
          AND a.status = 'cancelled'
          AND a.failure_reason = 'Automatic return outreach is paused. The return observation remains in ARIA history.'
      );

    RETURN COALESCE(v_result, '{}'::jsonb) || jsonb_build_object(
      'automatic_return_followups_suppressed', v_suppressed
    );
  END IF;

  RETURN public.nyeocare_attendance_stage_legacy_20261126(
    p_session_id, p_org_id, p_stage
  );
END
$function$;

ALTER FUNCTION public.nyeocare_attendance_stage(uuid,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.nyeocare_attendance_stage(uuid,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.nyeocare_attendance_stage(uuid,text,text)
  TO postgres;

COMMENT ON FUNCTION public.nyeocare_attendance_stage(uuid,text,text) IS
  'Canonical worker wrapper. Attendance absence stage is paused until an explicit, provenance-verified human-care policy exists. Return observations remain memory, not automatic outreach tasks.';

-- Retire only open, unapproved attendance/return follow-ups whose source session
-- does not carry verified register provenance. No People, attendance, timeline,
-- or already-executed communication records are deleted or rewritten.

UPDATE public.aria_daily_queue_items q
SET status = 'dismissed',
    completed_at = COALESCE(q.completed_at, NOW()),
    updated_at = NOW()
FROM public.aria_actions a
LEFT JOIN public.sessions s
  ON s.id::text = a.action_metadata->>'session_id'
 AND s.organization_id = a.organization_id
WHERE q.organization_id = a.organization_id
  AND q.source_id = a.id::text
  AND q.task_kind = 'follow_up'
  AND q.status IN ('pending', 'deferred')
  AND a.status IN ('proposed', 'approved')
  AND a.action_metadata->>'kind' IN ('attendance_absence_check_in', 'returned_after_absence')
  AND (
    s.id IS NULL
    OR s.absence_meaningful IS DISTINCT FROM TRUE
    OR s.register_completeness IS DISTINCT FROM 'complete'
    OR s.register_source IS NULL
    OR s.register_reviewed_at IS NULL
    OR s.register_reviewed_by IS NULL
  );

UPDATE public.aria_actions a
SET status = 'cancelled',
    failure_reason = 'Retired: legacy attendance processing created an outreach task without a verified complete register. No message was sent.',
    updated_at = NOW()
FROM public.sessions s
WHERE s.id::text = a.action_metadata->>'session_id'
  AND s.organization_id = a.organization_id
  AND a.status IN ('proposed', 'approved')
  AND a.action_metadata->>'kind' IN ('attendance_absence_check_in', 'returned_after_absence')
  AND (
    s.absence_meaningful IS DISTINCT FROM TRUE
    OR s.register_completeness IS DISTINCT FROM 'complete'
    OR s.register_source IS NULL
    OR s.register_reviewed_at IS NULL
    OR s.register_reviewed_by IS NULL
  );

UPDATE public.aria_actions a
SET status = 'cancelled',
    failure_reason = 'Retired: legacy attendance processing created an outreach task without a verified source session. No message was sent.',
    updated_at = NOW()
WHERE a.status IN ('proposed', 'approved')
  AND a.action_metadata->>'kind' IN ('attendance_absence_check_in', 'returned_after_absence')
  AND NOT EXISTS (
    SELECT 1
    FROM public.sessions s
    WHERE s.id::text = a.action_metadata->>'session_id'
      AND s.organization_id = a.organization_id
      AND s.absence_meaningful IS TRUE
      AND s.register_completeness = 'complete'
      AND s.register_source IS NOT NULL
      AND s.register_reviewed_at IS NOT NULL
      AND s.register_reviewed_by IS NOT NULL
  );

UPDATE public.aria_observations o
SET status = 'resolved',
    resolved_at = COALESCE(o.resolved_at, NOW()),
    updated_at = NOW()
FROM public.sessions s
WHERE s.id::text = o.metadata->>'session_id'
  AND s.organization_id = o.organization_id
  AND o.type = 'UNUSUAL_ABSENCE'
  AND o.status = 'active'
  AND (
    s.absence_meaningful IS DISTINCT FROM TRUE
    OR s.register_completeness IS DISTINCT FROM 'complete'
    OR s.register_source IS NULL
    OR s.register_reviewed_at IS NULL
    OR s.register_reviewed_by IS NULL
  );

UPDATE public.aria_observations o
SET status = 'resolved',
    resolved_at = COALESCE(o.resolved_at, NOW()),
    updated_at = NOW()
WHERE o.type = 'UNUSUAL_ABSENCE'
  AND o.status = 'active'
  AND NOT EXISTS (
    SELECT 1
    FROM public.sessions s
    WHERE s.id::text = o.metadata->>'session_id'
      AND s.organization_id = o.organization_id
      AND s.absence_meaningful IS TRUE
      AND s.register_completeness = 'complete'
      AND s.register_source IS NOT NULL
      AND s.register_reviewed_at IS NOT NULL
      AND s.register_reviewed_by IS NOT NULL
  );

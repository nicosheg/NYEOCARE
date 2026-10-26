-- Canonical ARIA work identity: one durable work item per real source, not per page/device.
-- Preserve every action/queue history row, reconcile duplicate open work, then enforce idempotency
-- at the database boundary (including proposals produced by the attendance SQL worker).
BEGIN;

CREATE OR REPLACE FUNCTION public.nyeocare_canonical_aria_work_key(
  p_organization_id text,
  p_person_id uuid,
  p_metadata jsonb,
  p_action_key text
) RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO pg_catalog
AS $function$
  SELECT CASE
    WHEN COALESCE(p_metadata->>'first_visit_required','false')='true'
      AND p_person_id IS NOT NULL
      AND NULLIF(BTRIM(COALESCE(p_metadata->>'session_id',p_metadata->>'care_session_id',p_metadata->>'attendance_session_id','')),'') IS NOT NULL
      THEN 'attendance:first_visit:' ||
        BTRIM(COALESCE(p_metadata->>'session_id',p_metadata->>'care_session_id',p_metadata->>'attendance_session_id','')) ||
        ':' || p_person_id::text
    WHEN COALESCE(p_metadata->>'kind','') IN (
      'care_first_check_in','attendance_absence_check_in','first_session_check_in','returned_after_absence'
    )
      AND p_person_id IS NOT NULL
      AND NULLIF(BTRIM(COALESCE(p_metadata->>'session_id',p_metadata->>'care_session_id',p_metadata->>'attendance_session_id','')),'') IS NOT NULL
      THEN 'attendance:care:' ||
        BTRIM(COALESCE(p_metadata->>'session_id',p_metadata->>'care_session_id',p_metadata->>'attendance_session_id','')) ||
        ':' || p_person_id::text
    WHEN COALESCE(p_metadata->>'kind','')='expected_return_due'
      AND NULLIF(BTRIM(COALESCE(p_metadata->>'context_id','')),'') IS NOT NULL
      THEN 'attendance:expected_return:' || BTRIM(p_metadata->>'context_id')
    WHEN NULLIF(BTRIM(COALESCE(p_metadata->>'source_event_id','')),'') IS NOT NULL
      AND NULLIF(BTRIM(COALESCE(p_metadata->>'kind','')),'') IS NOT NULL
      THEN 'event:' || BTRIM(p_metadata->>'source_event_id') || ':' || BTRIM(p_metadata->>'kind')
    WHEN NULLIF(BTRIM(COALESCE(p_action_key,'')),'') IS NOT NULL
      THEN 'action-key:' || BTRIM(p_action_key)
    ELSE 'action:' || COALESCE(p_organization_id,'') || ':' ||
      COALESCE(p_person_id::text,'organization') || ':' ||
      COALESCE(NULLIF(BTRIM(COALESCE(p_metadata->>'kind','')),''),'unknown')
  END;
$function$;

-- Backfill identity before enforcing uniqueness. Existing action keys and rows remain intact.
UPDATE public.aria_actions AS a
SET action_metadata = COALESCE(a.action_metadata,'{}'::jsonb) ||
      jsonb_build_object(
        'canonical_work_key',
        public.nyeocare_canonical_aria_work_key(a.organization_id,a.person_id,a.action_metadata,a.action_key),
        'canonical_work_key_version',1
      ),
    updated_at = COALESCE(a.updated_at,NOW());

-- Expired proposals are stale work, not open work. Cancel them with a reason before uniqueness is enforced.
WITH expired AS (
  UPDATE public.aria_actions AS a
  SET status='cancelled',
      failure_reason='Proposal expired before operator disposition; it is not evidence that care occurred.',
      action_metadata=COALESCE(a.action_metadata,'{}'::jsonb)||jsonb_build_object(
        'resolution_reason','proposal_expired_without_operator_disposition',
        'resolution_source','migration',
        'resolution_migration','20261026085000_canonical_aria_action_lifecycle',
        'resolved_at',NOW()
      ),
      updated_at=NOW()
  WHERE a.status IN ('proposed','approved')
    AND a.expires_at IS NOT NULL AND a.expires_at<=NOW()
  RETURNING a.id,a.organization_id
)
UPDATE public.aria_daily_queue_items AS q
SET status='dismissed',
    payload=COALESCE(q.payload,'{}'::jsonb)||jsonb_build_object(
      'resolution_reason','source_proposal_expired_without_operator_disposition',
      'resolution_source','migration',
      'resolved_at',NOW()
    ),
    updated_at=NOW()
FROM expired e
WHERE q.organization_id=e.organization_id AND q.source_id=e.id::text
  AND q.task_kind IN ('action','follow_up') AND q.status IN ('pending','deferred');

-- Keep the strongest/oldest open record; preserve duplicates as cancelled audit history.
WITH ranked AS (
  SELECT id,organization_id,action_metadata->>'canonical_work_key' AS work_key,
    ROW_NUMBER() OVER (
      PARTITION BY organization_id,action_metadata->>'canonical_work_key'
      ORDER BY CASE status WHEN 'executing' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
        CASE priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
        created_at ASC,id ASC
    ) AS rn,
    FIRST_VALUE(id) OVER (
      PARTITION BY organization_id,action_metadata->>'canonical_work_key'
      ORDER BY CASE status WHEN 'executing' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
        CASE priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
        created_at ASC,id ASC
    ) AS winner_id
  FROM public.aria_actions
  WHERE status IN ('proposed','approved','executing')
    AND NULLIF(action_metadata->>'canonical_work_key','') IS NOT NULL
), duplicates AS (
  UPDATE public.aria_actions AS a
  SET status='cancelled',
      failure_reason='Superseded by canonical ARIA work item; audit record preserved.',
      action_metadata=COALESCE(a.action_metadata,'{}'::jsonb)||jsonb_build_object(
        'resolution_reason','duplicate_open_canonical_work',
        'resolution_source','migration',
        'resolution_migration','20261026085000_canonical_aria_action_lifecycle',
        'canonical_duplicate_of',r.winner_id::text,
        'resolved_at',NOW()
      ),
      updated_at=NOW()
  FROM ranked r
  WHERE a.id=r.id AND r.rn>1 AND a.status IN ('proposed','approved','executing')
  RETURNING a.id,a.organization_id
)
UPDATE public.aria_daily_queue_items AS q
SET status='dismissed',
    payload=COALESCE(q.payload,'{}'::jsonb)||jsonb_build_object(
      'resolution_reason','source_action_cancelled_as_duplicate_canonical_work',
      'resolution_source','migration',
      'resolved_at',NOW()
    ),
    updated_at=NOW()
FROM duplicates d
WHERE q.organization_id=d.organization_id
  AND q.source_id=d.id::text
  AND q.task_kind IN ('action','follow_up')
  AND q.status IN ('pending','deferred');

-- One proposal cannot be rendered in both the action and follow-up queue lanes.
WITH ranked AS (
  SELECT id,organization_id,source_id,
    ROW_NUMBER() OVER (
      PARTITION BY organization_id,source_id
      ORDER BY CASE task_kind WHEN 'follow_up' THEN 0 ELSE 1 END,
        priority DESC,created_at ASC,id ASC
    ) AS rn
  FROM public.aria_daily_queue_items
  WHERE task_kind IN ('action','follow_up') AND status IN ('pending','deferred')
)
UPDATE public.aria_daily_queue_items AS q
SET status='dismissed',
    payload=COALESCE(q.payload,'{}'::jsonb)||jsonb_build_object(
      'resolution_reason','duplicate_queue_projection_for_same_action',
      'resolution_source','migration',
      'resolved_at',NOW()
    ),
    updated_at=NOW()
FROM ranked r
WHERE q.id=r.id AND r.rn>1 AND q.status IN ('pending','deferred');

CREATE INDEX IF NOT EXISTS aria_actions_expired_proposal_idx
  ON public.aria_actions (organization_id,expires_at)
  WHERE status IN ('proposed','approved') AND expires_at IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS aria_actions_open_canonical_work_uidx
  ON public.aria_actions (organization_id,(action_metadata->>'canonical_work_key'))
  WHERE status IN ('proposed','approved','executing')
    AND NULLIF(action_metadata->>'canonical_work_key','') IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS aria_daily_queue_open_action_source_uidx
  ON public.aria_daily_queue_items (organization_id,source_id)
  WHERE task_kind IN ('action','follow_up') AND status IN ('pending','deferred');

CREATE OR REPLACE FUNCTION public.nyeocare_enforce_canonical_aria_action()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_key text;
BEGIN
  IF NEW.status IN ('proposed','approved','executing')
     AND COALESCE(NEW.action_metadata->>'kind','')='new_person_welcome'
     AND COALESCE(NEW.action_metadata->>'source_event_type','')='PERSON_CREATED' THEN
    RAISE EXCEPTION 'Person creation is not attendance or consent to contact; create work only from verified evidence.'
      USING ERRCODE='23514';
  END IF;

  NEW.action_metadata := COALESCE(NEW.action_metadata,'{}'::jsonb);
  v_key := public.nyeocare_canonical_aria_work_key(
    NEW.organization_id,NEW.person_id,NEW.action_metadata,NEW.action_key
  );
  NEW.action_metadata := NEW.action_metadata ||
    jsonb_build_object('canonical_work_key',v_key,'canonical_work_key_version',1);

  IF TG_OP='INSERT' AND NEW.status IN ('proposed','approved','executing') THEN
    -- Serialize concurrent proposals for the same source across app instances/devices.
    PERFORM pg_advisory_xact_lock(hashtextextended('nyeocare:aria-work:'||NEW.organization_id||':'||v_key,0));
    -- Expiry is a proposal lifecycle transition, not a deletion. Release a stale
    -- identity before a new event creates useful work for that same source.
    WITH expired AS (
      UPDATE public.aria_actions AS a
      SET status='cancelled',
          failure_reason='Proposal expired before operator disposition; new evidence may create fresh work.',
          action_metadata=COALESCE(a.action_metadata,'{}'::jsonb)||jsonb_build_object(
            'resolution_reason','proposal_expired_without_operator_disposition',
            'resolution_source','canonical_action_insert',
            'resolved_at',NOW()
          ),
          updated_at=NOW()
      WHERE a.organization_id=NEW.organization_id
        AND a.action_metadata->>'canonical_work_key'=v_key
        AND a.status IN ('proposed','approved')
        AND a.expires_at IS NOT NULL AND a.expires_at<=NOW()
      RETURNING a.id,a.organization_id
    )
    UPDATE public.aria_daily_queue_items AS q
    SET status='dismissed',
            payload=COALESCE(q.payload,'{}'::jsonb)||jsonb_build_object(
          'resolution_reason','source_proposal_expired_without_operator_disposition',
          'resolution_source','canonical_action_insert',
          'resolved_at',NOW()
        ),
        updated_at=NOW()
    FROM expired e
    WHERE q.organization_id=e.organization_id AND q.source_id=e.id::text
      AND q.task_kind IN ('action','follow_up') AND q.status IN ('pending','deferred');

    IF EXISTS (
      SELECT 1 FROM public.aria_actions AS existing
      WHERE existing.organization_id=NEW.organization_id
        AND existing.action_metadata->>'canonical_work_key'=v_key
    ) THEN
      -- This source already has a work record (open or terminal). A replay must not
      -- reopen completed/dismissed work or compound a second proposal for the same session.
      RETURN NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS enforce_canonical_aria_action_trigger ON public.aria_actions;
CREATE TRIGGER enforce_canonical_aria_action_trigger
BEFORE INSERT OR UPDATE OF organization_id,person_id,action_key,action_metadata,status
ON public.aria_actions
FOR EACH ROW EXECUTE FUNCTION public.nyeocare_enforce_canonical_aria_action();

COMMENT ON INDEX public.aria_actions_open_canonical_work_uidx IS
'One open ARIA action per canonical work identity across producer code paths and devices.';
COMMENT ON INDEX public.aria_daily_queue_open_action_source_uidx IS
'One active ARIA Today projection per proposal across action and follow-up task kinds.';

COMMIT;

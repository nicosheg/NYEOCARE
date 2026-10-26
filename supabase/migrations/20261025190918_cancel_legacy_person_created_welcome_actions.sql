-- A person-created event is not attendance, proof of a first visit, or consent to be contacted.
-- Preserve the action records for audit, but cancel legacy proposals that were incorrectly created
-- by the old person-record-entry path. Also dismiss any pending queue rows tied to those proposals.
-- This is intentionally idempotent and never deletes people, attendance, memory, or feedback.

WITH invalid AS (
  SELECT id, organization_id
  FROM public.aria_actions
  WHERE status IN ('proposed', 'approved')
    AND COALESCE(action_metadata->>'kind', '') = 'new_person_welcome'
    AND COALESCE(action_metadata->>'source_event_type', '') = 'PERSON_CREATED'
),
cancelled AS (
  UPDATE public.aria_actions AS a
  SET
    status = 'cancelled',
    action_metadata = COALESCE(a.action_metadata, '{}'::jsonb) || jsonb_build_object(
      'resolution_reason', 'person_creation_is_not_attendance_or_contact_consent',
      'resolution_source', 'data_migration',
      'resolution_migration', '20261025190918_cancel_legacy_person_created_welcome_actions',
      'cancelled_at', NOW()
    ),
    updated_at = NOW()
  FROM invalid AS i
  WHERE a.id = i.id
    AND a.organization_id = i.organization_id
    AND a.status IN ('proposed', 'approved')
  RETURNING a.id, a.organization_id
),
dismissed_queue AS (
  UPDATE public.aria_daily_queue_items AS q
  SET
    status = 'dismissed',
    payload = COALESCE(q.payload, '{}'::jsonb) || jsonb_build_object(
      'resolution_reason', 'source_action_cancelled_as_invalid_person_created_welcome',
      'resolution_source', 'data_migration'
    ),
    updated_at = NOW()
  FROM cancelled AS c
  WHERE q.organization_id = c.organization_id
    AND q.task_kind = 'action'
    AND q.source_id = c.id::text
    AND q.status IN ('pending', 'deferred')
  RETURNING q.id
)
SELECT
  (SELECT COUNT(*)::int FROM cancelled) AS cancelled_invalid_actions,
  (SELECT COUNT(*)::int FROM dismissed_queue) AS dismissed_invalid_queue_rows;

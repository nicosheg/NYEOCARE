-- supabase/migrations/20261112113348_daily_queue_actionable_observations_only.sql
-- Only decision-relevant observations may become operator responsibilities.
-- Keep informational events in ARIA memory/history, but never turn them into care work.
WITH actionable_types(type) AS (
 VALUES
  ('UNUSUAL_ABSENCE'),
  ('ATTENDANCE_NOT_OBSERVED'),
  ('SCAN_REVIEW_REQUIRED'),
  ('ARIA_PROCESSING_FAILURE'),
  ('CONFLICT'),
  ('DATA_INTEGRITY'),
  ('SECURITY_REVIEW')
),
non_actionable_sources AS (
 SELECT o.organization_id,o.id
 FROM public.aria_observations o
 WHERE NOT EXISTS (
  SELECT 1 FROM actionable_types a WHERE a.type=o.type
 )
)
UPDATE public.aria_daily_queue_items q
SET status='dismissed',
    completed_at=COALESCE(q.completed_at,NOW()),
    updated_at=NOW()
FROM non_actionable_sources o
WHERE q.organization_id=o.organization_id
  AND q.source_id=o.id::text
  AND q.task_kind IN('action','follow_up','observation')
  AND q.status IN('pending','deferred');

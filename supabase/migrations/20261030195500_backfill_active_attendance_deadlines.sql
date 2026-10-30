-- Source-controlled reconstruction of the migration recorded in production as
-- 20261030195500_backfill_active_attendance_deadlines.
-- It is idempotent and only fills missing deadlines on active sessions.
-- Production already records this migration as applied; do not apply it again there.

WITH configured AS (
  SELECT
    s.id,
    s.started_at,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM pg_catalog.pg_timezone_names z
        WHERE z.name=COALESCE(NULLIF(o.settings->>'timezone',''),'Africa/Lagos')
      ) THEN COALESCE(NULLIF(o.settings->>'timezone',''),'Africa/Lagos')
      ELSE 'Africa/Lagos'
    END AS time_zone
  FROM public.sessions s
  JOIN public.organizations o ON o.id=s.organization_id
  WHERE s.status='active'
    AND s.started_at IS NOT NULL
    AND s.auto_close_at IS NULL
),
deadlines AS (
  SELECT
    id,
    CASE
      WHEN end_of_day>started_at
        THEN LEAST(started_at+INTERVAL '24 hours',end_of_day)
      ELSE started_at+INTERVAL '24 hours'
    END AS auto_close_at,
    CASE
      WHEN end_of_day>started_at
       AND end_of_day<=started_at+INTERVAL '24 hours'
        THEN 'end_of_day'
      ELSE '24h'
    END AS auto_close_reason
  FROM (
    SELECT
      id,
      started_at,
      ((started_at AT TIME ZONE time_zone)::date + TIME '23:59') AT TIME ZONE time_zone AS end_of_day
    FROM configured
  ) local_deadlines
)
UPDATE public.sessions s
SET auto_close_at=d.auto_close_at,
    auto_close_reason=d.auto_close_reason
FROM deadlines d
WHERE s.id=d.id
  AND s.status='active'
  AND s.auto_close_at IS NULL;

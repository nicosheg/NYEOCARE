-- NYEOCARE: backfill deadlines for sessions that were already live when auto-save shipped.
-- The current Havilah rollout has no active sessions, but this makes the migration
-- safe for organizations that still have an open event at deployment time.

WITH timezone_config AS (
  SELECT o.id organization_id,
         CASE
           WHEN EXISTS (
             SELECT 1 FROM pg_catalog.pg_timezone_names z
             WHERE z.name=COALESCE(NULLIF(o.settings->>'timezone',''),'Africa/Lagos')
           ) THEN COALESCE(NULLIF(o.settings->>'timezone',''),'Africa/Lagos')
           ELSE 'Africa/Lagos'
         END AS time_zone
  FROM public.organizations o
), deadlines AS (
  SELECT s.id,
         CASE
           WHEN local_day_end > s.started_at
             THEN LEAST(s.started_at + INTERVAL '24 hours',local_day_end)
           ELSE s.started_at + INTERVAL '24 hours'
         END AS auto_close_at,
         CASE
           WHEN local_day_end > s.started_at
            AND local_day_end <= s.started_at + INTERVAL '24 hours'
             THEN 'end_of_day'
           ELSE '24h'
         END AS auto_close_reason
  FROM public.sessions s
  JOIN timezone_config t ON t.organization_id=s.organization_id
  CROSS JOIN LATERAL (
    SELECT ((s.started_at AT TIME ZONE t.time_zone)::date + TIME '23:59')
      AT TIME ZONE t.time_zone AS local_day_end
  ) local_deadline
  WHERE s.status='active'
    AND s.auto_close_at IS NULL
    AND s.started_at IS NOT NULL
)
UPDATE public.sessions s
SET auto_close_at=d.auto_close_at,
    auto_close_reason=d.auto_close_reason
FROM deadlines d
WHERE s.id=d.id;

CREATE INDEX IF NOT EXISTS sessions_auto_close_due_idx
  ON public.sessions(auto_close_at,id)
  WHERE status='active' AND auto_close_at IS NOT NULL;

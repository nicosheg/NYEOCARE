-- Phase 1: additive scan-failure observability and bounded alert delivery.
-- Existing compatibility columns (scan_jobs.error_code/attempt_count/heartbeat/progress_detail
-- and ai_usage_events.finish_reason/success) are intentionally reused, not recreated or renamed.

ALTER TABLE public.scan_jobs
  ADD COLUMN IF NOT EXISTS failed_stage text,
  ADD COLUMN IF NOT EXISTS error_detail jsonb,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS checkpoint jsonb,
  ADD COLUMN IF NOT EXISTS claimed_by text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_smoke_test boolean DEFAULT false;

ALTER TABLE public.ai_usage_events
  ADD COLUMN IF NOT EXISTS http_ok boolean,
  ADD COLUMN IF NOT EXISTS extraction_valid boolean,
  ADD COLUMN IF NOT EXISTS failure_class text;

CREATE TABLE IF NOT EXISTS public.scan_failure_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid UNIQUE,
  organization_id text,
  error_code text NOT NULL,
  failed_stage text NOT NULL,
  region_states jsonb,
  elapsed_ms integer,
  alert_type text NOT NULL CHECK (alert_type IN ('single', 'suppressed', 'summary')),
  window_start timestamptz,
  delivery_status text NOT NULL DEFAULT 'pending'
    CHECK (delivery_status IN ('pending', 'sent', 'failed', 'disabled', 'suppressed')),
  delivery_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS scan_failure_alerts_summary_once_idx
  ON public.scan_failure_alerts(error_code, window_start)
  WHERE alert_type = 'summary';

ALTER TABLE public.scan_failure_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.scan_failure_alerts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.scan_failure_alerts TO service_role;

CREATE OR REPLACE VIEW public.scan_health_7d
WITH (security_invoker = true)
AS
SELECT
  error_code,
  failed_stage,
  COUNT(*)::bigint AS jobs,
  MAX(COALESCE(completed_at, created_at)) AS last_seen
FROM public.scan_jobs
WHERE status = 'failed'
  AND COALESCE(completed_at, created_at) > now() - interval '7 days'
GROUP BY error_code, failed_stage
ORDER BY jobs DESC;

REVOKE ALL ON public.scan_health_7d FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.scan_health_7d TO service_role;

COMMENT ON VIEW public.scan_health_7d IS
  'Internal seven-day scan failure counts by code and stage; restricted to server-side service_role access.';

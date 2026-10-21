-- Add durable request idempotency for scan-start handoffs interrupted by weak mobile networks.
-- Stores request identifiers and an image hash, but no image bytes or personal register data.
CREATE TABLE IF NOT EXISTS public.scan_start_requests (
  organization_id text NOT NULL,
  client_request_id uuid NOT NULL,
  scan_job_id uuid NOT NULL REFERENCES public.scan_jobs(id) ON DELETE CASCADE,
  requested_image_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS scan_start_requests_scan_job_id_idx
  ON public.scan_start_requests(scan_job_id);

ALTER TABLE public.scan_start_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.scan_start_requests FROM PUBLIC, anon, authenticated;

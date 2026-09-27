-- Canonical server-driven scan progress telemetry.
ALTER TABLE scan_jobs
  ADD COLUMN IF NOT EXISTS progress_detail JSONB;

COMMENT ON COLUMN scan_jobs.progress_detail IS
'Canonical live scan-stage telemetry consumed by the scan status API and frontend.';

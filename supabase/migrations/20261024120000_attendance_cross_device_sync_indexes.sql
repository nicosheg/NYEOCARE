-- Indexes for the cross-device attendance change feed.
-- The feed is polled only by authenticated operators joined to an active session.
-- These indexes keep its incremental lookups bounded as an organization's roster grows.

BEGIN;

CREATE INDEX IF NOT EXISTS people_org_created_at_active_idx
  ON public.people (organization_id, created_at, id)
  WHERE COALESCE(status, 'active') = 'active';

CREATE INDEX IF NOT EXISTS attendance_records_org_session_marked_at_idx
  ON public.attendance_records (organization_id, session_id, marked_at, people_id)
  WHERE session_id IS NOT NULL;

COMMIT;

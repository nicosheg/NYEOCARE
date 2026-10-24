-- Indexes for the cross-device attendance change feed.
-- The feed is polled by authenticated operators joined to an active session.
-- Active-person edits and inactive/merged-person tombstones are incremental lookups.

BEGIN;

CREATE INDEX IF NOT EXISTS people_org_updated_at_active_idx
  ON public.people (organization_id, updated_at, id)
  WHERE COALESCE(status, 'active') = 'active';

CREATE INDEX IF NOT EXISTS people_org_updated_at_inactive_idx
  ON public.people (organization_id, updated_at, id)
  WHERE COALESCE(status, 'active') <> 'active';

CREATE INDEX IF NOT EXISTS attendance_records_org_session_marked_at_idx
  ON public.attendance_records (organization_id, session_id, marked_at, people_id)
  WHERE session_id IS NOT NULL;

COMMIT;

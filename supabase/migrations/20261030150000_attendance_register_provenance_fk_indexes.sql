-- Index foreign-key columns for the new provenance/audit relationships.
-- The existing organization/session composite index starts with organization_id;
-- these single-column indexes cover session/user-side FK checks too.
CREATE INDEX IF NOT EXISTS attendance_register_events_session_idx
  ON public.attendance_register_events (session_id);

CREATE INDEX IF NOT EXISTS attendance_register_events_actor_idx
  ON public.attendance_register_events (actor_id);

CREATE INDEX IF NOT EXISTS sessions_register_reviewed_by_idx
  ON public.sessions (register_reviewed_by);

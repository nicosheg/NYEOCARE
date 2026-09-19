-- Keep session-linked attendance and participation durable when a session is discarded.
-- This mirrors the migration already applied to the production Supabase project.
ALTER TABLE public.attendance_records
  DROP CONSTRAINT IF EXISTS attendance_records_session_id_fkey;
ALTER TABLE public.attendance_records
  ADD CONSTRAINT attendance_records_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;

ALTER TABLE public.participation_records
  DROP CONSTRAINT IF EXISTS participation_records_session_fkey;
ALTER TABLE public.participation_records
  ADD CONSTRAINT participation_records_session_fkey
  FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;

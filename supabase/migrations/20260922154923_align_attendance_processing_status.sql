-- Keep the sessions processing-status contract aligned with the application.
-- Active sessions intentionally use "idle" until they are closed.
-- Automatic recovery can end in "needs_attention" after bounded retries.
ALTER TABLE public.sessions
  DROP CONSTRAINT IF EXISTS sessions_aria_processing_status_check;

ALTER TABLE public.sessions
  ADD CONSTRAINT sessions_aria_processing_status_check
  CHECK (
    aria_processing_status = ANY (ARRAY[
      'idle'::text,
      'pending'::text,
      'processing'::text,
      'completed'::text,
      'failed'::text,
      'needs_attention'::text
    ])
  );

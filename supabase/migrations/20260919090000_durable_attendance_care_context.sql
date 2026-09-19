-- Durable attendance processing state and human-provided absence context.
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS aria_processing_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS aria_processing_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS aria_processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS aria_processing_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS aria_processing_error text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='sessions_aria_processing_status_check'
      AND conrelid='public.sessions'::regclass
  ) THEN
    ALTER TABLE public.sessions
      ADD CONSTRAINT sessions_aria_processing_status_check
      CHECK (aria_processing_status IN ('pending','processing','completed','failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS sessions_org_processing_idx
  ON public.sessions(organization_id,status,aria_processing_status,closed_at DESC);

CREATE TABLE IF NOT EXISTS public.aria_attendance_contexts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  reason_code text NOT NULL DEFAULT 'unknown',
  reason_note text,
  expected_return_date date,
  expected_service_type text,
  expected_return_known boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'human',
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT aria_attendance_contexts_reason_check CHECK (
    reason_code IN ('health','travel','work_school','family','personal','transport','other','unknown')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS aria_attendance_contexts_session_person_uq
  ON public.aria_attendance_contexts(organization_id,session_id,person_id);

CREATE INDEX IF NOT EXISTS aria_attendance_contexts_due_idx
  ON public.aria_attendance_contexts(organization_id,expected_return_date,resolved_at);

CREATE INDEX IF NOT EXISTS aria_attendance_contexts_person_idx
  ON public.aria_attendance_contexts(organization_id,person_id,created_at DESC);

-- Existing closed sessions predate durable processing state. Treat them as already
-- settled except the two pilot sessions that are known to need ARIA recovery.
UPDATE public.sessions
SET aria_processing_status='completed'
WHERE status='closed' AND aria_processing_status='pending';

UPDATE public.sessions
SET aria_processing_status='failed',
    aria_processing_error='ARIA processing failed before absence intelligence completed; safe to retry.'
WHERE id IN (
  '67f2ed4e-fe4c-442b-a718-70856188f463',
  '3591be52-79c1-44b6-ae75-e941dad628e5'
)
AND status='closed';

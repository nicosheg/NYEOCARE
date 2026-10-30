-- NYEOCARE: attendance register truth, explicit completeness and provenance.
-- A closed session is saved, not necessarily complete. Historical sessions stay unverified.
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS register_completeness text NOT NULL DEFAULT 'unconfirmed',
  ADD COLUMN IF NOT EXISTS register_source text,
  ADD COLUMN IF NOT EXISTS register_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS register_reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS register_review_note text;

-- The prior event-semantics migration opted neutral service events into absence
-- interpretation. That is not evidence of a complete register or an explicit
-- event-level decision. Remove that inherited default for unreviewed history.
UPDATE public.sessions
SET absence_meaningful=false
WHERE register_reviewed_at IS NULL
  AND absence_meaningful=true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='sessions_register_completeness_check'
  ) THEN
    ALTER TABLE public.sessions
      ADD CONSTRAINT sessions_register_completeness_check
      CHECK (register_completeness IN ('unconfirmed','incomplete','complete'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='sessions_register_source_check'
  ) THEN
    ALTER TABLE public.sessions
      ADD CONSTRAINT sessions_register_source_check
      CHECK (register_source IS NULL OR register_source IN ('digital_roster','paper_sheet','manual_reconciliation','other'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='sessions_complete_register_provenance_check'
  ) THEN
    ALTER TABLE public.sessions
      ADD CONSTRAINT sessions_complete_register_provenance_check
      CHECK (
        register_completeness <> 'complete'
        OR (
          register_source IS NOT NULL
          AND register_reviewed_at IS NOT NULL
          AND register_reviewed_by IS NOT NULL
        )
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.attendance_register_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  register_completeness text NOT NULL
    CHECK (register_completeness IN ('unconfirmed','incomplete','complete')),
  register_source text
    CHECK (register_source IS NULL OR register_source IN ('digital_roster','paper_sheet','manual_reconciliation','other')),
  note text,
  actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    register_completeness <> 'complete'
    OR (register_source IS NOT NULL AND actor_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS attendance_register_events_org_session_idx
  ON public.attendance_register_events (organization_id,session_id,recorded_at DESC);

-- Register declarations are written by authenticated server paths only.
ALTER TABLE public.attendance_register_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_register_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.attendance_register_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.attendance_register_events TO service_role;

COMMENT ON COLUMN public.sessions.register_completeness IS
  'Whether the event register was explicitly reconciled: unconfirmed, incomplete, or complete. Session closure alone never means complete.';
COMMENT ON COLUMN public.sessions.register_source IS
  'Source used to reconcile the event register: digital roster, paper sheet, manual reconciliation, or other.';
COMMENT ON TABLE public.attendance_register_events IS
  'Append-only audit history for register completeness declarations, corrections and their source.';

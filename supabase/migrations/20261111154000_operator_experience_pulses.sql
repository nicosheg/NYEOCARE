-- Voluntary weekly operator experience pulse.
-- Responses are linked to an operator only to enforce one response per person/week.
-- Leadership APIs expose team-level aggregates only; there is no individual score view.

CREATE TABLE IF NOT EXISTS public.operator_experience_pulses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  operator_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  ease_score smallint,
  clarity_score smallint,
  confidence_score smallint,
  submitted_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT operator_experience_pulses_one_per_operator_week UNIQUE (organization_id,operator_user_id,week_start),
  CONSTRAINT operator_experience_pulses_ease_score_check CHECK (ease_score IS NULL OR ease_score BETWEEN 1 AND 5),
  CONSTRAINT operator_experience_pulses_clarity_score_check CHECK (clarity_score IS NULL OR clarity_score BETWEEN 1 AND 5),
  CONSTRAINT operator_experience_pulses_confidence_score_check CHECK (confidence_score IS NULL OR confidence_score BETWEEN 1 AND 5),
  CONSTRAINT operator_experience_pulses_submission_state_check CHECK (
    (submitted_at IS NOT NULL AND ease_score IS NOT NULL AND clarity_score IS NOT NULL AND confidence_score IS NOT NULL)
    OR
    (submitted_at IS NULL AND ease_score IS NULL AND clarity_score IS NULL AND confidence_score IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS operator_experience_pulses_org_week_idx
  ON public.operator_experience_pulses (organization_id,week_start DESC,submitted_at);

ALTER TABLE public.operator_experience_pulses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operator_experience_pulses FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS operator_experience_pulses_server_only_deny ON public.operator_experience_pulses;
CREATE POLICY operator_experience_pulses_server_only_deny
  ON public.operator_experience_pulses
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.tg_touch_operator_experience_pulses()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at=NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_operator_experience_pulses ON public.operator_experience_pulses;
CREATE TRIGGER trg_touch_operator_experience_pulses
  BEFORE UPDATE ON public.operator_experience_pulses
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_touch_operator_experience_pulses();

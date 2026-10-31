-- NYEOCARE: explicit, exclusive attendance sections for People.
-- Existing records stay NULL (Unassigned); never infer a section from a name or birthday.
BEGIN;

ALTER TABLE public.people ADD COLUMN IF NOT EXISTS attendance_group text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='people_attendance_group_check' AND conrelid='public.people'::regclass) THEN
    ALTER TABLE public.people ADD CONSTRAINT people_attendance_group_check
      CHECK (attendance_group IS NULL OR attendance_group IN ('men','women','youth'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS people_org_status_attendance_group_idx
  ON public.people (organization_id,status,attendance_group,id);

COMMENT ON COLUMN public.people.attendance_group IS
  'Exclusive, explicitly assigned attendance section: men, women, youth. NULL means Unassigned. Never inferred from name, age, or appearance.';
COMMIT;

-- Allow "not_attending" as explicit human context in the durable attendance context model.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='aria_attendance_contexts_reason_check'
      AND conrelid='public.aria_attendance_contexts'::regclass
  ) THEN
    ALTER TABLE public.aria_attendance_contexts DROP CONSTRAINT aria_attendance_contexts_reason_check;
  END IF;
  ALTER TABLE public.aria_attendance_contexts
    ADD CONSTRAINT aria_attendance_contexts_reason_check CHECK (
      reason_code IN ('health','travel','work_school','family','personal','transport','other','unknown','not_attending')
    );
END $$;

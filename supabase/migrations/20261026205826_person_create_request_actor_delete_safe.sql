-- Keep operator deletion possible after a person-create request has been recorded.
-- The person row itself retains its original creator/provenance; this pointer is nullable metadata.
ALTER TABLE public.person_create_requests
  ALTER COLUMN created_by DROP NOT NULL;

ALTER TABLE public.person_create_requests
  DROP CONSTRAINT IF EXISTS person_create_requests_created_by_fkey;

ALTER TABLE public.person_create_requests
  ADD CONSTRAINT person_create_requests_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- Durable idempotency for manual person creation across mobile retries.
-- Server-owned table: no direct Data API access is granted to client roles.
CREATE TABLE IF NOT EXISTS public.person_create_requests (
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_request_id uuid NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS person_create_requests_person_id_idx
  ON public.person_create_requests(person_id);

ALTER TABLE public.person_create_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.person_create_requests FROM PUBLIC, anon, authenticated;

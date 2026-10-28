-- Durable human review for manual person creation conflicts.
-- A blocked create is a pending review item, not a person and never an implicit merge/archive.
CREATE TABLE IF NOT EXISTS public.person_identity_review_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_request_id uuid NOT NULL,
  payload_hash text NOT NULL,
  request_payload_hash text NOT NULL,
  source text NOT NULL DEFAULT 'manual_create'
    CHECK (source IN ('manual_create', 'bulk_create')),
  proposed_payload jsonb NOT NULL
    CHECK (jsonb_typeof(proposed_payload) = 'object'),
  candidate_person_ids jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(candidate_person_ids) = 'array'),
  match_evidence jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(match_evidence) = 'object'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'resolved', 'rejected')),
  decision jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_person_id uuid REFERENCES public.people(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT person_identity_review_request_unq UNIQUE (organization_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS person_identity_review_pending_idx
  ON public.person_identity_review_items (organization_id, created_at DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS person_identity_review_org_fk_idx
  ON public.person_identity_review_items (organization_id);

CREATE INDEX IF NOT EXISTS person_identity_review_created_by_fk_idx
  ON public.person_identity_review_items (created_by)
  WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS person_identity_review_resolved_by_fk_idx
  ON public.person_identity_review_items (resolved_by)
  WHERE resolved_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS person_identity_review_resolved_person_fk_idx
  ON public.person_identity_review_items (resolved_person_id)
  WHERE resolved_person_id IS NOT NULL;

ALTER TABLE public.person_identity_review_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.person_identity_review_items FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.person_identity_review_items IS
  'Durable human review queue for person creation blocked by possible identity matches. Rows are not person records; only an explicit review decision can resolve them.';

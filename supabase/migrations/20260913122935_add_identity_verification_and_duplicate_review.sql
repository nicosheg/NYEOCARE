ALTER TABLE public.people ADD COLUMN IF NOT EXISTS identity_verification_status text NOT NULL DEFAULT 'unverified' CHECK (identity_verification_status IN ('unverified','verified','disputed'));
ALTER TABLE public.people ADD COLUMN IF NOT EXISTS identity_verified_at timestamptz;
ALTER TABLE public.people ADD COLUMN IF NOT EXISTS identity_verified_by uuid REFERENCES public.users(id);
ALTER TABLE public.people ADD COLUMN IF NOT EXISTS identity_verification_source text;
CREATE INDEX IF NOT EXISTS people_org_identity_verification_idx ON public.people(organization_id,status,identity_verification_status);

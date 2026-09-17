-- NYEOCARE scan review foundation: review items are not people; confidence is never fabricated.
CREATE TABLE IF NOT EXISTS public.scan_review_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id text NOT NULL,
 scan_job_id uuid NOT NULL,
 scan_evidence_id uuid,
 row_number integer,
 raw_name text,
 raw_phones jsonb NOT NULL DEFAULT '[]'::jsonb,
 extracted_name text,
 extracted_phones jsonb NOT NULL DEFAULT '[]'::jsonb,
 normalized_name text,
 normalized_phones jsonb NOT NULL DEFAULT '[]'::jsonb,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved','rejected')),
 review_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
 reason text,
 suggestion text,
 evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
 candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
 proposed_person_id uuid,
 program_name text,
 created_by uuid,
 decision jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 resolved_at timestamptz,
 resolved_by uuid,
 CONSTRAINT scan_review_items_scan_row_uq UNIQUE(scan_job_id,row_number)
);
CREATE INDEX IF NOT EXISTS scan_review_items_org_status_idx ON public.scan_review_items(organization_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS scan_review_items_job_idx ON public.scan_review_items(scan_job_id);
CREATE INDEX IF NOT EXISTS scan_review_items_proposed_person_idx ON public.scan_review_items(proposed_person_id) WHERE proposed_person_id IS NOT NULL;
ALTER TABLE public.scan_review_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.scan_review_items FROM anon,authenticated;
ALTER TABLE public.people ALTER COLUMN confidence DROP DEFAULT;
ALTER TABLE public.people ALTER COLUMN confidence DROP NOT NULL;

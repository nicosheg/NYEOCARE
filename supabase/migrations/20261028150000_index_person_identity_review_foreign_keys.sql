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

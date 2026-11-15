-- Allow durable identity reviews created by edits to existing People records.
-- Preserve the existing manual-create and bulk-create sources.
ALTER TABLE public.person_identity_review_items
  DROP CONSTRAINT IF EXISTS person_identity_review_items_source_check;

ALTER TABLE public.person_identity_review_items
  ADD CONSTRAINT person_identity_review_items_source_check
  CHECK (source IN ('manual_create', 'bulk_create', 'people_edit_identity_review'));

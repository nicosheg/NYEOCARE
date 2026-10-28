ALTER TABLE public.person_identity_review_items
  ADD COLUMN IF NOT EXISTS request_payload_hash text;

UPDATE public.person_identity_review_items
SET request_payload_hash = payload_hash
WHERE request_payload_hash IS NULL;

ALTER TABLE public.person_identity_review_items
  ALTER COLUMN request_payload_hash SET NOT NULL;

COMMENT ON COLUMN public.person_identity_review_items.request_payload_hash IS
  'Immutable hash of the original creation request used for idempotent retries; payload_hash may change when a human edits the pending review.';

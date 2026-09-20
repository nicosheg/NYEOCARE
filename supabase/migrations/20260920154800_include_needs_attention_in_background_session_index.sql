-- Include terminal background-processing state in the session lookup index.
DROP INDEX IF EXISTS public.sessions_org_background_processing_idx;

CREATE INDEX sessions_org_background_processing_idx
ON public.sessions(organization_id,closed_at DESC)
WHERE status='closed'
  AND aria_processing_status IN('pending','processing','needs_attention');

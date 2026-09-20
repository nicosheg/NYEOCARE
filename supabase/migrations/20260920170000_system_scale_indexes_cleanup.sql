-- Hot-path scale safeguards discovered by the full-system audit.
DROP INDEX IF EXISTS public.aria_messages_conversation_created_idx;
DROP INDEX IF EXISTS public.idx_person_memberships_person;

CREATE INDEX IF NOT EXISTS person_communications_org_person_time_created_idx
  ON public.person_communications (organization_id, person_id, occurred_at DESC, created_at DESC);

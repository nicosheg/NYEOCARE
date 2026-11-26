-- supabase/migrations/20261126113000_canonical_care_intake_privacy_foundation.sql
-- Extend the existing immutable ARIA event spine. No parallel intake or task tables.
BEGIN;

ALTER TABLE public.aria_events
  ADD COLUMN IF NOT EXISTS privacy_class text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS consent_status text NOT NULL DEFAULT 'unknown';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.aria_events'::regclass
      AND conname='aria_events_privacy_class_check'
  ) THEN
    ALTER TABLE public.aria_events
      ADD CONSTRAINT aria_events_privacy_class_check
      CHECK (privacy_class IN ('standard','sensitive','restricted'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.aria_events'::regclass
      AND conname='aria_events_consent_status_check'
  ) THEN
    ALTER TABLE public.aria_events
      ADD CONSTRAINT aria_events_consent_status_check
      CHECK (consent_status IN ('unknown','granted','declined','withdrawn','not_required'));
  END IF;
END $$;

COMMENT ON COLUMN public.aria_events.privacy_class IS
  'Immutable visibility classification: standard (organization operators), sensitive (leaders/admins plus reporter), restricted (owners/admins plus reporter). Server APIs must enforce this when using privileged database connections.';
COMMENT ON COLUMN public.aria_events.consent_status IS
  'Consent evidence captured when the event was recorded; unknown is not equivalent to granted.';

CREATE INDEX IF NOT EXISTS aria_events_person_privacy_history_idx
  ON public.aria_events (organization_id, person_id, privacy_class, occurred_at DESC)
  WHERE person_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS aria_events_intake_review_lookup_idx
  ON public.aria_events (organization_id, (metadata->>'intake_event_id'), occurred_at DESC)
  WHERE type='CARE_INTAKE_REVIEWED';

CREATE INDEX IF NOT EXISTS aria_care_contexts_do_not_contact_idx
  ON public.aria_care_contexts (organization_id, person_id, ends_on)
  WHERE kind='other' AND metadata->>'do_not_contact'='true';

CREATE OR REPLACE FUNCTION public.protect_aria_event_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'ARIA historical events are immutable';
  END IF;

  IF OLD.organization_id IS DISTINCT FROM NEW.organization_id
     OR OLD.person_id IS DISTINCT FROM NEW.person_id
     OR OLD.type IS DISTINCT FROM NEW.type
     OR OLD.actor_id IS DISTINCT FROM NEW.actor_id
     OR OLD.actor_role IS DISTINCT FROM NEW.actor_role
     OR OLD.source IS DISTINCT FROM NEW.source
     OR OLD.event_key IS DISTINCT FROM NEW.event_key
     OR OLD.metadata IS DISTINCT FROM NEW.metadata
     OR OLD.occurred_at IS DISTINCT FROM NEW.occurred_at
     OR OLD.evidence_kind IS DISTINCT FROM NEW.evidence_kind
     OR OLD.confidence IS DISTINCT FROM NEW.confidence
     OR OLD.verification_status IS DISTINCT FROM NEW.verification_status
     OR OLD.scope_level IS DISTINCT FROM NEW.scope_level
     OR OLD.expires_at IS DISTINCT FROM NEW.expires_at
     OR OLD.supersedes_event_id IS DISTINCT FROM NEW.supersedes_event_id
     OR OLD.privacy_class IS DISTINCT FROM NEW.privacy_class
     OR OLD.consent_status IS DISTINCT FROM NEW.consent_status
  THEN
    RAISE EXCEPTION 'ARIA historical event fields are immutable';
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;

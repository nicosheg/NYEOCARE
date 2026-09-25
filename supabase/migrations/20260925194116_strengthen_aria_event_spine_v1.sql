-- Strengthen the existing ARIA event spine without introducing a second queue.
ALTER TABLE public.aria_events
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;

CREATE INDEX IF NOT EXISTS aria_events_pending_queue_v2_idx
  ON public.aria_events(organization_id,processing_status,occurred_at,created_at)
  WHERE processing_status IN('pending','failed');

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
  THEN
    RAISE EXCEPTION 'ARIA historical event fields are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_aria_event_history_trigger ON public.aria_events;
CREATE TRIGGER protect_aria_event_history_trigger
BEFORE UPDATE OR DELETE ON public.aria_events
FOR EACH ROW EXECUTE FUNCTION public.protect_aria_event_history();

DROP POLICY IF EXISTS aria_events_insert_same_organization ON public.aria_events;
DROP POLICY IF EXISTS aria_events_update_same_organization ON public.aria_events;
DROP POLICY IF EXISTS aria_events_delete_same_organization ON public.aria_events;
DROP POLICY IF EXISTS aria_events_select_same_organization ON public.aria_events;
CREATE POLICY aria_events_select_same_organization
  ON public.aria_events
  FOR SELECT TO authenticated
  USING(organization_id=current_user_organization_id());

CREATE OR REPLACE FUNCTION public.normalize_aria_event_provenance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $$
BEGIN
  IF NEW.type='PARTICIPATION_CONFIRMED' THEN
    NEW.evidence_kind:=COALESCE(NULLIF(NEW.evidence_kind,''),'observation');
    NEW.verification_status:=CASE WHEN NEW.verification_status='observed' THEN 'verified' ELSE NEW.verification_status END;
    NEW.confidence:=GREATEST(COALESCE(NEW.confidence,0),1);
  ELSIF NEW.type IN('CARE_FEEDBACK','ADMIN_CORRECTION','RELATIONSHIP_CORRECTED','NEW_CONTEXT_ADDED') THEN
    NEW.evidence_kind:=CASE WHEN NEW.evidence_kind='observation' THEN 'human_report' ELSE NEW.evidence_kind END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_aria_event_provenance_trigger ON public.aria_events;
CREATE TRIGGER normalize_aria_event_provenance_trigger
BEFORE INSERT ON public.aria_events
FOR EACH ROW EXECUTE FUNCTION public.normalize_aria_event_provenance();

UPDATE public.aria_events
SET processed_at=COALESCE(processed_at,created_at),
    processing_started_at=NULL,
    next_attempt_at=NULL
WHERE processing_status='completed' AND processed_at IS NULL;

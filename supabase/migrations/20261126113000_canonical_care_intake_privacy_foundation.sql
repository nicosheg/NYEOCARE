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


-- RLS is part of the privacy boundary, not merely a UI concern.
CREATE OR REPLACE FUNCTION public.can_access_care_privacy(
  p_organization_id text,
  p_privacy_class text,
  p_reporter_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $
  SELECT
    COALESCE(p_privacy_class, 'standard') = 'standard'
    OR EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.organization_id = p_organization_id
        AND u.supabase_user_id = auth.uid()
        AND u.active = true
        AND (
          u.id::text = p_reporter_id
          OR (
            p_privacy_class = 'sensitive'
            AND u.role IN ('owner','admin','leader')
          )
          OR (
            p_privacy_class = 'restricted'
            AND u.role IN ('owner','admin')
          )
        )
    );
$;

REVOKE ALL ON FUNCTION public.can_access_care_privacy(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_care_privacy(text,text,text) TO authenticated, anon;

-- Preserve existing standard-record behavior while limiting private records.
DROP POLICY IF EXISTS care_feedback_actor_or_admin_select ON public.care_feedback;
CREATE POLICY care_feedback_actor_or_admin_select
ON public.care_feedback
FOR SELECT TO authenticated
USING (
  organization_id = current_user_org_id()
  AND (
    (
      COALESCE(context->>'privacy_class','standard')='standard'
      AND (
        is_admin()
        OR actor_id IN (
          SELECT u.id FROM public.users u
          WHERE u.organization_id=current_user_org_id()
            AND u.supabase_user_id=auth.uid()
            AND u.active=true
        )
      )
    )
    OR (
      COALESCE(context->>'privacy_class','standard')<>'standard'
      AND public.can_access_care_privacy(
        organization_id,
        context->>'privacy_class',
        context->>'privacy_reporter_id'
      )
    )
  )
);

DROP POLICY IF EXISTS care_feedback_actor_or_admin_update ON public.care_feedback;
CREATE POLICY care_feedback_actor_or_admin_update
ON public.care_feedback
FOR UPDATE TO authenticated
USING (
  organization_id = current_user_org_id()
  AND (
    (
      COALESCE(context->>'privacy_class','standard')='standard'
      AND (
        is_admin()
        OR actor_id IN (
          SELECT u.id FROM public.users u
          WHERE u.organization_id=current_user_org_id()
            AND u.supabase_user_id=auth.uid()
            AND u.active=true
        )
      )
    )
    OR (
      COALESCE(context->>'privacy_class','standard')<>'standard'
      AND public.can_access_care_privacy(
        organization_id,
        context->>'privacy_class',
        context->>'privacy_reporter_id'
      )
    )
  )
)
WITH CHECK (
  organization_id = current_user_org_id()
  AND (
    (
      COALESCE(context->>'privacy_class','standard')='standard'
      AND (
        is_admin()
        OR actor_id IN (
          SELECT u.id FROM public.users u
          WHERE u.organization_id=current_user_org_id()
            AND u.supabase_user_id=auth.uid()
            AND u.active=true
        )
      )
    )
    OR (
      COALESCE(context->>'privacy_class','standard')<>'standard'
      AND public.can_access_care_privacy(
        organization_id,
        context->>'privacy_class',
        context->>'privacy_reporter_id'
      )
    )
  )
);

DROP POLICY IF EXISTS care_feedback_insert ON public.care_feedback;
CREATE POLICY care_feedback_insert
ON public.care_feedback
FOR INSERT TO authenticated
WITH CHECK (
  organization_id IN (
    SELECT u.organization_id FROM public.users u
    WHERE u.supabase_user_id=auth.uid() AND u.active=true
  )
  AND actor_id IN (
    SELECT u.id FROM public.users u
    WHERE u.organization_id=care_feedback.organization_id
      AND u.supabase_user_id=auth.uid() AND u.active=true
  )
  AND public.can_access_care_privacy(
    organization_id,
    context->>'privacy_class',
    context->>'privacy_reporter_id'
  )
);

DROP POLICY IF EXISTS person_communications_org_select ON public.person_communications;
CREATE POLICY person_communications_org_select
ON public.person_communications
FOR SELECT TO authenticated
USING (
  organization_id=current_user_org_id()
  AND public.can_access_care_privacy(
    organization_id,
    metadata->>'privacy_class',
    metadata->>'privacy_reporter_id'
  )
);

DROP POLICY IF EXISTS person_communications_org_insert ON public.person_communications;
CREATE POLICY person_communications_org_insert
ON public.person_communications
FOR INSERT TO authenticated
WITH CHECK (
  organization_id=current_user_org_id()
  AND public.can_access_care_privacy(
    organization_id,
    metadata->>'privacy_class',
    metadata->>'privacy_reporter_id'
  )
);

DROP POLICY IF EXISTS person_communications_org_update ON public.person_communications;
CREATE POLICY person_communications_org_update
ON public.person_communications
FOR UPDATE TO authenticated
USING (
  organization_id=current_user_org_id()
  AND public.can_access_care_privacy(
    organization_id,
    metadata->>'privacy_class',
    metadata->>'privacy_reporter_id'
  )
)
WITH CHECK (
  organization_id=current_user_org_id()
  AND public.can_access_care_privacy(
    organization_id,
    metadata->>'privacy_class',
    metadata->>'privacy_reporter_id'
  )
);

DROP POLICY IF EXISTS person_communications_org_delete ON public.person_communications;
CREATE POLICY person_communications_org_delete
ON public.person_communications
FOR DELETE TO authenticated
USING (
  organization_id=current_user_org_id()
  AND public.can_access_care_privacy(
    organization_id,
    metadata->>'privacy_class',
    metadata->>'privacy_reporter_id'
  )
);

DROP POLICY IF EXISTS timeline_events_select_same_organization ON public.timeline_events;
CREATE POLICY timeline_events_select_same_organization
ON public.timeline_events
FOR SELECT TO public
USING (
  EXISTS (
    SELECT 1 FROM public.people p
    WHERE p.id=timeline_events.people_id
      AND p.organization_id=current_user_organization_id()
  )
  AND public.can_access_care_privacy(
    (
      SELECT p.organization_id::text
      FROM public.people p
      WHERE p.id=timeline_events.people_id
      LIMIT 1
    ),
    metadata->>'privacy_class',
    metadata->>'privacy_reporter_id'
  )
);

DROP POLICY IF EXISTS timeline_events_insert_same_organization ON public.timeline_events;
CREATE POLICY timeline_events_insert_same_organization
ON public.timeline_events
FOR INSERT TO public
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.people p
    WHERE p.id=timeline_events.people_id
      AND p.organization_id=current_user_organization_id()
  )
  AND public.can_access_care_privacy(
    (
      SELECT p.organization_id::text
      FROM public.people p
      WHERE p.id=timeline_events.people_id
      LIMIT 1
    ),
    metadata->>'privacy_class',
    metadata->>'privacy_reporter_id'
  )
);

DROP POLICY IF EXISTS timeline_events_update_same_organization ON public.timeline_events;
CREATE POLICY timeline_events_update_same_organization
ON public.timeline_events
FOR UPDATE TO public
USING (
  EXISTS (
    SELECT 1 FROM public.people p
    WHERE p.id=timeline_events.people_id
      AND p.organization_id=current_user_organization_id()
  )
  AND public.can_access_care_privacy(
    (
      SELECT p.organization_id::text FROM public.people p
      WHERE p.id=timeline_events.people_id LIMIT 1
    ),
    metadata->>'privacy_class',
    metadata->>'privacy_reporter_id'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.people p
    WHERE p.id=timeline_events.people_id
      AND p.organization_id=current_user_organization_id()
  )
  AND public.can_access_care_privacy(
    (
      SELECT p.organization_id::text FROM public.people p
      WHERE p.id=timeline_events.people_id LIMIT 1
    ),
    metadata->>'privacy_class',
    metadata->>'privacy_reporter_id'
  )
);

DROP POLICY IF EXISTS timeline_events_delete_same_organization ON public.timeline_events;
CREATE POLICY timeline_events_delete_same_organization
ON public.timeline_events
FOR DELETE TO public
USING (
  EXISTS (
    SELECT 1 FROM public.people p
    WHERE p.id=timeline_events.people_id
      AND p.organization_id=current_user_organization_id()
  )
  AND public.can_access_care_privacy(
    (
      SELECT p.organization_id::text FROM public.people p
      WHERE p.id=timeline_events.people_id LIMIT 1
    ),
    metadata->>'privacy_class',
    metadata->>'privacy_reporter_id'
  )
);

CREATE OR REPLACE FUNCTION public.protect_communication_privacy_metadata()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $
BEGIN
  IF COALESCE(OLD.metadata->>'privacy_class','standard')
       IS DISTINCT FROM COALESCE(NEW.metadata->>'privacy_class','standard')
     OR OLD.metadata->>'privacy_reporter_id'
       IS DISTINCT FROM NEW.metadata->>'privacy_reporter_id'
     OR OLD.metadata->>'consent_status'
       IS DISTINCT FROM NEW.metadata->>'consent_status'
  THEN
    RAISE EXCEPTION 'Care communication privacy metadata is immutable';
  END IF;
  RETURN NEW;
END;
$;

DROP TRIGGER IF EXISTS protect_person_communication_privacy_trigger ON public.person_communications;
CREATE TRIGGER protect_person_communication_privacy_trigger
BEFORE UPDATE ON public.person_communications
FOR EACH ROW EXECUTE FUNCTION public.protect_communication_privacy_metadata();

DROP TRIGGER IF EXISTS protect_timeline_privacy_trigger ON public.timeline_events;
CREATE TRIGGER protect_timeline_privacy_trigger
BEFORE UPDATE ON public.timeline_events
FOR EACH ROW EXECUTE FUNCTION public.protect_communication_privacy_metadata();


CREATE OR REPLACE FUNCTION public.protect_care_feedback_privacy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO pg_catalog
AS $
BEGIN
  IF COALESCE(OLD.context->>'privacy_class','standard')
       IS DISTINCT FROM COALESCE(NEW.context->>'privacy_class','standard')
     OR OLD.context->>'privacy_reporter_id'
       IS DISTINCT FROM NEW.context->>'privacy_reporter_id'
     OR OLD.context->>'consent_status'
       IS DISTINCT FROM NEW.context->>'consent_status'
  THEN
    RAISE EXCEPTION 'Care feedback privacy metadata is immutable';
  END IF;
  RETURN NEW;
END;
$;

DROP TRIGGER IF EXISTS protect_care_feedback_privacy_trigger ON public.care_feedback;
CREATE TRIGGER protect_care_feedback_privacy_trigger
BEFORE UPDATE ON public.care_feedback
FOR EACH ROW EXECUTE FUNCTION public.protect_care_feedback_privacy();

CREATE OR REPLACE FUNCTION public.block_outbound_when_do_not_contact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $
DECLARE
  blocked boolean := false;
BEGIN
  IF NEW.direction <> 'outbound' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('nyeocare:do-not-contact:'||NEW.organization_id||':'||NEW.person_id::text,0));

  IF TG_OP='UPDATE' THEN
    -- Delivery/read callbacks for a message sent before the restriction are historical.
    IF OLD.status IN ('sent','delivered','read')
       AND NEW.status IN ('delivered','read','completed')
       AND NEW.content IS NOT DISTINCT FROM OLD.content
       AND NEW.direction='outbound'
       AND NEW.person_id IS NOT DISTINCT FROM OLD.person_id
       AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
    THEN
      RETURN NEW;
    END IF;

    -- Metadata-only updates to an already-recorded historical contact are safe.
    IF NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.content IS NOT DISTINCT FROM OLD.content
       AND NEW.direction IS NOT DISTINCT FROM OLD.direction
       AND NEW.person_id IS NOT DISTINCT FROM OLD.person_id
       AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
    THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Cancelling an unsent draft is always allowed.
  IF NEW.status='cancelled' THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('draft','sent','delivered','read','completed') THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.aria_care_contexts c
      WHERE c.organization_id=NEW.organization_id
        AND c.person_id=NEW.person_id
        AND c.kind='other'
        AND c.metadata->>'do_not_contact'='true'
        AND (c.ends_on IS NULL OR c.ends_on>=CURRENT_DATE)
    ) INTO blocked;

    IF blocked THEN
      RAISE EXCEPTION 'Outbound communication blocked: this person has a do-not-contact restriction'
        USING ERRCODE='23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$;

DROP TRIGGER IF EXISTS block_outbound_when_do_not_contact_trigger ON public.person_communications;
CREATE TRIGGER block_outbound_when_do_not_contact_trigger
BEFORE INSERT OR UPDATE OF direction,status,content,person_id,organization_id
ON public.person_communications
FOR EACH ROW EXECUTE FUNCTION public.block_outbound_when_do_not_contact();


COMMIT;

-- supabase/migrations/20261126120000_harden_care_privacy_function_exposure.sql
-- Move care privacy and communication trigger functions out of the exposed public schema.
-- The RLS helper runs with caller privileges; only the database trigger keeps definer privileges.
BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM anon;
REVOKE ALL ON SCHEMA private FROM authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;

ALTER FUNCTION public.can_access_care_privacy(text,text,text) SET SCHEMA private;
ALTER FUNCTION public.protect_communication_privacy_metadata() SET SCHEMA private;
ALTER FUNCTION public.protect_care_feedback_privacy() SET SCHEMA private;
ALTER FUNCTION public.block_outbound_when_do_not_contact() SET SCHEMA private;

CREATE OR REPLACE FUNCTION private.can_access_care_privacy(
  p_organization_id text,
  p_privacy_class text,
  p_reporter_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND (
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
      )
    );
$function$;

REVOKE ALL ON FUNCTION private.can_access_care_privacy(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_access_care_privacy(text,text,text) FROM anon;
REVOKE ALL ON FUNCTION private.can_access_care_privacy(text,text,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION private.can_access_care_privacy(text,text,text) TO authenticated;

ALTER FUNCTION private.protect_communication_privacy_metadata() SET search_path = '';
ALTER FUNCTION private.protect_care_feedback_privacy() SET search_path = '';

REVOKE ALL ON FUNCTION private.protect_communication_privacy_metadata() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.protect_communication_privacy_metadata() FROM anon;
GRANT EXECUTE ON FUNCTION private.protect_communication_privacy_metadata() TO authenticated;

REVOKE ALL ON FUNCTION private.protect_care_feedback_privacy() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.protect_care_feedback_privacy() FROM anon;
GRANT EXECUTE ON FUNCTION private.protect_care_feedback_privacy() TO authenticated;

CREATE OR REPLACE FUNCTION private.block_outbound_when_do_not_contact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  blocked boolean := false;
BEGIN
  IF NEW.direction IS DISTINCT FROM 'outbound' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'nyeocare:do-not-contact:' || NEW.organization_id || ':' || NEW.person_id::text,
      0
    )
  );

  IF TG_OP = 'UPDATE' THEN
    -- Delivery/read callbacks for a message sent before the restriction are historical.
    IF OLD.status IN ('sent','delivered','read')
       AND NEW.status IN ('delivered','read','completed')
       AND NEW.content IS NOT DISTINCT FROM OLD.content
       AND NEW.direction = 'outbound'
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
  IF NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('draft','sent','delivered','read','completed') THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.aria_care_contexts c
      WHERE c.organization_id = NEW.organization_id
        AND c.person_id = NEW.person_id
        AND c.kind = 'other'
        AND c.metadata->>'do_not_contact' = 'true'
        AND (c.ends_on IS NULL OR c.ends_on >= CURRENT_DATE)
    ) INTO blocked;

    IF blocked THEN
      RAISE EXCEPTION 'Outbound communication blocked: this person has a do-not-contact restriction'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.block_outbound_when_do_not_contact() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.block_outbound_when_do_not_contact() FROM anon;
REVOKE ALL ON FUNCTION private.block_outbound_when_do_not_contact() FROM authenticated;


ALTER POLICY timeline_events_select_same_organization
  ON public.timeline_events TO authenticated;
ALTER POLICY timeline_events_insert_same_organization
  ON public.timeline_events TO authenticated;
ALTER POLICY timeline_events_update_same_organization
  ON public.timeline_events TO authenticated;
ALTER POLICY timeline_events_delete_same_organization
  ON public.timeline_events TO authenticated;

COMMIT;

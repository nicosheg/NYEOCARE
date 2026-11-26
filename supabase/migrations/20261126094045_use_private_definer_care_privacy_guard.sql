-- supabase/migrations/20261126094045_use_private_definer_care_privacy_guard.sql
-- SECURITY DEFINER is limited to a non-exposed schema and authenticated callers only.
-- The body rejects requests without an authenticated Supabase UID.
BEGIN;

CREATE OR REPLACE FUNCTION private.can_access_care_privacy(
  p_organization_id text,
  p_privacy_class text,
  p_reporter_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
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

COMMIT;

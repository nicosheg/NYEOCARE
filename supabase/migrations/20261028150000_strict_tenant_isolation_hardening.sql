-- NYEOCARE strict tenant isolation hardening.
-- Client-facing routes must derive tenant scope from authenticated membership.
-- Sensitive internal queues remain server-only, and tenant RLS is forced as
-- defense in depth for non-BYPASSRLS table owners.

BEGIN;

-- Explicitly deny direct PostgREST access to implementation tables that are
-- only accessed by trusted server-side handlers. RLS with no policy already
-- denies access; explicit denial plus privilege revocation makes the contract
-- visible and resistant to accidental future grants.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'person_create_requests',
    'person_identity_review_items',
    'scan_failure_alerts',
    'scan_start_requests',
    'system_diagnostic_events',
    'ai_provider_admission',
    'aria_attendance_contexts',
    'aria_care_contexts',
    'aria_global_learning',
    'aria_daily_queue_items',
    'identity_pair_decisions',
    'identity_shared_contacts',
    'invitations',
    'organization_invites',
    'scan_evidence',
    'scan_review_items',
    'aria_internal_messages'
  ] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_server_only_deny', t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
        t || '_server_only_deny', t
      );
    END IF;
  END LOOP;
END $$;

-- The session_users table has no organization_id of its own. Scope inserts and
-- deletes through both the session and the referenced user, preventing an
-- admin of one organization from attaching a foreign organization's user to
-- a local session by supplying a known UUID.
DROP POLICY IF EXISTS session_users_insert_self_or_admin ON public.session_users;
CREATE POLICY session_users_insert_self_or_admin
  ON public.session_users
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.sessions s
      WHERE s.id = session_users.session_id
        AND s.organization_id = (SELECT public.current_user_org_id())
    )
    AND EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = session_users.user_id
        AND u.organization_id = (SELECT public.current_user_org_id())
        AND u.active = true
    )
    AND (
      session_users.user_id = (SELECT public.current_app_user_id())
      OR (SELECT public.is_admin())
    )
  );

DROP POLICY IF EXISTS session_users_delete ON public.session_users;
CREATE POLICY session_users_delete
  ON public.session_users
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.sessions s
      JOIN public.users u ON u.id = session_users.user_id
      WHERE s.id = session_users.session_id
        AND s.organization_id = (SELECT public.current_user_org_id())
        AND u.organization_id = (SELECT public.current_user_org_id())
        AND (SELECT public.is_admin())
    )
  );

-- Keep organization helper functions usable by authenticated RLS policies.
-- The functions derive membership from auth.uid() and active server-side rows,
-- not from client-supplied organization IDs or mutable user metadata.
REVOKE ALL ON FUNCTION public.current_user_org_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_user_organization_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_app_user_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_owner() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.current_user_org_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_organization_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_app_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated;

-- Force policies to apply when a table is accessed by its owner (roles with
-- BYPASSRLS or superuser privileges still bypass RLS, so API tenant scoping is
-- independently mandatory). This also protects future owner-role connections.
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT DISTINCT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN information_schema.columns col
      ON col.table_schema = n.nspname
     AND col.table_name = c.relname
     AND col.column_name = 'organization_id'
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity = true
  LOOP
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t.relname);
  END LOOP;
END $$;

-- organizations is tenant-scoped by id rather than organization_id.
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.session_users FORCE ROW LEVEL SECURITY;
ALTER TABLE public.timeline_events FORCE ROW LEVEL SECURITY;

COMMIT;

-- ARIA final security/performance hardening
-- Make server-only RLS denial explicit and avoid per-row auth() re-evaluation.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ai_provider_admission',
    'aria_attendance_contexts',
    'aria_care_contexts',
    'aria_global_learning',
    'identity_pair_decisions',
    'identity_shared_contacts',
    'invitations',
    'organization_invites',
    'scan_evidence',
    'scan_review_items'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_server_only_deny', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
      t||'_server_only_deny', t
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS aria_conversations_admin_or_owner_select ON public.aria_conversations;
CREATE POLICY aria_conversations_admin_or_owner_select
  ON public.aria_conversations
  FOR SELECT
  TO authenticated
  USING (
    organization_id = (SELECT current_user_org_id())
    AND (
      (SELECT is_admin())
      OR user_id IN (
        SELECT u.id
        FROM public.users u
        WHERE u.organization_id = (SELECT current_user_org_id())
          AND u.supabase_user_id = (SELECT auth.uid())
          AND u.active = true
      )
    )
  );

DROP POLICY IF EXISTS aria_messages_admin_or_owner_select ON public.aria_messages;
CREATE POLICY aria_messages_admin_or_owner_select
  ON public.aria_messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.aria_conversations c
      WHERE c.id = aria_messages.conversation_id
        AND c.organization_id = (SELECT current_user_org_id())
        AND (
          (SELECT is_admin())
          OR c.user_id IN (
            SELECT u.id
            FROM public.users u
            WHERE u.organization_id = (SELECT current_user_org_id())
              AND u.supabase_user_id = (SELECT auth.uid())
              AND u.active = true
          )
        )
    )
  );

DROP POLICY IF EXISTS care_feedback_actor_or_admin_select ON public.care_feedback;
CREATE POLICY care_feedback_actor_or_admin_select
  ON public.care_feedback
  FOR SELECT
  TO authenticated
  USING (
    organization_id = (SELECT current_user_org_id())
    AND (
      (SELECT is_admin())
      OR actor_id IN (
        SELECT u.id
        FROM public.users u
        WHERE u.organization_id = (SELECT current_user_org_id())
          AND u.supabase_user_id = (SELECT auth.uid())
          AND u.active = true
      )
    )
  );

DROP POLICY IF EXISTS care_feedback_actor_or_admin_update ON public.care_feedback;
CREATE POLICY care_feedback_actor_or_admin_update
  ON public.care_feedback
  FOR UPDATE
  TO authenticated
  USING (
    organization_id = (SELECT current_user_org_id())
    AND (
      (SELECT is_admin())
      OR actor_id IN (
        SELECT u.id
        FROM public.users u
        WHERE u.organization_id = (SELECT current_user_org_id())
          AND u.supabase_user_id = (SELECT auth.uid())
          AND u.active = true
      )
    )
  )
  WITH CHECK (
    organization_id = (SELECT current_user_org_id())
    AND (
      (SELECT is_admin())
      OR actor_id IN (
        SELECT u.id
        FROM public.users u
        WHERE u.organization_id = (SELECT current_user_org_id())
          AND u.supabase_user_id = (SELECT auth.uid())
          AND u.active = true
      )
    )
  );

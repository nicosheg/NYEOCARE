-- ARIA organizational intelligence v2 hardening.
-- New attendance sessions must opt into meaningful absence semantics explicitly.
ALTER TABLE public.sessions
  ALTER COLUMN absence_meaningful SET DEFAULT false;

-- Internal intelligence tables are server-owned. Browser clients may read only
-- the minimum admin-scoped intelligence surfaces; writes remain on server paths.
DROP POLICY IF EXISTS aria_events_select_same_organization ON public.aria_events;
CREATE POLICY aria_events_select_admin_organization
  ON public.aria_events
  FOR SELECT TO authenticated
  USING(organization_id=current_user_org_id() AND is_admin());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'person_memory',
    'person_relationships',
    'organization_memory',
    'aria_learning',
    'aria_actions',
    'intelligence_outcomes',
    'budget_reservations',
    'ai_usage_events'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_org', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_org_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_select_same_organization', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_delete_same_organization', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_insert_same_organization', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_update_same_organization', t);
  END LOOP;
END $$;

CREATE POLICY person_memory_admin_select
  ON public.person_memory FOR SELECT TO authenticated
  USING(organization_id=current_user_org_id() AND is_admin());

CREATE POLICY person_relationships_admin_select
  ON public.person_relationships FOR SELECT TO authenticated
  USING(organization_id=current_user_org_id() AND is_admin());

CREATE POLICY organization_memory_admin_select
  ON public.organization_memory FOR SELECT TO authenticated
  USING(organization_id=current_user_org_id() AND is_admin());

CREATE POLICY aria_learning_admin_select
  ON public.aria_learning FOR SELECT TO authenticated
  USING(organization_id=current_user_org_id() AND is_admin());

CREATE POLICY aria_actions_admin_select
  ON public.aria_actions FOR SELECT TO authenticated
  USING(organization_id=current_user_org_id() AND is_admin());

CREATE POLICY intelligence_outcomes_admin_select
  ON public.intelligence_outcomes FOR SELECT TO authenticated
  USING(organization_id=current_user_org_id() AND is_admin());

CREATE POLICY budget_reservations_admin_select
  ON public.budget_reservations FOR SELECT TO authenticated
  USING(organization_id=current_user_org_id() AND is_admin());

CREATE POLICY ai_usage_events_admin_select
  ON public.ai_usage_events FOR SELECT TO authenticated
  USING(organization_id=current_user_org_id() AND is_admin());

DROP POLICY IF EXISTS care_feedback_select ON public.care_feedback;
DROP POLICY IF EXISTS care_feedback_update ON public.care_feedback;
CREATE POLICY care_feedback_actor_or_admin_select
  ON public.care_feedback FOR SELECT TO authenticated
  USING(
    organization_id=current_user_org_id()
    AND(
      is_admin()
      OR actor_id IN(
        SELECT u.id FROM public.users u
        WHERE u.organization_id=current_user_org_id()
          AND u.supabase_user_id=auth.uid()
          AND u.active=true
      )
    )
  );

CREATE POLICY care_feedback_actor_or_admin_update
  ON public.care_feedback FOR UPDATE TO authenticated
  USING(
    organization_id=current_user_org_id()
    AND(
      is_admin()
      OR actor_id IN(
        SELECT u.id FROM public.users u
        WHERE u.organization_id=current_user_org_id()
          AND u.supabase_user_id=auth.uid()
          AND u.active=true
      )
    )
  )
  WITH CHECK(
    organization_id=current_user_org_id()
    AND(
      is_admin()
      OR actor_id IN(
        SELECT u.id FROM public.users u
        WHERE u.organization_id=current_user_org_id()
          AND u.supabase_user_id=auth.uid()
          AND u.active=true
      )
    )
  );

DROP POLICY IF EXISTS aria_conversations_org ON public.aria_conversations;
CREATE POLICY aria_conversations_admin_or_owner_select
  ON public.aria_conversations FOR SELECT TO authenticated
  USING(
    organization_id=current_user_org_id()
    AND(
      is_admin()
      OR user_id IN(
        SELECT u.id FROM public.users u
        WHERE u.organization_id=current_user_org_id()
          AND u.supabase_user_id=auth.uid()
          AND u.active=true
      )
    )
  );

DROP POLICY IF EXISTS aria_messages_org ON public.aria_messages;
CREATE POLICY aria_messages_admin_or_owner_select
  ON public.aria_messages FOR SELECT TO authenticated
  USING(
    EXISTS(
      SELECT 1 FROM public.aria_conversations c
      WHERE c.id=aria_messages.conversation_id
        AND c.organization_id=current_user_org_id()
        AND(
          is_admin()
          OR c.user_id IN(
            SELECT u.id FROM public.users u
            WHERE u.organization_id=current_user_org_id()
              AND u.supabase_user_id=auth.uid()
              AND u.active=true
          )
        )
    )
  );

-- Internal tables are mutated by trusted server paths; authenticated browser
-- clients receive no direct insert/update/delete policies here.

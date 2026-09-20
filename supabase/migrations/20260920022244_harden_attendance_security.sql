-- NYEOCARE attendance/security hardening
-- Applied to production on 2026-09-20.
-- Internal ARIA tables remain server-only; RLS is enabled as defense in depth.

BEGIN;

ALTER TABLE public.ai_provider_admission ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aria_global_learning ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aria_attendance_contexts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ai_provider_admission, public.aria_global_learning, public.aria_attendance_contexts FROM anon, authenticated;

GRANT SELECT ON TABLE public.sessions, public.attendance_records TO authenticated;

DROP POLICY IF EXISTS people_insert ON public.people;
CREATE POLICY people_insert ON public.people
  FOR INSERT TO authenticated
  WITH CHECK ((organization_id = current_user_org_id()) AND is_admin());

DROP POLICY IF EXISTS people_update ON public.people;
CREATE POLICY people_update ON public.people
  FOR UPDATE TO authenticated
  USING ((organization_id = current_user_org_id()) AND is_admin())
  WITH CHECK ((organization_id = current_user_org_id()) AND is_admin());

DROP POLICY IF EXISTS session_sections_insert_same_organization ON public.session_sections;
CREATE POLICY session_sections_insert_admin
  ON public.session_sections
  FOR INSERT TO authenticated
  WITH CHECK ((organization_id = current_user_organization_id()) AND is_admin());

DROP POLICY IF EXISTS session_sections_update_same_organization ON public.session_sections;
CREATE POLICY session_sections_update_admin
  ON public.session_sections
  FOR UPDATE TO authenticated
  USING ((organization_id = current_user_organization_id()) AND is_admin())
  WITH CHECK ((organization_id = current_user_organization_id()) AND is_admin());

DROP POLICY IF EXISTS session_sections_delete_same_organization ON public.session_sections;
CREATE POLICY session_sections_delete_admin
  ON public.session_sections
  FOR DELETE TO authenticated
  USING ((organization_id = current_user_organization_id()) AND is_admin());

DROP POLICY IF EXISTS session_users_insert ON public.session_users;
CREATE POLICY session_users_insert_self_or_admin
  ON public.session_users
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.sessions s
      WHERE s.id=session_users.session_id
        AND s.organization_id=current_user_org_id()
    )
    AND (
      user_id=current_app_user_id()
      OR is_admin()
    )
  );

DROP POLICY IF EXISTS attendance_records_update ON public.attendance_records;
CREATE POLICY attendance_records_update_collaborative
  ON public.attendance_records
  FOR UPDATE TO authenticated
  USING (
    organization_id=current_user_org_id()
    AND (
      is_admin()
      OR (marked_by=current_app_user_id() AND confirmed=false)
    )
  )
  WITH CHECK (
    organization_id=current_user_org_id()
    AND (
      is_admin()
      OR (marked_by=current_app_user_id() AND confirmed=false)
    )
  );

DROP POLICY IF EXISTS attendance_records_delete ON public.attendance_records;
CREATE POLICY attendance_records_delete_collaborative
  ON public.attendance_records
  FOR DELETE TO authenticated
  USING (
    organization_id=current_user_org_id()
    AND (
      is_admin()
      OR (marked_by=current_app_user_id() AND confirmed=false)
    )
  );

COMMIT;

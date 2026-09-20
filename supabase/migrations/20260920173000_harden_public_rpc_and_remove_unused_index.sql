-- Security/performance hardening from full-system audit.
REVOKE EXECUTE ON FUNCTION public.current_app_user_id() FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.current_user_org_id() FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.current_user_organization_id() FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.current_user_role() FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.is_owner() FROM authenticated, anon;

DROP INDEX IF EXISTS public.person_communications_org_person_time_created_idx;

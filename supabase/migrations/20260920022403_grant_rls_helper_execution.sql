-- Allow authenticated Supabase clients/Realt­ime to evaluate the organization RLS policies safely.
-- Each helper is SECURITY DEFINER, auth.uid()-scoped, and has an empty search_path.

BEGIN;

REVOKE ALL ON FUNCTION public.current_user_org_id() FROM anon, public;
REVOKE ALL ON FUNCTION public.current_user_organization_id() FROM anon, public;
REVOKE ALL ON FUNCTION public.current_app_user_id() FROM anon, public;
REVOKE ALL ON FUNCTION public.current_user_role() FROM anon, public;
REVOKE ALL ON FUNCTION public.is_admin() FROM anon, public;
REVOKE ALL ON FUNCTION public.is_owner() FROM anon, public;

GRANT EXECUTE ON FUNCTION public.current_user_org_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_organization_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_app_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated;

COMMIT;
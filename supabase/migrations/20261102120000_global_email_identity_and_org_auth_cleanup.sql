-- Global operator email identity and safe organization deletion.
-- Every normal email belongs to at most one NYEOCARE organization.
-- Deleting an organization also removes its linked Supabase Auth identities,
-- releasing their email addresses for a future organization.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_global_unique
  ON public.users (lower(email));

DROP INDEX IF EXISTS public.users_org_email_unique;

CREATE TABLE IF NOT EXISTS public.organization_deletion_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  organization_name text NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  auth_accounts_deleted integer NOT NULL DEFAULT 0
);

ALTER TABLE public.organization_deletion_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_deletion_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.organization_deletion_audit FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.release_organization_auth_accounts_before_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $function$
DECLARE
  auth_user_ids uuid[];
  removed_count integer := 0;
BEGIN
  SELECT array_agg(DISTINCT u.supabase_user_id)
  INTO auth_user_ids
  FROM public.users u
  WHERE u.organization_id = OLD.id
    AND u.supabase_user_id IS NOT NULL;

  IF auth_user_ids IS NOT NULL THEN
    DELETE FROM auth.users a
    WHERE a.id = ANY(auth_user_ids);
    GET DIAGNOSTICS removed_count = ROW_COUNT;
  END IF;

  INSERT INTO public.organization_deletion_audit (
    organization_id,
    organization_name,
    auth_accounts_deleted
  ) VALUES (OLD.id, OLD.name, removed_count);

  RETURN OLD;
END;
$function$;

REVOKE ALL ON FUNCTION public.release_organization_auth_accounts_before_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS organizations_release_auth_accounts_before_delete
  ON public.organizations;

CREATE TRIGGER organizations_release_auth_accounts_before_delete
BEFORE DELETE ON public.organizations
FOR EACH ROW
EXECUTE FUNCTION public.release_organization_auth_accounts_before_delete();

COMMIT;

-- ARIA universal continuity and activity history.
-- Every authenticated NYEOCARE API request is recorded without storing request bodies.
CREATE TABLE IF NOT EXISTS public.aria_activity_log(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  actor_role text NULL,
  request_id text NULL,
  route text NOT NULL,
  method text NOT NULL,
  action_kind text NOT NULL DEFAULT 'read',
  entity_type text NULL,
  entity_id text NULL,
  status_code integer NULL,
  success boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS aria_activity_log_org_time_idx ON public.aria_activity_log(organization_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS aria_activity_log_org_actor_time_idx ON public.aria_activity_log(organization_id,actor_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS aria_activity_log_org_route_time_idx ON public.aria_activity_log(organization_id,route,occurred_at DESC);
ALTER TABLE public.aria_activity_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS aria_activity_log_admin_select ON public.aria_activity_log;
CREATE POLICY aria_activity_log_admin_select ON public.aria_activity_log
 FOR SELECT TO authenticated
 USING(organization_id=current_user_org_id() AND is_admin());

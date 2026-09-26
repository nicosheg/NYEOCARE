-- ARIA final architecture hardening: aggregate AI budgets + idempotent text responses
ALTER TABLE IF EXISTS budget_reservations
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE INDEX IF NOT EXISTS budget_reservations_org_created_purpose_idx
  ON budget_reservations(organization_id, created_at DESC, purpose);

CREATE TABLE IF NOT EXISTS ai_request_cache(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL,
  idempotency_key text NOT NULL,
  model_key text NOT NULL,
  provider text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  expires_at timestamptz NOT NULL DEFAULT (NOW()+INTERVAL '1 hour'),
  CONSTRAINT ai_request_cache_org_key_unique UNIQUE(organization_id,idempotency_key)
);

CREATE INDEX IF NOT EXISTS ai_request_cache_org_expiry_idx
  ON ai_request_cache(organization_id,expires_at);

ALTER TABLE ai_request_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_request_cache_admin_select ON ai_request_cache;
CREATE POLICY ai_request_cache_admin_select
  ON ai_request_cache
  FOR SELECT
  TO authenticated
  USING((organization_id=current_user_org_id()) AND is_admin());

REVOKE INSERT,UPDATE,DELETE ON ai_request_cache FROM anon,authenticated;

-- Server-side budget enforcement is organization-wide. Purpose remains telemetry only.

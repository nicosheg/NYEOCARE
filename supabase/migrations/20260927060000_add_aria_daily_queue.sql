-- Durable per-operator daily work queue for ARIA Today.
CREATE TABLE IF NOT EXISTS aria_daily_queue_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id TEXT NOT NULL,
  assigned_user_id UUID NOT NULL,
  queue_date DATE NOT NULL,
  task_kind TEXT NOT NULL CHECK (task_kind IN ('scan_review','follow_up','action','observation')),
  source_id TEXT NOT NULL,
  person_id UUID NULL,
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','deferred','completed','dismissed')),
  defer_count INTEGER NOT NULL DEFAULT 0 CHECK (defer_count >= 0),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_deferred_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, task_kind, source_id)
);

CREATE INDEX IF NOT EXISTS aria_daily_queue_today_idx
  ON aria_daily_queue_items (organization_id, queue_date, assigned_user_id, status, priority DESC);

CREATE INDEX IF NOT EXISTS aria_daily_queue_open_idx
  ON aria_daily_queue_items (organization_id, status, queue_date);

COMMENT ON TABLE aria_daily_queue_items IS
'Durable ARIA Today work queue. Review Center remains the full unresolved-input workbench; this table compresses open organizational work into daily operator queues.';

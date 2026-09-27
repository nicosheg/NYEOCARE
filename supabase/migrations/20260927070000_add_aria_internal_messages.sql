-- ARIA internal operator messaging
-- Internal NYEOCARE messages are server-owned. The recipient sees them in ARIA Today.

CREATE TABLE IF NOT EXISTS public.aria_internal_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  recipient_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'sent',
  sent_at timestamptz NOT NULL DEFAULT now(),
  seen_at timestamptz,
  unsent_at timestamptz,
  unsent_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  idempotency_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT aria_internal_messages_status_check CHECK (status IN ('sent','unsent')),
  CONSTRAINT aria_internal_messages_body_check CHECK (length(trim(body)) BETWEEN 1 AND 4000)
);

CREATE UNIQUE INDEX IF NOT EXISTS aria_internal_messages_idempotency_uidx
  ON public.aria_internal_messages (organization_id,sender_user_id,idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS aria_internal_messages_recipient_inbox_idx
  ON public.aria_internal_messages (organization_id,recipient_user_id,status,sent_at DESC);

CREATE INDEX IF NOT EXISTS aria_internal_messages_unseen_idx
  ON public.aria_internal_messages (organization_id,recipient_user_id,status,seen_at,sent_at DESC);

CREATE INDEX IF NOT EXISTS aria_internal_messages_sender_idx
  ON public.aria_internal_messages (organization_id,sender_user_id,sent_at DESC);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='aria_daily_queue_items_task_kind_check'
      AND conrelid='public.aria_daily_queue_items'::regclass
  ) THEN
    ALTER TABLE public.aria_daily_queue_items
      DROP CONSTRAINT aria_daily_queue_items_task_kind_check;
  END IF;
  ALTER TABLE public.aria_daily_queue_items
    ADD CONSTRAINT aria_daily_queue_items_task_kind_check
    CHECK (task_kind IN ('scan_review','follow_up','action','observation','internal_message'));
END $$;

ALTER TABLE public.aria_internal_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aria_daily_queue_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS aria_internal_messages_server_only_deny ON public.aria_internal_messages;
CREATE POLICY aria_internal_messages_server_only_deny
  ON public.aria_internal_messages
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS aria_daily_queue_items_server_only_deny ON public.aria_daily_queue_items;
CREATE POLICY aria_daily_queue_items_server_only_deny
  ON public.aria_daily_queue_items
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.tg_touch_aria_internal_messages()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_aria_internal_messages ON public.aria_internal_messages;
CREATE TRIGGER trg_touch_aria_internal_messages
  BEFORE UPDATE ON public.aria_internal_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_touch_aria_internal_messages();

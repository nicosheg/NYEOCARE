-- Harden ARIA internal messaging DB helpers and foreign-key indexes.
CREATE INDEX IF NOT EXISTS aria_internal_messages_sender_fk_idx
  ON public.aria_internal_messages (sender_user_id);

CREATE INDEX IF NOT EXISTS aria_internal_messages_recipient_fk_idx
  ON public.aria_internal_messages (recipient_user_id);

CREATE INDEX IF NOT EXISTS aria_internal_messages_unsent_by_fk_idx
  ON public.aria_internal_messages (unsent_by)
  WHERE unsent_by IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tg_touch_aria_internal_messages()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

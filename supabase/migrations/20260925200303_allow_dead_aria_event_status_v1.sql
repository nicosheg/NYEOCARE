-- Allow durable dead-letter state used by the canonical ARIA event processor.
ALTER TABLE public.aria_events
  DROP CONSTRAINT IF EXISTS aria_events_processing_status_check;

ALTER TABLE public.aria_events
  ADD CONSTRAINT aria_events_processing_status_check
  CHECK (processing_status IN ('pending','processing','completed','failed','skipped','dead'));

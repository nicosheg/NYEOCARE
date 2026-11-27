-- supabase/migrations/20261127160000_restrict_legacy_person_journey_notes.sql
-- Legacy Person Journey notes predate canonical private care intake.
-- Preserve the historical record, but default it to restricted visibility because
-- the original reporter cannot be safely reconstructed from the legacy row.
BEGIN;

DROP TRIGGER IF EXISTS protect_timeline_privacy_trigger ON public.timeline_events;

UPDATE public.timeline_events
SET metadata = COALESCE(metadata, '{}'::jsonb)
  || jsonb_build_object(
    'privacy_class', 'restricted',
    'legacy_private_care_note', true
  )
WHERE event_type IN ('note', 'pastoral_note')
  AND COALESCE(metadata->>'privacy_class', 'standard') = 'standard';

CREATE TRIGGER protect_timeline_privacy_trigger
BEFORE UPDATE ON public.timeline_events
FOR EACH ROW
EXECUTE FUNCTION private.protect_communication_privacy_metadata();

COMMIT;

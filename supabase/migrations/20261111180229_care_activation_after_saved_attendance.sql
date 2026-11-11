-- supabase/migrations/20261111180229_care_activation_after_saved_attendance.sql
-- Person registration is identity capture, not confirmed participation or an automatic care trigger.
-- Retire only observations emitted by PERSON_CREATED, their derived open queue items,
-- and zero-participation welcome projections. Keep people and attendance history intact.

WITH machine_created AS (
  SELECT o.id,o.organization_id
  FROM public.aria_observations o
  JOIN public.aria_events e
    ON e.organization_id=o.organization_id
   AND e.id::text=o.metadata->>'source_event_id'
  WHERE o.type='NEW_PERSON'
    AND o.status='active'
    AND e.type='PERSON_CREATED'
)
UPDATE public.aria_daily_queue_items q
SET status='dismissed',
    completed_at=COALESCE(q.completed_at,NOW()),
    updated_at=NOW()
FROM machine_created m
WHERE q.organization_id=m.organization_id
  AND q.source_id=m.id::text
  AND q.task_kind IN('action','follow_up','observation')
  AND q.status IN('pending','deferred');

UPDATE public.aria_observations o
SET status='resolved',
    resolved_at=COALESCE(o.resolved_at,NOW()),
    updated_at=NOW()
FROM public.aria_events e
WHERE e.organization_id=o.organization_id
  AND e.id::text=o.metadata->>'source_event_id'
  AND e.type='PERSON_CREATED'
  AND o.type='NEW_PERSON'
  AND o.status='active';

UPDATE public.people_intelligence pi
SET next_best_action=NULL,
    action_reason='No confirmed participation is recorded yet. An automatic first-visit care suggestion waits until attendance is saved.',
    updated_at=NOW()
WHERE pi.next_best_action='welcome_and_onboard'
  AND COALESCE(NULLIF(pi.evidence->>'participation_count','')::numeric,0)=0;

UPDATE public.aria_person_state aps
SET next_best_action=NULL,
    followup_state='none',
    attention_reason='No confirmed participation is recorded yet. An automatic first-visit care suggestion waits until attendance is saved.',
    updated_at=NOW()
WHERE aps.next_best_action='welcome_and_onboard'
  AND aps.lifecycle_state='new';

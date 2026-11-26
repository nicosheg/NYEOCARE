-- supabase/migrations/20261126103000_retire_remaining_automatic_attendance_care.sql
-- Attendance observations are evidence. They are not automatic contact duties.
-- Retire any open outreach proposals created by older attendance processors,
-- including cases with verified registers. Keep all observations and outcomes.

UPDATE public.aria_daily_queue_items q
SET status='dismissed',
    completed_at=COALESCE(q.completed_at,NOW()),
    updated_at=NOW()
FROM public.aria_actions a
WHERE q.organization_id=a.organization_id
  AND q.source_id=a.id::text
  AND q.task_kind='follow_up'
  AND q.status IN('pending','deferred')
  AND a.status IN('proposed','approved')
  AND a.action_metadata->>'kind' IN('attendance_absence_check_in','returned_after_absence');

UPDATE public.aria_actions
SET status='cancelled',
    failure_reason='Retired: attendance non-observation or return is evidence, not an automatic contact duty. A human may create a new responsibility when a real need is known.',
    updated_at=NOW()
WHERE status IN('proposed','approved')
  AND action_metadata->>'kind' IN('attendance_absence_check_in','returned_after_absence');

COMMENT ON FUNCTION public.nyeocare_attendance_stage(uuid,text,text) IS
  'Attendance absence outreach is paused. Return observations and attendance context may remain in ARIA history; automatic absence/return contact actions are retired. New care responsibilities require an explicit human decision or an allowed first-visit outcome.';

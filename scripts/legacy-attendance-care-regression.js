// scripts/legacy-attendance-care-regression.js
const assert=require('node:assert/strict');
const fs=require('node:fs');
const migration=fs.readFileSync('supabase/migrations/20261126100000_disable_legacy_attendance_absence_actions.sql','utf8');
const retireRemaining=fs.readFileSync('supabase/migrations/20261126103000_retire_remaining_automatic_attendance_care.sql','utf8');
const processor=fs.readFileSync('lib/aria/attendanceProcessor.js','utf8');
const queue=fs.readFileSync('lib/dailyQueue.js','utf8');
const actionable=fs.readFileSync('lib/aria/actionableObservationTypes.js','utf8');

assert.ok(migration.includes("RENAME TO nyeocare_attendance_stage_legacy_20261126"),
  'the old SQL stage must be retained under an auditable legacy name');
assert.ok(migration.includes("IF v_stage = 'absence_signals'")&&
  migration.includes("'automatic_attendance_care_paused'"),
  'the live database worker must no longer create attendance absence tasks through its legacy stage');
assert.ok(migration.includes("IF v_stage = 'return_signals'")&&
  migration.includes("kind' = 'returned_after_absence'")&&
  migration.includes("'automatic_return_followups_suppressed'"),
  'return observations may remain in history but must not become automatic outreach obligations');
assert.ok(migration.includes("register_completeness IS DISTINCT FROM 'complete'")&&
  migration.includes('register_source IS NULL')&&
  migration.includes('register_reviewed_at IS NULL')&&
  migration.includes('register_reviewed_by IS NULL'),
  'cleanup must retire open absence-derived work whose register has no complete human provenance');
assert.ok(migration.includes("status IN ('proposed', 'approved')")&&
  migration.includes('No message was sent.')&&
  migration.includes("status = 'dismissed'"),
  'cleanup must be restricted to open, unsent proposals and dismiss only their pending queue rows');
assert.ok(migration.includes('UPDATE public.aria_observations o')&&
  migration.includes("o.type = 'UNUSUAL_ABSENCE'")&&
  migration.includes("SET status = 'resolved'")&&migration.includes('resolved_at = COALESCE(o.resolved_at, NOW())'),
  'invalid legacy observations must be resolved without deleting attendance or person history');
assert.ok(retireRemaining.includes("action_metadata->>'kind' IN('attendance_absence_check_in','returned_after_absence')")&&
  retireRemaining.includes("status IN('proposed','approved')")&&retireRemaining.includes("status='dismissed'")&&
  retireRemaining.includes("status='cancelled'"),
  'all remaining automatic absence and return outreach proposals must be retired without deleting observations or sent outcomes');
assert.ok(processor.includes('ATTENDANCE_CARE_FOLLOW_UP_ENABLED = false'),
  'the JavaScript guard must remain aligned with the database worker guard');
assert.ok(!actionable.includes("'UNUSUAL_ABSENCE'")&&!actionable.includes("'ATTENDANCE_NOT_OBSERVED'"),
  'legacy unusual-absence observations must not independently re-enter the human queue');
assert.ok(queue.includes('ACTIONABLE_OBSERVATION_TYPES'),
  'the canonical queue must continue to use the shared actionable-observation registry');

console.log('[LEGACY ATTENDANCE CARE] SQL worker gate, return-signal restraint, provenance cleanup and queue policy passed.');

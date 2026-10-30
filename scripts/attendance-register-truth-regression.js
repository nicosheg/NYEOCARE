// scripts/attendance-register-truth-regression.js
const assert=require('node:assert/strict');
const fs=require('node:fs');

const read=path=>fs.readFileSync(path,'utf8');
const files={
 migration:read('supabase/migrations/20261030150000_attendance_register_truth_and_provenance.sql'),
 createSession:read('pages/api/attendance/create-session.js'),
 closeSession:read('pages/api/attendance/close-session.js'),
 attendanceUi:read('components/AttendanceModal.js'),
 attendanceProcessor:read('lib/aria/attendanceProcessor.js'),
 attendanceIntelligence:read('lib/aria/attendanceIntelligence.js'),
 priorityQueue:read('lib/aria/priorityQueue.js'),
 careQueue:read('pages/api/care-queue.js'),
 cohort:read('lib/aria/cohortEngine.js'),
 eventProcessor:read('lib/aria/eventProcessor.js'),
 dailyQueue:read('lib/dailyQueue.js'),
 organizationPolicyUi:read('components/ChurchProfileTab.js')
};

const absenceProcessor=files.attendanceProcessor.slice(
  files.attendanceProcessor.indexOf('async function createAbsenceSignals'),
  files.attendanceProcessor.indexOf('async function createReturnSignals')
);

assert.ok(files.migration.includes("register_completeness text NOT NULL DEFAULT 'unconfirmed'"),
  'new and historical sessions must start as unconfirmed, not complete');
assert.ok(files.migration.includes("CHECK (register_completeness IN ('unconfirmed','incomplete','complete'))"),
  'register completeness must be constrained to explicit states');
assert.ok(files.migration.includes("register_source IS NOT NULL AND register_reviewed_at IS NOT NULL AND register_reviewed_by IS NOT NULL"),
  'a complete register must carry source and accountable operator provenance');
assert.ok(files.migration.includes('attendance_register_events')&&files.migration.includes('FORCE ROW LEVEL SECURITY'),
  'register declarations need a server-owned audit trail');
assert.ok(files.migration.includes("WHERE type='UNUSUAL_ABSENCE' AND status='active'")&&
  files.migration.includes("action_metadata->>'kind' IN('care_first_check_in','attendance_absence_check_in','returned_after_absence')"),
  'unverified historical absence signals must be retired rather than carried forward');

assert.ok(files.createSession.includes('const absenceMeaningful=absence_meaningful===true')&&
  !files.createSession.includes('normalizeFollowUpPolicy'),
  'a new event cannot inherit a weekly attendance expectation from organization settings');
assert.ok(files.attendanceUi.includes('const[absenceMeaningful,setAbsenceMeaningful]=useState(false)')&&
  files.attendanceUi.includes('absence_meaningful:absenceMeaningful===true'),
  'event-level non-observation must be an explicit opt-in that defaults off');

assert.ok(files.attendanceUi.includes('value="unconfirmed"')&&
  files.attendanceUi.includes('value="incomplete"')&&
  files.attendanceUi.includes('value="complete"')&&
  files.attendanceUi.includes('register_completeness:registerCompleteness'),
  'the operator must explicitly declare the register state when saving');
assert.ok(files.attendanceUi.includes('registerSource===\'digital_roster\'&&!rosterSnapshotComplete')&&
  files.attendanceUi.includes('pendingCount>0||legacyPendingCount>0')&&
  files.attendanceUi.includes('offline save cannot certify the register as complete'),
  'a digital register cannot be declared complete from a partial roster or unsynced offline changes');

assert.ok(files.closeSession.includes("!['unconfirmed','incomplete','complete'].includes(register_completeness)")&&
  files.closeSession.includes('register_completeness=$5')&&
  files.closeSession.includes('register_reviewed_by=$1')&&
  files.closeSession.includes('attendance_register_events')&&
  files.closeSession.includes("await client.query('COMMIT')"),
  'the authenticated save transaction must persist register state and its audit record atomically');

assert.ok(absenceProcessor.includes("register_completeness==='complete'")&&
  absenceProcessor.includes('register_source')&&
  absenceProcessor.includes('register_reviewed_at')&&
  absenceProcessor.includes('register_reviewed_by')&&
  absenceProcessor.includes('register_not_confirmed_complete'),
  'non-observation processing must fail closed unless the session has complete-register provenance');
assert.ok(absenceProcessor.includes("hs.register_completeness='complete'")&&
  absenceProcessor.includes('hs.register_reviewed_by IS NOT NULL'),
  'historical service-frequency denominators must exclude unverified and incomplete registers');
assert.ok(absenceProcessor.includes("'ATTENDANCE_NOT_OBSERVED'")&&
  absenceProcessor.includes("'REQUEST_REVIEW'")&&
  absenceProcessor.includes("'attendance_register_review'")&&
  absenceProcessor.includes("'draft_required',false")&&
  !absenceProcessor.includes("'UNUSUAL_ABSENCE'")&&
  !absenceProcessor.includes("'care_first_check_in'"),
  'the new signal must be a human register review, never an absence claim or automatic message');
assert.ok(absenceProcessor.includes('does not prove why the person was not recorded')&&
  absenceProcessor.includes('does not prove physical absence'),
  'signal evidence must explicitly separate non-observation from physical absence and personal explanation');

assert.ok(!files.priorityQueue.includes("WHEN inactivity_streak>=4 THEN'extended_absence'")&&
  !files.priorityQueue.includes("WHEN trend<=-.25 OR deviation<=-.25 THEN'emerging_attendance_decline'"),
  'calendar gaps and trend changes alone must not create an absence/decline care signal');
assert.ok(!files.attendanceIntelligence.includes("WHEN trend<-.45 THEN 'thoughtful_check_in'"),
  'attendance-only trend must not independently create a care recommendation');
assert.ok(!files.careQueue.includes('consecutive_misses')&&
  !files.careQueue.includes('attendance_items AS')&&
  !files.careQueue.includes('was not recorded at'),
  'the Care Queue must not maintain a second unverified attendance-inference engine');
assert.ok(files.cohort.includes("attendance_population:'not_inferred'")&&
  files.cohort.includes('event population resolver')&&
  !files.cohort.includes('ar.confirmed=true AND ar.present=false'),
  'an absentee cohort must not be derived until event-specific expected population is resolvable');

assert.ok(files.eventProcessor.includes("o.type IN('UNUSUAL_ABSENCE','ATTENDANCE_NOT_OBSERVED')")&&
  files.eventProcessor.includes('attendance_register_review'),
  'later confirmed participation must resolve the new register-review signal and action');
assert.ok(files.organizationPolicyUi.includes('not an automatic absence detector')&&
  files.organizationPolicyUi.includes('register complete'),
  'organization settings must explain the limited role of the attendance review permission');
assert.ok(!files.dailyQueue.includes("m?.kind==='attendance_register_review'"),
  'register-review work must remain a review/action item, not enter the message follow-up lane');

console.log('[ATTENDANCE REGISTER TRUTH] All fail-closed, provenance, UI, cohort, and legacy-cleanup checks passed.');

// scripts/attendance-register-truth-regression.js
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=path=>fs.readFileSync(path,'utf8');

const files={
 registerMigration:read('supabase/migrations/20261030144541_attendance_register_truth_and_provenance.sql'),
 autoCloseMigration:read('supabase/migrations/20261030160000_attendance_session_auto_close.sql'),
 createSession:read('pages/api/attendance/create-session.js'),
 closeSession:read('pages/api/attendance/close-session.js'),
 activeSession:read('pages/api/attendance/active-session.js'),
 sync:read('pages/api/attendance/sync.js'),
 visitor:read('pages/api/attendance/add-visitor.js'),
 correction:read('pages/api/attendance/aria-correction.js'),
 attendanceUi:read('components/AttendanceModal.js'),
 fieldMode:read('lib/attendanceFieldMode.js'),
 attendanceProcessor:read('lib/aria/attendanceProcessor.js'),
 home:read('pages/index.js'),
 churchProfile:read('components/ChurchProfileTab.js')
};

assert.ok(files.registerMigration.includes("register_completeness text NOT NULL DEFAULT 'unconfirmed'")&&
  files.registerMigration.includes('attendance_register_events')&&
  files.registerMigration.includes('FORCE ROW LEVEL SECURITY')&&
  files.registerMigration.includes('BEFORE TRUNCATE ON public.attendance_register_events'),
  'register provenance and its append-only backend audit trail must remain in place');

assert.ok(files.autoCloseMigration.includes('auto_close_at timestamptz')&&
  files.autoCloseMigration.includes('attendance_session_roster')&&
  files.autoCloseMigration.includes('public.nyeocare_finalize_attendance_session')&&
  files.autoCloseMigration.includes('FOR UPDATE SKIP LOCKED')&&
  files.autoCloseMigration.includes("THEN 'auto_close'")&&
  files.autoCloseMigration.includes("'not_present'")&&
  files.autoCloseMigration.includes("cron.schedule(\n  'nyeocare-attendance-auto-close',\n  '1 second'")&&
  files.autoCloseMigration.includes("pgmq.send(\n        'nyeocare-attendance'"),
  'server-side deadline finalization must snapshot people, mark unmarked people not present, audit the closure, and enqueue normal processing');

assert.ok(files.createSession.includes('const absenceMeaningful=false')&&
  files.createSession.includes('auto_close_at')&&
  files.createSession.includes("TIME '23:59'")&&
  files.createSession.includes('attendance_session_roster')&&
  files.createSession.includes("'session_start'"),
  'new attendance sessions must use the organization-local deadline and capture the expected roster at the start');
assert.ok(files.createSession.includes("ELSE started_at+INTERVAL '24 hours'")&&
  files.createSession.includes("LEAST(started_at+INTERVAL '24 hours',end_of_day)"),
  'the deadline must be the earlier of 24 hours after the start or 23:59 on the same local day');

assert.ok(files.closeSession.includes('nyeocare_finalize_attendance_session')&&
  files.closeSession.includes('manual_confirmation')&&
  files.closeSession.includes('enqueueAttendanceProcessing')&&
  files.closeSession.includes("await client.query('COMMIT')"),
  'manual confirmation must finalize attendance and enqueue background processing atomically');
assert.ok(files.activeSession.includes('auto_close_at')&&
  files.activeSession.includes('last_closed_session_id')&&
  files.activeSession.includes('organization_timezone'),
  'the active-session API must expose the deadline and identify a just-closed local session');

assert.ok(!files.attendanceUi.includes('Use verified non-observation for a care review in this event')&&
  !files.attendanceUi.includes('Register completeness')&&
  !files.attendanceUi.includes('registerCompleteness')&&
  !files.attendanceUi.includes('registerSource')&&
  files.attendanceUi.includes('Save attendance?')&&
  files.attendanceUi.includes('Have you finished marking everyone who attended?')&&
  files.attendanceUi.includes('Yes, save attendance')&&
  files.attendanceUi.includes('onClick={()=>setShowFinishConfirm(false)}')&&
  files.attendanceUi.includes('Attendance stays live for everyone')&&
  files.attendanceUi.includes('saves automatically by'),
  'the attendance screen must be plain, contain a yes/cancel confirmation, and explain that it stays live until server auto-save');
assert.ok(files.attendanceUi.includes("const mark=async(id,isMarked)=>")&&
  files.attendanceUi.includes("if(!session||session.status!=='active'||closing)return")&&
  files.attendanceUi.includes("onClick={()=>mark(p.id,Boolean(p.marked))}")&&
  files.attendanceUi.includes("onClick={discard}"),
  'present toggles and the existing discard flow must remain available on live sessions');

assert.ok(files.visitor.includes('attendance_session_roster')&&
  files.visitor.includes('attendance_visitor'),
  'visitors added during a live event must join the session roster snapshot');
assert.ok(files.fieldMode.includes("data.attendance_closed===true")&&
  files.fieldMode.includes('needsAdminVerification')&&
  !files.fieldMode.includes('client_updated_at'),
  'offline marks must remain local and ask for an admin after a session has already closed; browser timestamps must not override a closed record');
assert.ok(files.sync.includes("session.status === 'closed'")&&
  files.sync.includes('requires_admin_verification: true')&&
  files.sync.includes('An owner or admin must verify any later attendance correction through ARIA')&&
  !files.sync.includes('auto_reconcile'),
  'offline sync must never silently rewrite an auto-finalized attendance record');
assert.ok(files.correction.includes('withAdmin')&&
  files.correction.includes('verified!==true')&&
  files.correction.includes("source='admin_correction'")&&
  files.correction.includes('attendance_register_events'),
  'later attendance corrections must require an admin and an explicit human verification');
assert.ok(files.home.includes('attendanceDecision!==null')&&
  files.home.includes('Please verify this against what you know')&&
  files.home.includes('verified:true')&&
  files.home.includes('Yes, I verify they attended'),
  'ARIA must ask an administrator to verify before changing a saved attendance record');

assert.ok(files.attendanceProcessor.includes('ATTENDANCE_CARE_FOLLOW_UP_ENABLED = false')&&
  files.attendanceProcessor.includes("skipped:'attendance_care_follow_up_paused'")&&
  files.attendanceProcessor.includes('async function createFirstVisitFollowUps')&&
  files.attendanceProcessor.includes('async function createReturnSignals(sessionId,orgId) {\\n  if(!ATTENDANCE_CARE_FOLLOW_UP_ENABLED)'),
  'attendance-derived absence and return follow-ups must stay paused while first-visit care processing remains in place');
assert.ok(!files.churchProfile.includes('Allow register-based attendance reviews')&&
  files.churchProfile.includes('Require first-visit follow-up'),
  'the obsolete attendance-care toggle must be removed without removing first-visit care settings');

console.log('[ATTENDANCE FLOW] Simple UI, server deadline, roster finalization, admin verification, offline protection and care separation passed.');

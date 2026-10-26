const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const serviceIdentity = read('lib/aria/serviceIdentity.js');
const processor = read('lib/aria/attendanceProcessor.js');
const intelligence = read('lib/aria/attendanceIntelligence.js');
const createSession = read('pages/api/attendance/create-session.js');
const temporal = read('lib/aria/temporalEngine.js');
const organizationContext = read('lib/aria/organizationContext.js');
const director = read('lib/aria/directorEngine.js');
const directorState = read('lib/aria/director.js');
const memory = read('lib/aria/organizationMemory.js');
const recommendations = read('lib/aria/recommendationEngine.js');
const packageJson = JSON.parse(read('package.json'));
const ci = read('.github/workflows/ci.yml');
const attendanceUi = read('components/AttendanceModal.js');
const universalWorkspace = read('lib/aria/universalWorkspace.js');
const personJourney = read('pages/api/person/journey.js');
const sectionCheckin = read('pages/api/attendance/section-checkin.js');
const attendanceMark = read('pages/api/attendance/mark.js');
const attendanceSync = read('pages/api/attendance/sync.js');
const attendanceCorrection = read('pages/api/attendance/aria-correction.js');
const universalWorkspace = read('lib/aria/universalWorkspace.js');
const eventDate = read('lib/attendance/eventDate.js');

assert.ok(serviceIdentity.includes("THEN ${alias}.service_type") && serviceIdentity.includes("ELSE COALESCE(${alias}.name,'')") &&
  serviceIdentity.includes("!~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'"),
  'opaque UUID service IDs should fall back to the entered session name instead of merging distinct services');

assert.ok(sectionCheckin.includes('SELECT s.id, s.started_at') &&
  sectionCheckin.includes('eventAttendanceDate(session.rows[0].started_at,session.rows[0].organization_timezone)') &&
  sectionCheckin.includes('SELECT v.person_id,$6::date,true') &&
  sectionCheckin.includes('[orgId,session_id,section.rows[0].id,userId,peopleIds,attendanceDate]'),
  'Section attendance must persist the organization-local event date, not the delayed submission date.');
assert.doesNotMatch(sectionCheckin, /CURRENT_DATE/, 'Section submissions must not stamp attendance using the database server current date.');
assert.ok(eventDate.includes("const DEFAULT_TIME_ZONE = 'Africa/Lagos'") &&
  eventDate.includes('normalizeOrganizationTimeZone') && eventDate.includes('formatToParts'),
  'Attendance event dates must use a validated organization time zone with a safe Lagos fallback.');
for (const [label, source] of [
  ['individual attendance', attendanceMark],
  ['offline attendance sync', attendanceSync],
  ['section attendance', sectionCheckin],
  ['admin attendance correction', attendanceCorrection],
  ['ARIA workspace attendance', universalWorkspace]
]) {
  assert.ok(source.includes('eventAttendanceDate') && source.includes('organization_timezone'),
    label + ' must derive attendance_date from the event timestamp in the organization time zone.');
  assert.doesNotMatch(source, /toISOString\(\)\.slice\(0,\s*10\)/,
    label + ' must not derive an event calendar date by slicing the UTC timestamp.');
}

const sessionLockAt = attendanceMark.indexOf('FOR SHARE OF s');
const personEventLockAt = attendanceMark.indexOf('nyeocare:attendance-mark:');
const existingAttendanceReadAt = attendanceMark.indexOf('SELECT id,confirmed,present FROM attendance_records');
assert.ok(sessionLockAt >= 0 && sessionLockAt < personEventLockAt && personEventLockAt < existingAttendanceReadAt,
  'attendance must stabilize session state, lock the person/event pair, then read canonical attendance');
assert.ok(attendanceMark.includes('pg_advisory_xact_lock(hashtextextended($1,0))'),
  'same-person attendance updates must serialize while different people are marked concurrently');
assert.doesNotMatch(attendanceMark, /LIMIT 1 FOR UPDATE OF s/,
  'independent live marks must not contend on an exclusive session-row lock');

assert.ok(createSession.includes("[orgId,name.trim(),service_type||null,userId,event_kind||'service'"),
  'attendance session creation must persist service_type and started_by in their correct positions instead of grouping services by creator UUID');

assert.match(serviceIdentity, /REGEXP_REPLACE/,
  'dated session names should be normalized rather than treated as different services');
assert.match(serviceIdentity, /weekday:/,
  'weekday is only a fallback when there is no explicit service identity');

assert.ok(processor.includes("COALESCE(s.started_at,ar.attendance_date::timestamptz,ar.marked_at)"),
  'participation time must be anchored to the session/attendance date, not the delayed mark time');
assert.ok(processor.includes("JOIN sessions hs ON hs.id=pr.session_id AND hs.organization_id=pr.organization_id"),
  'historical attendance must join its source session so service identity is available');
assert.ok(processor.includes("s.event_scope,s.group_id,s.attendance_interpretation"),
  'the service query must include group scope used by its candidate filter');
assert.ok(processor.includes("${serviceKeySql('hs')}=s.service_key"),
  'absence comparison must match the same service, not every service on the same weekday');
assert.ok(processor.includes("h.prior_84>=2") &&
  processor.includes("service_frequency AS") &&
  processor.includes("h.prior_84::numeric/GREATEST(f.expected_84,1)>=0.5") &&
  processor.includes("CEIL(f.expected_28::numeric*0.4)") &&
  processor.includes("COALESCE(hs.group_id::text,'')=COALESCE(s.group_id::text,'')") &&
  processor.includes("'attendance_rate_84d',c.prior_attendance_rate"),
  'absence signals must adapt to the observed service frequency, attendance rate and event/group identity');
assert.ok(processor.includes("o.evidence->>'service_key'=(SELECT ${serviceKeySql('cs')}"),
  'return signals must be scoped to the same service');
assert.ok(processor.includes("a.action_metadata->>'service_key'=(SELECT ${serviceKeySql('cs')}"),
  'attendance actions must preserve and use service identity');
assert.ok(processor.includes("AND ac.session_id IN (SELECT ps.id FROM sessions ps"),
  'attendance contexts should only resolve after a return to the matching service');

assert.ok(createSession.includes('normalizeFollowUpPolicy') &&
  createSession.includes('attendancePatternFollowUpEnabled') &&
  createSession.includes("typeof absence_meaningful==='boolean'") &&
  createSession.includes("followUpPolicy.attendancePatternFollowUpEnabled && event_kind==='service' && optional!==true"),
  'attendance follow-up should use a safe organization default while allowing explicit per-session and organization opt-outs');
assert.ok(createSession.includes("typeof absence_meaningful==='boolean'"),
  'an explicit true or false from an operator must override the organization default');
assert.ok(attendanceUi.includes('ARIA compares service patterns by date and service name'),
  'attendance UI should teach consistent naming for recurring services');

assert.ok(processor.includes("pc.direction='inbound' AND pc.status IN('received','completed','sent','delivered')") &&
  processor.includes("te.source IN('human','conversation_import')") &&
  processor.includes("followUpPolicy.routineCooldownDays") &&
  processor.includes("followUpPolicy.noResponseCooldownDays") &&
  !processor.slice(processor.indexOf('async function createAbsenceSignals'),processor.indexOf('async function createReturnSignals')).includes("context->>'source'='required_first_visit_follow_up'"),
  'routine and return-follow-up suggestions must pause after recent human/inbound contact, honour quiet periods, and avoid counting one recorded contact twice');

assert.ok(intelligence.includes("COALESCE(started_at,NOW()) AS session_at"),
  'attendance metrics must be evaluated against the actual processed session date');
assert.ok(intelligence.includes("pr.occurred_at<=(SELECT session_at FROM session_context)"),
  'future participation must not leak into historical calculations');

for (const [label, source] of [
  ['temporal history', temporal],
  ['operator activity', organizationContext],
  ['ARIA director', director]
]) {
  assert.ok(source.includes("ATTENDANCE_HISTORY_RESET") && source.includes('reset_event.occurred_at>e.occurred_at'),
    label + ' should ignore immutable attendance test events from before the reset boundary');
}
assert.ok(memory.includes("memory_key LIKE 'session:%'") && memory.includes('NOT EXISTS'),
  'current organization memory should ignore session-context records whose test session was removed');
assert.ok(director.includes("om.memory_key LIKE 'session:%'"),
  'director reasoning should not reuse orphaned session semantics');
for (const [label, source] of [
  ['temporal highlights', temporal],
  ['operator activity', organizationContext],
  ['director signals', director],
  ['director state', directorState]
]) {
  assert.ok(source.includes("e.type<>'ATTENDANCE_HISTORY_RESET'"),
    label + ' should hide the reset boundary itself from current activity');
}
assert.ok(directorState.includes("e.type<>'ATTENDANCE_HISTORY_RESET'") &&
  directorState.includes("reset_event.occurred_at>e.occurred_at"),
  'director state should not treat the reset marker or old attendance events as the latest meaningful event');
for (const [label, source] of [
  ['temporal activity', temporal],
  ['operator activity', organizationContext],
  ['ARIA director evidence', director],
  ['director state', directorState],
  ['ARIA workspace context', universalWorkspace],
  ['person journey', personJourney]
]) {
  assert.ok(source.includes("ATTENDANCE_SESSION_RESET") && source.includes("session_reset.metadata->>'session_id'"),
    label + ' must ignore immutable attendance evidence for the specifically reset session');
}
assert.ok(recommendations.includes("COALESCE(action_metadata->>'attendance_history_reset','false')<>'true'"),
  'person action history should hide attendance actions invalidated by the reset');
assert.ok(!/DELETE\s+FROM\s+aria_events/i.test(processor + temporal + organizationContext + director),
  'immutable ARIA event history must not be physically deleted to simulate a reset');

assert.ok(String(packageJson.scripts['test:attendance-service-pattern'] || '').includes('node scripts/attendance-service-pattern-regression.js'),
  'the dedicated attendance regression must run through npm scripts');
assert.ok(ci.includes('npm run test:attendance-service-pattern'),
  'the attendance regression must block deployment when it fails');

console.log('Attendance service/date regression passed.');

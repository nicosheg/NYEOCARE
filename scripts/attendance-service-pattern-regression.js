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

assert.ok(serviceIdentity.includes("THEN ${alias}.service_type") && serviceIdentity.includes("ELSE COALESCE(${alias}.name,'')") &&
  serviceIdentity.includes("!~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'"),
  'opaque UUID service IDs should fall back to the entered session name instead of merging distinct services');

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
assert.ok(recommendations.includes("COALESCE(action_metadata->>'attendance_history_reset','false')<>'true'"),
  'person action history should hide attendance actions invalidated by the reset');
assert.ok(!/DELETE\s+FROM\s+aria_events/i.test(processor + temporal + organizationContext + director),
  'immutable ARIA event history must not be physically deleted to simulate a reset');

assert.ok(String(packageJson.scripts['test:attendance-service-pattern'] || '').includes('node scripts/attendance-service-pattern-regression.js'),
  'the dedicated attendance regression must run through npm scripts');
assert.ok(ci.includes('npm run test:attendance-service-pattern'),
  'the attendance regression must block deployment when it fails');

console.log('Attendance service/date regression passed.');

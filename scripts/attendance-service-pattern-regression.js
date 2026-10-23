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
const memory = read('lib/aria/organizationMemory.js');
const recommendations = read('lib/aria/recommendationEngine.js');
const packageJson = JSON.parse(read('package.json'));
const ci = read('.github/workflows/ci.yml');
const attendanceUi = read('components/AttendanceModal.js');

assert.match(serviceIdentity, /COALESCE\(NULLIF\(\$\{alias\}\.service_type,''\), \$\{alias\}\.name, ''\)/,
  'service identity should prefer an explicit service type, then the entered session name');
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
assert.ok(processor.includes("h.prior_84>=2 AND h.prior_28>=1"),
  'absence signals must require repeated, recent evidence from that service');
assert.ok(processor.includes("o.evidence->>'service_key'=(SELECT ${serviceKeySql('cs')}"),
  'return signals must be scoped to the same service');
assert.ok(processor.includes("a.action_metadata->>'service_key'=(SELECT ${serviceKeySql('cs')}"),
  'attendance actions must preserve and use service identity');
assert.ok(processor.includes("AND ac.session_id IN (SELECT ps.id FROM sessions ps"),
  'attendance contexts should only resolve after a return to the matching service');

assert.ok(createSession.includes("configuredAttendanceFollowUp=orgSettings?.aria?.attendance_pattern_followup_enabled===true"),
  'absence follow-up should be enabled only by an explicit organization policy when the request omits the flag');
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
assert.ok(recommendations.includes("COALESCE(action_metadata->>'attendance_history_reset','false')<>'true'"),
  'person action history should hide attendance actions invalidated by the reset');
assert.ok(!/DELETE\s+FROM\s+aria_events/i.test(processor + temporal + organizationContext + director),
  'immutable ARIA event history must not be physically deleted to simulate a reset');

assert.ok(String(packageJson.scripts['test:attendance-service-pattern'] || '').includes('node scripts/attendance-service-pattern-regression.js'),
  'the dedicated attendance regression must run through npm scripts');
assert.ok(ci.includes('npm run test:attendance-service-pattern'),
  'the attendance regression must block deployment when it fails');

console.log('Attendance service/date regression passed.');

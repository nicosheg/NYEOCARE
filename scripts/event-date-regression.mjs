import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { eventAttendanceDate, normalizeOrganizationTimeZone } from '../lib/attendance/eventDate.js';

const lateUtc = '2026-10-26T23:30:00.000Z';
assert.equal(eventAttendanceDate(lateUtc, 'Africa/Lagos'), '2026-10-27',
  'A 23:30 UTC event timestamp is after midnight in Lagos and must use the local calendar day.');
assert.equal(eventAttendanceDate(lateUtc, 'UTC'), '2026-10-26',
  'The same event instant can legitimately have a different date in another organization time zone.');
assert.equal(eventAttendanceDate(lateUtc, 'Not/ARealTimeZone'), '2026-10-27',
  'An invalid timezone must safely fall back to Africa/Lagos rather than crashing attendance writes.');
assert.equal(normalizeOrganizationTimeZone('UTC'), 'UTC');
assert.equal(normalizeOrganizationTimeZone(''), 'Africa/Lagos');

for (const [path, expected] of [
  ['pages/api/attendance/mark.js', 'organization_timezone'],
  ['pages/api/attendance/sync.js', 'organization_timezone'],
  ['pages/api/attendance/section-checkin.js', 'organization_timezone'],
  ['pages/api/attendance/aria-correction.js', 'organization_timezone'],
  ['lib/aria/universalWorkspace.js', 'organization_timezone']
]) {
  const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  assert.ok(source.includes('eventAttendanceDate') && source.includes(expected),
    path + ' must use the shared organization-local attendance date helper.');
}

console.log('[EVENT DATE REGRESSION]');
console.log('PASS: organization-local event dates, invalid-timezone fallback, and all attendance write paths.');

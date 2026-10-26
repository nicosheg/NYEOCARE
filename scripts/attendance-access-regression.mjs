import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isOrganizationOperator, isOrganizationAdmin } from '../lib/attendance/access.js';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
for (const role of ['owner', 'admin', 'leader', 'worker', ' LEADER ']) assert.equal(isOrganizationOperator(role), true);
for (const role of ['member', 'visitor', '', null, undefined]) assert.equal(isOrganizationOperator(role), false);
assert.equal(isOrganizationAdmin('owner'), true);
assert.equal(isOrganizationAdmin('admin'), true);
assert.equal(isOrganizationAdmin('worker'), false);

const contracts = [
  ['pages/api/people.js', ["req.method==='GET'&&!personCreatorRoles.includes(role)", 'private contact details are limited to authorized organization operators']],
  ['pages/api/attendance/join-session.js', ['isOrganizationOperator', 'Only authorized organization operators can join attendance sessions.']],
  ['pages/api/attendance/field-roster.js', ['isOrganizationOperator', 'session_users su']],
  ['pages/api/attendance/field-changes.js', ['isOrganizationOperator', 'session_users su']],
  ['pages/api/attendance/people.js', ['isOrganizationOperator', 'session_users su']],
  ['pages/api/attendance/search.js', ['isOrganizationOperator', 'session_id', 'session_users su']],
  ['pages/api/attendance/mark.js', ['isOrganizationOperator', 'Only authorized organization operators can mark attendance.']],
  ['pages/api/attendance/sync.js', ['isOrganizationOperator', 'Only authorized organization operators can sync attendance.']],
  ['pages/api/attendance/section-checkin.js', ['isOrganizationOperator', 'Only authorized organization operators can submit attendance.']],
  ['pages/api/attendance/add-visitor.js', ['isOrganizationOperator', 'Only authorized organization operators can add people during attendance.']],
  ['pages/api/attendance/close-session.js', ['isOrganizationOperator', 'Only authorized organization operators can save attendance.']],
  ['pages/api/sessions/assign.js', ['isOrganizationOperator(userCheck.rows[0].role)', 'Only authorized organization operators can be assigned to attendance sessions.']],
  ['pages/section.js', ['session_id: String(sessionId)', "params.set('q', search.trim())"]]
];
for (const [path, required] of contracts) {
  const source = read(path);
  for (const value of required) assert.ok(source.includes(value), path + ' must enforce ' + value);
}
console.log('[ATTENDANCE ACCESS REGRESSION]');
console.log('PASS: only owner/admin/leader/worker roles can operate attendance, and roster/search endpoints are scoped to the session.');

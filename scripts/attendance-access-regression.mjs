import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isOrganizationOperator, isOrganizationAdmin, ensureActiveAttendanceSessionMember } from '../lib/attendance/access.js';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');
for (const role of ['owner', 'admin', 'leader', 'worker', 'user', ' USER ', ' LEADER ']) assert.equal(isOrganizationOperator(role), true);
for (const role of ['member', 'visitor', '', null, undefined]) assert.equal(isOrganizationOperator(role), false);
assert.equal(isOrganizationAdmin('owner'), true);
assert.equal(isOrganizationAdmin('admin'), true);
assert.equal(isOrganizationAdmin('worker'), false);

// Membership recovery must stay inside the authenticated operator's organization,
// and can create membership only while the target session is active.
const membershipQueries = [];
const membershipDb = {
  async query(sql, params) {
    membershipQueries.push({ sql, params });
    if (membershipQueries.length === 3) return { rows: [{ user_id: 'operator-1' }] };
    return { rows: [] };
  }
};
assert.equal(await ensureActiveAttendanceSessionMember(membershipDb, {
  organizationId: 'org-a', sessionId: 'session-a', userId: 'operator-1'
}), true);
assert.equal(membershipQueries.length, 3, 'A missing membership must be inserted then re-read for concurrent joins.');
assert.ok(membershipQueries[0].sql.includes('s.organization_id = $2'), 'Membership reads must be tenant-scoped.');
assert.ok(membershipQueries[0].sql.includes('u.organization_id = s.organization_id'), 'The user must belong to the session organization.');
assert.ok(membershipQueries[0].sql.includes('u.active = true'), 'Inactive accounts must not join.');
assert.ok(membershipQueries[0].sql.includes('ANY($4::text[])'), 'Only canonical organization operator roles may join.');
assert.ok(membershipQueries[1].sql.includes("s.status = 'active'"), 'A new membership must never be added to a closed session.');
assert.ok(membershipQueries[1].sql.includes('ON CONFLICT (session_id, user_id) DO NOTHING'), 'Concurrent join attempts must be idempotent.');
assert.equal(await ensureActiveAttendanceSessionMember(membershipDb, {
  organizationId: '', sessionId: 'session-a', userId: 'operator-1'
}), false, 'Missing tenant context must fail closed.');

const contracts = [
  ['pages/api/people.js', ["req.method==='GET'&&!personCreatorRoles.includes(role)", 'private contact details are limited to authorized organization operators']],
  ['pages/api/person/journey.js', ['isOrganizationOperator', 'Person history is limited to authorized organization operators.']],
  ['pages/api/person/context-actions.js', ['isOrganizationOperator', 'Person care context is limited to authorized organization operators.']],
  ['pages/api/timeline.js', ['isOrganizationOperator', 'Person timeline is limited to authorized organization operators.']],
  ['pages/api/care-feedback.js', ['isOrganizationOperator', 'Care feedback is limited to authorized organization operators.']],
  ['pages/api/attendance/join-session.js', ['isOrganizationOperator', 'Only authorized organization operators can join attendance sessions.']],
  ['pages/api/attendance/field-roster.js', ['isOrganizationOperator', 'session_users su']],
  ['pages/api/attendance/field-changes.js', ['isOrganizationOperator', 'session_users su']],
  ['pages/api/attendance/people.js', ['isOrganizationOperator', 'session_users su']],
  ['pages/api/attendance/search.js', ['isOrganizationOperator', 'session_id', 'session_users su']],
  ['pages/api/attendance/mark.js', ['isOrganizationOperator', 'Only authorized organization operators can mark attendance.']],
  ['pages/api/attendance/sync.js', ['isOrganizationOperator', 'Only authorized organization operators can sync attendance.']],
  ['pages/api/attendance/section-checkin.js', ['isOrganizationOperator', 'Only authorized organization operators can submit attendance.']],
  ['pages/api/attendance/add-visitor.js', ['isOrganizationOperator', 'Only authorized organization operators can add people during attendance.']],
  ['pages/api/attendance/close-session.js', ['isOrganizationOperator', 'Only authorized organization operators can save attendance.', 'ensureActiveAttendanceSessionMember']],
  ['pages/api/sessions/assign.js', ['isOrganizationOperator(userCheck.rows[0].role)', 'Only authorized organization operators can be assigned to attendance sessions.']],
  ['pages/section.js', ['session_id: String(sessionId)', "params.set('q', search.trim())"]]
];
for (const [path, required] of contracts) {
  const source = read(path);
  for (const value of required) assert.ok(source.includes(value), path + ' must enforce ' + value);
}

for (const path of [
  'pages/api/attendance/people.js',
  'pages/api/attendance/field-roster.js',
  'pages/api/attendance/field-changes.js',
  'pages/api/attendance/search.js',
  'pages/api/attendance/mark.js',
  'pages/api/attendance/sync.js',
  'pages/api/attendance/close-session.js',
  'pages/api/attendance/add-visitor.js',
  'pages/api/attendance/section-checkin.js'
]) {
  const source = read(path);
  assert.ok(source.includes('ensureActiveAttendanceSessionMember'), path + ' must use the shared tenant-scoped membership recovery.');
  assert.ok(source.includes('isOrganizationOperator'), path + ' must keep the operator-role gate.');
}
const markApi = read('pages/api/attendance/mark.js');
assert.ok(markApi.includes("res.status(409)") && markApi.includes("code:'ATTENDANCE_SESSION_CLOSED'"),
  'A closed session is a state conflict, not an authorization denial.');
const modal = read('components/AttendanceModal.js');
assert.ok(modal.includes("e?.code==='ATTENDANCE_SESSION_CLOSED'") && modal.includes("load({showLoading:false,forceSnapshot:true})"),
  'The marking device must refresh when another device has already closed the session.');
const diagnostics = read('components/ClientDiagnostics.js');
assert.ok(diagnostics.includes("kind:'client_api_forbidden'") && diagnostics.includes("pathname.startsWith('/api/attendance/')"),
  'Attendance 403 responses must be captured with a route and request ID for diagnosis.');

console.log('[ATTENDANCE ACCESS REGRESSION]');
console.log('PASS: operator roles, tenant-scoped session membership recovery, closed-session conflicts, and Attendance 403 diagnostics.');

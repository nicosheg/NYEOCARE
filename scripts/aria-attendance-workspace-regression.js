// scripts/aria-attendance-workspace-regression.js
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=path=>fs.readFileSync(path,'utf8');

const lifecycle=read('lib/attendance/sessionLifecycle.js');
const createApi=read('pages/api/attendance/create-session.js');
const closeApi=read('pages/api/attendance/close-session.js');
const workspace=read('lib/aria/universalWorkspace.js');

assert.ok(createApi.includes("import { createAttendanceSession } from '../../../lib/attendance/sessionLifecycle';"),
  'the normal Attendance API must import the canonical session creator');
assert.ok(createApi.includes('await createAttendanceSession({')&&!createApi.includes('INSERT INTO sessions('),
  'the normal Attendance API must not maintain a second session-creation implementation');

assert.ok(workspace.includes("import { createAttendanceSession, finalizeAttendanceSession } from '../attendance/sessionLifecycle';"),
  'ARIA workspace must import the exact same lifecycle module');
const ariaCreate=workspace.slice(workspace.indexOf("if(op==='create_session')"),workspace.indexOf("if(op==='join_session')"));
assert.ok(ariaCreate.includes('await createAttendanceSession({')&&!ariaCreate.includes('INSERT INTO sessions('),
  'ARIA session creation must delegate to the canonical creator and must not insert sessions directly');
assert.ok(ariaCreate.includes('await requireAdmin(organizationId,actorId)'),
  'ARIA session creation must retain the owner/admin permission boundary');

assert.ok(closeApi.includes("import { finalizeAttendanceSession } from '../../../lib/attendance/sessionLifecycle';"),
  'the normal Attendance API must import the canonical finalizer');
assert.ok(closeApi.includes('await finalizeAttendanceSession({')&&!closeApi.includes('UPDATE sessions SET status='),
  'the normal Attendance API must delegate finalization rather than duplicate the database finalizer');
assert.ok(closeApi.includes('isOrganizationOperator')&&closeApi.includes('session_users'),
  'the normal Attendance API must preserve operator and active-session membership authorization');

const ariaClose=workspace.slice(workspace.indexOf("if(op==='close_session')"),workspace.indexOf("if(op==='discard_session')"));
assert.ok(ariaClose.includes('await finalizeAttendanceSession({')&&!ariaClose.includes('UPDATE sessions SET status='),
  'ARIA session closure must delegate to the same finalizer with no alternate direct-close path');
assert.ok(ariaClose.includes('await requireAdmin(organizationId,actorId)'),
  'ARIA session closure must retain its existing owner/admin permission boundary');

assert.ok(lifecycle.includes('auto_close_at')&&lifecycle.includes('auto_close_reason')&&
  lifecycle.includes("TIME '23:59'")&&lifecycle.includes("INTERVAL '24 hours'"),
  'the canonical creator must calculate the server-owned organization-local auto-close deadline');
assert.ok(lifecycle.includes('attendance_session_roster')&&lifecycle.includes("'session_start'")&&
  lifecycle.includes("COALESCE(p.status,'active')='active'"),
  'the canonical creator must snapshot the active organization roster at session start');
assert.ok(lifecycle.includes('emitAriaEvent')&&lifecycle.includes("eventKey: 'service:' + session.id + ':created'"),
  'the canonical creator must persist the same organization event and memory evidence for both entry points');
assert.ok(lifecycle.includes('const absenceMeaningful = false'),
  'attendance creation must remain care-neutral until attendance-care policy is separately approved');

assert.ok(lifecycle.includes('nyeocare_finalize_attendance_session')&&
  lifecycle.includes('manual_confirmation')&&
  lifecycle.includes('enqueueAttendanceProcessing')&&
  lifecycle.includes("stage: 'persist'"),
  'the canonical finalizer must finalize the register and enqueue durable ARIA work in the same database transaction');
assert.ok(lifecycle.includes('await db.query(\'SELECT pg_advisory_xact_lock(hashtext($1::text))\''),
  'session creation and closure must serialize against each other at the organization boundary');

assert.ok(workspace.includes('parameters.historical')&&
  workspace.includes("else if(!['owner','admin'].includes(actor.role))throw Object.assign(new Error('Owner or admin permission required for historical attendance corrections.'),{status:403})"),
  'the existing explicitly admin-gated historical attendance correction route must remain intact');

console.log('[ARIA ATTENDANCE WORKSPACE REGRESSION] Both entry points share one server-owned create/finalize lifecycle; no duplicate ARIA session SQL remains.');

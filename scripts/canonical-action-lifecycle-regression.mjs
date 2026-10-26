import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalAriaActionKey } from '../lib/aria/actionIdentity.js';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const session = 'session-123';
const person = 'person-456';
const organizationId = 'org-789';

const keyA = canonicalAriaActionKey({organizationId, personId:person, actionKey:'legacy-a', actionMetadata:{kind:'care_first_check_in',session_id:session}});
const keyB = canonicalAriaActionKey({organizationId, personId:person, actionKey:'legacy-b', actionMetadata:{kind:'attendance_absence_check_in',session_id:session}});
const keyC = canonicalAriaActionKey({organizationId, personId:person, actionKey:'legacy-c', actionMetadata:{kind:'returned_after_absence',session_id:session}});
assert.equal(keyA, 'attendance:care:' + session + ':' + person);
assert.equal(keyB, keyA, 'legacy and current attendance producers must map to one work identity');
assert.equal(keyC, keyA, 'attendance-derived follow-up for a session/person must not compound');

const first = canonicalAriaActionKey({organizationId, personId:person, actionKey:'first', actionMetadata:{kind:'first_session_check_in',first_visit_required:true,session_id:session}});
assert.equal(first, 'attendance:first_visit:' + session + ':' + person, 'mandatory human disposition stays distinguishable');
const eventA = canonicalAriaActionKey({organizationId, personId:person, actionKey:'event-a', actionMetadata:{kind:'care',source_event_id:'event-a'}});
const eventB = canonicalAriaActionKey({organizationId, personId:person, actionKey:'event-b', actionMetadata:{kind:'care',source_event_id:'event-b'}});
assert.notEqual(eventA, eventB, 'separate source events must not be collapsed');

const identity = await read('../lib/aria/actionIdentity.js');
const queue = await read('../lib/dailyQueue.js');
const canonicalCare = await read('../lib/aria/canonicalCare.js');
const engine = await read('../lib/aria/recommendationEngine.js');
const careEngine = await read('../lib/aria/careEngine.js');
const attendance = await read('../lib/aria/attendanceProcessor.js');
const sqlAttendance = await read('../supabase/migrations/20260920154000_durable_attendance_processing.sql');
const eventProcessor = await read('../lib/aria/eventProcessor.js');
const completion = await read('../pages/api/daily-queue/complete-follow-up.js');
const migration = await read('../supabase/migrations/20261026085000_canonical_aria_action_lifecycle.sql');
const packageJson = JSON.parse(await read('../package.json'));

assert.ok(identity.includes('Canonical identity for one item of organizational care work'));
assert.ok(queue.includes('canonical_work_key:canonicalWorkKey'));
assert.ok(queue.includes('const groupKey=item.canonical_work_key||taskKey(item.task_kind,item.source_id)'));
assert.ok(!queue.includes('const personKey=item.person_id'), 'unrelated needs for the same person must not be collapsed');
assert.ok(!queue.includes('for(const o of observations.rows)'), 'raw observations without a canonical proposal must not masquerade as executable queue work');
assert.ok(queue.includes('source_no_longer_active_or_not_canonical'));
assert.ok(queue.includes('proposal expired before operator disposition'));
assert.ok(canonicalCare.includes('source_id=ANY($2::text[])'));
assert.ok(!canonicalCare.includes('OR person_id=$3'), 'resolving a proposal must not dismiss unrelated work');
assert.ok(engine.includes('ON CONFLICT DO NOTHING RETURNING *'));
assert.ok(engine.includes("action_metadata->>'canonical_work_key'"));
assert.ok(careEngine.includes('ON CONFLICT DO NOTHING'), 'batch care producer must tolerate canonical-key conflicts');
assert.ok(attendance.includes('first_visit_required') && attendance.includes('ON CONFLICT(organization_id,action_key) DO NOTHING'), 'attendance proposals must keep deterministic source keys and human disposition metadata');
assert.ok(sqlAttendance.includes('ON CONFLICT(organization_id,action_key) DO NOTHING'), 'database attendance worker remains protected by the same database trigger');
assert.ok(eventProcessor.includes("COALESCE(a.action_metadata->>'first_visit_required','false')<>'true'"));
assert.ok(completion.includes('already_completed: true'));
assert.ok(completion.includes('savedResult === outcome'));
assert.ok(completion.includes('feedback_id: feedback.id'));
assert.ok(migration.includes('aria_actions_open_canonical_work_uidx'));
assert.ok(migration.includes('pg_advisory_xact_lock'));
assert.ok(migration.includes('new_person_welcome'));
assert.ok(migration.includes('proposal_expired_without_operator_disposition'));
assert.ok(migration.includes('aria_daily_queue_open_action_source_uidx'));
assert.ok(migration.includes('open or terminal'), 'a repeated source may not reopen completed or dismissed work');
assert.equal(packageJson.scripts['test:canonical-action-lifecycle'], 'node --experimental-default-type=module scripts/canonical-action-lifecycle-regression.mjs');

console.log('Canonical ARIA action lifecycle regression passed.');

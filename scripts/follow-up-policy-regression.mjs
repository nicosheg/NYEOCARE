// scripts/follow-up-policy-regression.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DEFAULT_FOLLOW_UP_POLICY,
  normalizeFollowUpPolicy,
  isRoutineFollowUpEligible
} from '../lib/aria/followUpPolicy.js';

const read = path => fs.readFileSync(path, 'utf8');
const policy = read('lib/aria/followUpPolicy.js');
const serviceIdentity = read('lib/aria/serviceIdentity.js');
const attendance = read('lib/aria/attendanceProcessor.js');
const eventProcessor = read('lib/aria/eventProcessor.js');
const careEngine = read('lib/aria/careEngine.js');
const queue = read('lib/dailyQueue.js');
const briefing = read('pages/api/daily-briefing/latest.js');
const onboarding = read('pages/api/onboarding.js');
const profile = read('components/ChurchProfileTab.js');
const home = read('pages/index.js');
const completion = read('pages/api/daily-queue/complete-follow-up.js');
const personState = read('lib/aria/stateManager.js');
const directorState = read('lib/aria/director.js');
const directorEngine = read('lib/aria/directorEngine.js');
const temporal = read('lib/aria/temporalEngine.js');
const recommendationEngine = read('lib/aria/recommendationEngine.js');
const canonicalCare = read('lib/aria/canonicalCare.js');
const defer = read('pages/api/daily-queue/defer.js');

const now = new Date('2026-10-23T10:00:00.000Z');
const daysAgo = days => new Date(now.getTime() - days * 86400000);

assert.deepEqual(DEFAULT_FOLLOW_UP_POLICY, {
  firstVisitFollowUpRequired: true,
  attendancePatternFollowUpEnabled: true,
  firstVisitDueHours: 24,
  routineCooldownDays: 7,
  noResponseCooldownDays: 14,
  maxRoutineContactsPer30Days: 2,
  workerDailyCapacity: 5
}, 'default policy must make first-visit disposition compulsory while keeping contact frequency modest');

assert.deepEqual(normalizeFollowUpPolicy({
  firstVisitDueHours: 1000,
  routineCooldownDays: 0,
  noResponseCooldownDays: 2,
  maxRoutineContactsPer30Days: 100,
  workerDailyCapacity: -4
}), {
  firstVisitFollowUpRequired: true,
  attendancePatternFollowUpEnabled: true,
  firstVisitDueHours: 72,
  routineCooldownDays: 3,
  noResponseCooldownDays: 7,
  maxRoutineContactsPer30Days: 8,
  workerDailyCapacity: 1
}, 'policy values must be bounded before storage or scheduling');

assert.equal(normalizeFollowUpPolicy({ attendancePatternFollowUpEnabled: false }).attendancePatternFollowUpEnabled, false, 'an organization must be able to opt out of attendance-pattern follow-up');
assert.equal(isRoutineFollowUpEligible({ now }).allowed, true, 'no prior outreach should be eligible');
assert.equal(isRoutineFollowUpEligible({ now, lastOutboundAt: daysAgo(3) }).reason, 'routine_cooldown');
assert.equal(isRoutineFollowUpEligible({ now, lastFeedbackType: 'no_response', lastFeedbackAt: daysAgo(10) }).reason, 'no_response_cooldown');
assert.equal(isRoutineFollowUpEligible({ now, lastFeedbackType: 'no_response', lastFeedbackAt: daysAgo(15) }).allowed, true, 'a quiet period should expire instead of suppressing contact forever');
assert.equal(isRoutineFollowUpEligible({ now, contactCount30d: 2 }).reason, 'monthly_contact_limit');
assert.equal(isRoutineFollowUpEligible({ now, doNotContact: true }).reason, 'do_not_contact');

assert.ok(serviceIdentity.includes("!~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'") &&
  serviceIdentity.includes("ELSE COALESCE(\${alias}.name,'')"),
  'opaque service UUIDs must fall back to the session name so different services do not share attendance histories');

assert.ok(attendance.includes('createFirstVisitFollowUps(sessionId,orgId)') &&
  attendance.includes("'first_visit_required',true") &&
  attendance.includes("'first_visit_due_at',t.started_at+($3::int*INTERVAL '1 hour')"),
  'first-visit tasks must be generated from attendance, marked required and given a policy-based deadline');
assert.ok(attendance.includes("'first_visit_due_at',t.started_at+($3::int*INTERVAL '1 hour')") &&
  attendance.includes("'verify_first_visit_or_existing_connection'") &&
  attendance.includes("'do_not_contact'"),
  'first-visit work must have a deadline, acknowledge uncertainty, and honour do-not-contact');

const eventPolicy = eventProcessor.slice(eventProcessor.indexOf(' const policy={'), eventProcessor.indexOf('}[event.type];', eventProcessor.indexOf(' const policy={')));
assert.ok(!eventPolicy.includes('PERSON_CREATED:'), 'creating or importing a person must not itself count as a visit or trigger a welcome follow-up');

assert.ok(careEngine.includes('isRoutineFollowUpEligible') &&
  careEngine.includes("kind='other' AND metadata->>'do_not_contact'='true'") &&
  careEngine.includes('routineEligible.has'),
  'routine care opportunities must respect recent contact, response history and contact suppression');

assert.ok(onboarding.includes("action==='save_follow_up_policy'") &&
  onboarding.includes("['owner','admin'].includes(req.user.role)") &&
  onboarding.includes("follow_up_policy"),
  'organization follow-up policy must be persisted under owner/admin control');
assert.ok(profile.includes('Follow-up policy') &&
  profile.includes('firstVisitDueHours') &&
  profile.includes('attendancePatternFollowUpEnabled') && profile.includes('routineCooldownDays') &&
  profile.includes('workerDailyCapacity'),
  'organization admins need accessible policy controls');

assert.ok(queue.includes("m?.kind==='care_first_check_in'") && queue.includes("REQUIRED_FOLLOW_UP_CANNOT_DEFER"),
  'attendance absence actions must enter the follow-up lane and only required first-visit tasks must resist deferral');
assert.ok(queue.includes("isRequiredFirstVisit(item)") &&
  queue.includes("mustBeVisibleToday") &&
  queue.includes("pickTodayOperator") &&
  queue.includes("role IN('owner','admin','leader','worker','user')"),
  'required first-visit outcomes must be scheduled for today, capacity overflow must remain visible, and all valid active operator roles must be assignable');
assert.ok(queue.includes("requiredFollowUpCount") && queue.includes("capacityExceeded"),
  'the queue must expose mandatory follow-up count and capacity overflow to the operator UI');
assert.ok(queue.includes('meta.followUpPolicy.workerDailyCapacity') &&
  queue.includes("role IN('owner','admin','leader','worker')") &&
  queue.includes("m?.first_visit_required===true?100"),
  'the queue must distribute work across operators, honour capacity, and prioritize required first-visit outcomes');
assert.ok(briefing.includes('capacityPerOperator:queue.capacityPerOperator||5'),
  'ARIA Today must show the configured worker capacity');

assert.ok(recommendationEngine.includes("COALESCE(action_metadata->>'first_visit_required','false')<>'true'") &&
  canonicalCare.includes("current.rows[0]?.action_metadata?.first_visit_required===true") &&
  attendance.includes("COALESCE(a.action_metadata->>'first_visit_required','false')<>'true'"),
  'required first-visit work must not be cancelled by generic reject/context-resolution routes or silently superseded when the person returns');

assert.ok(queue.includes("REQUIRED_FOLLOW_UP_CANNOT_DEFER") &&
  queue.includes("q.rows[0].action_metadata?.first_visit_required===true") &&
  defer.includes("REQUIRED_FOLLOW_UP_CANNOT_DEFER") && defer.includes("409"),
  'required first-visit work must be non-deferrable on the server, not merely hidden behind the UI');
assert.ok(completion.includes("do_not_contact: { label: 'Person asked not to be contacted', feedbackType: 'new_information', sentiment: 'neutral' }"),
  'a no-contact preference must be learned as neutral preference context, not mislabelled as a negative relationship');
assert.ok(completion.includes("VALUES($1,$2,$3,'outbound','sent','Follow-up message',$4,$5::jsonb,$6,NOW(),NOW(),NOW())"),
  'follow-up communication history must preserve the actual contact channel rather than forcing every send into WhatsApp');

assert.ok(personState.includes("COALESCE(action_metadata->>'kind','')<>'new_person_welcome'") &&
  directorState.includes("COALESCE(action_metadata->>'kind','')<>'new_person_welcome'") &&
  directorEngine.includes("COALESCE(action_metadata->>'kind','')<>'new_person_welcome'") &&
  temporal.includes("COALESCE(a.action_metadata->>'kind','')<>'new_person_welcome'") &&
  recommendationEngine.includes("COALESCE(a.action_metadata->>'kind','')<>'new_person_welcome'"),
  'legacy welcome-on-record-entry proposals must not inflate live action counts, person state or pending work');

assert.ok(completion.includes("firstVisitRequired && row.action_metadata?.kind !== 'first_session_check_in'") &&
  completion.includes("routineKinds.has") &&
  completion.includes("status='completed'") &&
  completion.includes("'do_not_contact'") &&
  completion.includes("SET status='sent',occurred_at=NOW()") &&
  completion.includes("status='cancelled'") && completion.includes("cancellation_reason: outcome") &&
  completion.includes('learnFromFeedback'),
  'follow-up completion must validate first-visit or routine task, record contact attempts/outcomes, suppress opt-outs and feed ARIA learning');
assert.ok(home.includes('/api/daily-queue/complete-follow-up') &&
  home.includes('REQUIRED FIRST-VISIT OUTCOME') &&
  home.includes('!firstVisitRequired&&<>') && home.includes('OUTCOME DUE') &&
  home.includes('routineFollowUps.map') && home.includes('First-visit care comes first') &&
  home.includes('FOLLOW-UP OUTCOME') && home.includes("completeFirstVisit('message_sent')"),
  'the worker UI must require a true disposition and remove the easy Later escape for required first-visit work');
assert.ok(home.includes('requiredFollowUpItems') &&
  home.includes('capacityExceeded') &&
  home.includes('required first-visit outcomes must be reviewed individually'),
  'ARiA Today must surface required first-visit outcomes ahead of the ordinary item cap and explain unusual workload');

console.log('[FOLLOW-UP POLICY] policy, psychology guardrails, first-visit workflow and learning contracts passed.');

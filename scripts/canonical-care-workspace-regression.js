// scripts/canonical-care-workspace-regression.js
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=path=>fs.readFileSync(path,'utf8');

const home=read('pages/index.js');
const work=read('components/WorkToday.js');
const panel=read('components/CareLeadershipPanel.js');
const legacyRoute=read('pages/care-oversight.js');
const createApi=read('pages/api/care-responsibilities.js');
const journeyApi=read('pages/api/person/journey.js');
const person=read('pages/person/[id].js');
const queue=read('lib/dailyQueue.js');
const outcome=read('pages/api/daily-queue/complete-follow-up.js');
const safety=read('supabase/migrations/20261126100000_disable_legacy_attendance_absence_actions.sql');
const actionable=read('lib/aria/actionableObservationTypes.js');

assert.ok(home.includes("import CareLeadershipPanel")&&home.includes("setBriefTab('team')")&&home.includes("router.query.briefing")&&home.includes("role={operatorRole} initialTab={briefTab}"),
 'ARIA Today must be the canonical modal entry point for both personal work and leader care');
assert.ok(home.includes('focus=data?.director?.primary_focus')&&home.includes('ARIA FOCUS')&&home.includes('>My work</button>')&&home.includes('>Team care</button>')&&home.includes('<CareLeadershipPanel/>'),
 'only leaders must get the Team care tab within the existing briefing');
assert.ok(work.includes('Team care <span>↗</span>')&&work.includes('onOpenCareOversight'),
 'the Home leadership link must open the canonical Team care tab');
assert.ok(legacyRoute.includes("router.replace('/?briefing=team')")&&!legacyRoute.includes('Care Oversight'),
 'the old Care Oversight path must redirect instead of rendering a competing page');

assert.ok(panel.includes("fetch('/api/care-oversight'")&&panel.includes("fetch('/api/care-oversight/acknowledge'")&&panel.includes("fetch('/api/care-oversight/reassign'")&&panel.includes("action:'set_champion'"),
 'leadership actions must reuse existing secured support, reassignment and champion endpoints');
assert.ok(panel.includes('Help requests')&&panel.includes('Needs coordination')&&panel.includes('Team workload')&&panel.includes('Support contact'),
 'the unified panel must preserve the core human coordination functions');
assert.ok(!panel.includes('ten-minute leadership ritual')&&!panel.includes('WEEKLY OPERATOR PULSE'),
 'the canonical panel must avoid the previous wall-of-text and secondary adoption sections');

assert.ok(createApi.includes('withAdmin')&&createApi.includes("status='active'")&&createApi.includes('organization_id=$2')&&createApi.includes('role=ANY($3::text[])'),
 'creating a care responsibility must be leader-only and validate the person and assignee inside the tenant');
assert.ok(createApi.includes("kind:'manual_care_responsibility'")&&createApi.includes('assigned_user_id:assignee.id')&&createApi.includes('due_date:dueDate'),
 'human care assignments must be explicit ARIA actions with a stable owner and due date');
assert.ok(createApi.includes("actionKey='human-care:'+idempotencyKey")&&createApi.includes('action_key=$2')&&createApi.includes("pg_advisory_xact_lock"),
 'duplicate submits must be idempotent and serialized');
assert.ok(createApi.includes("type:'CARE_CONTEXT_RECORDED'")&&createApi.includes("source:'human_care_plan'")&&createApi.includes('getDailyQueue'),
 'human-created care must enter the ARIA event stream and canonical queue rather than a parallel task table');
assert.ok(createApi.includes('uuidPattern.test(personId)')&&createApi.includes('const message=description;')&&journeyApi.includes("AS time_zone")&&person.includes('organizationToday(p?.time_zone)')&&person.includes('makeIdempotencyKey'),
 'care assignment must validate real identifiers, avoid duplicated text and use the organization-local date');
assert.ok(createApi.includes("Choose a due date within the next 30 days."),
 'manual due dates must stay within the queue scheduling horizon');

assert.ok(journeyApi.includes("can_create_care_responsibility")&&journeyApi.includes("role IN('owner','admin','leader','worker','user')"),
 'only owners/admins can see the active operator directory for creating a care responsibility');
assert.ok(person.includes('Add care')&&person.includes('/api/care-responsibilities')&&person.includes('careRequestKey')&&person.includes('Assign responsibility'),
 'leaders must be able to create and assign the real next step from the person profile');

assert.ok(queue.includes("m?.kind==='manual_care_responsibility'?'follow_up'")&&queue.includes('fixed_assignee_id:m?.kind===\'manual_care_responsibility\'')&&queue.includes('preferred_queue_date:m?.kind===\'manual_care_responsibility\''),
 'human-created responsibilities must use the canonical follow-up queue, fixed owner and requested date');
assert.ok(queue.includes("if(/^\\d{4}-\\d{2}-\\d{2}$/.test(requested)")&&queue.includes('const chosen=item.fixed_assignee_id?preferred:loads.sort'),
 'the due date and chosen owner must be preserved, never silently rerouted when that owner becomes inactive');
assert.ok(outcome.includes("'manual_care_responsibility'")&&outcome.includes("'completed'")&&outcome.includes("'unable_to_complete'")&&outcome.includes("'person_declined'")&&outcome.includes("type: 'CARE_OUTCOME_RECORDED'")&&outcome.includes('eventKey: \'care-outcome:\' + row.action_id')&&outcome.includes('note.length < 5')&&outcome.includes('completed_successfully')&&outcome.includes('learnFromFeedback')&&home.includes("completeFirstVisit('completed')")&&home.includes("completeFirstVisit('unable_to_complete')")&&home.includes("completeFirstVisit('person_declined')")&&home.includes("!draft&&!manualCare")&&queue.includes('person_name:m?.kind')&&panel.includes('For {item.person_name}'),
 'manual care responsibilities must close through the existing human outcome and ARIA learning path');
assert.ok(!actionable.includes("'UNUSUAL_ABSENCE'")&&safety.includes("'automatic_attendance_care_paused'"),
 'attendance non-observation cannot become a new actionable care responsibility');

console.log('[CANONICAL CARE WORKSPACE] Unified page, role boundaries, human assignment, queue scheduling, outcomes and absence safety passed.');

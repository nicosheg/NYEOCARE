import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { explainAriaAction, attachDirectorContext } from '../lib/aria/actionExplainability.js';
import { projectCanonicalBriefingItems } from '../lib/aria/briefingProjection.js';

const read = path => readFileSync(path, 'utf8');
const queueSource = read('lib/dailyQueue.js');
const homeSource = read('pages/api/home/bootstrap.js');
const briefingSource = read('pages/api/daily-briefing/latest.js');
const uiSource = read('pages/index.js');
const reviewCenterSource = read('components/ReviewCenterTab.js');
const brainSource = read('lib/aria/corePersonality.js');
const specSource = read('NYEO_SPEC.md');
assert.match(queueSource, /explainAriaAction/);
assert.match(homeSource, /projectCanonicalBriefingItems\(dailyQueue,directorData\)/);
assert.match(briefingSource, /projectCanonicalBriefingItems\(queue,directorBriefing\)/);
assert.match(homeSource, /projectCanonicalBriefingItems/);
assert.match(briefingSource, /getDirectorBriefing\(orgId,\{limit:8\}\)/);
assert.match(homeSource, /from '\.\.\/\.\.\/\.\.\/lib\/aria\/briefingProjection'/);
assert.match(briefingSource, /from '\.\.\/\.\.\/\.\.\/lib\/aria\/briefingProjection'/);
assert.match(uiSource, /item\.why_attention/);
assert.match(uiSource, /item\.what_is_unknown/);
assert.match(uiSource, /item\.person_id\?'Unidentified person record':'Organization item'/);
assert.doesNotMatch(uiSource, /const name=item\.title\|\|item\.first_name\|\|'this person'/);
assert.match(uiSource, /const identityReview=item\?\.task_kind==='identity_review'\|\|item\?\.metadata\?\.kind==='possible_duplicate_identity'/);
assert.match(uiSource, /if\(identityReview\)\{setSelected\(item\);return\}/, 'Identity warnings must open an explanatory detail instead of bypassing it.');
assert.match(uiSource, /identityReview\?<button style=\{primary\} disabled=\{busy\} onClick=\{onReview\}>Compare records in Review Center/);
assert.match(uiSource, /setReviewGroup\('duplicates'\);setReview\(true\)/, 'The Compare records action must open the canonical Duplicates review group.');
assert.match(uiSource, /<ReviewCenterTab modal initialGroup=\{reviewGroup\}/);
assert.match(reviewCenterSource, /initialGroup=null/);
assert.match(reviewCenterSource, /\['follow_up','scan','duplicates'\]\.includes\(initialGroup\)/);
assert.match(uiSource, /\{identityReview\?<button style=\{primary\} disabled=\{busy\} onClick=\{onReview\}/, 'Synthetic identity warnings must have a review action.');

assert.match(uiSource, /item\.director_context\?\.reason/);
assert.match(brainSource, /recorded event, the evidence behind it/);
assert.match(specSource, /ARIA Today action-explanation contract/);

const newcomer = explainAriaAction({
  personName: 'Mrs Adaeze',
  taskKind: 'action',
  actionType: 'SEND_MESSAGE',
  observationType: 'NEW_PERSON',
  evidence: {
    fact: 'A new person record was added to the People directory.',
    facts: ['The record was created on 25 October 2026.'],
    inference: 'A no-pressure welcome may be useful.'
  },
  actionMetadata: {
    summary: 'Mrs Adaeze has a signal worth your attention.',
    reason: 'ARIA identified a meaningful care opportunity.',
    suggestion: 'Review the signal and decide what to do.'
  },
  confidence: 0.82,
  detectedAt: '2026-10-25T10:00:00.000Z'
});
assert.equal(newcomer.what_happened, 'A new person record was added to the People directory.');
assert.match(newcomer.what_aria_knows, /record was created on 25 October 2026/i);
assert.match(newcomer.why_attention, /interpretation/i);
assert.match(newcomer.what_is_unknown, /does not prove this was a first visit/i);
assert.match(newcomer.next_step, /Check the person’s existing history/i);
assert.doesNotMatch(newcomer.what_happened, /signal worth your attention/i);
assert.equal(newcomer.action_label, 'Verify context');
assert.equal(newcomer.confidence, 0.82);

const absence = explainAriaAction({
  personName: 'Bro Onjekachi',
  taskKind: 'follow_up',
  observationType: 'UNUSUAL_ABSENCE',
  evidence: {
    fact: 'No attendance record was attached to the 25 October gathering.',
    facts: ['The linked session date is 25 October 2026.']
  },
  detectedAt: '2026-10-25T12:00:00.000Z'
});
assert.match(absence.what_happened, /No attendance record/i);
assert.match(absence.what_is_unknown, /does not explain the person’s circumstances/i);
assert.match(absence.next_step, /Do not assume why they were absent/i);
assert.equal(absence.action_label, 'Review check-in');

const missingEvidence = explainAriaAction({
  personName: 'Unidentified person record',
  observationType: 'ATTENDANCE_CHANGE',
  evidence: {},
  confidence: null
});
assert.match(missingEvidence.what_happened, /attendance records/i);
assert.match(missingEvidence.what_aria_knows, /available record confirms only/i);
assert.match(missingEvidence.next_step, /Check the linked attendance events/i);
assert.equal(missingEvidence.confidence, null);

const pendingAction = explainAriaAction({
  personName: 'Mrs Adaeze',
  taskKind: 'action',
  actionType: 'SEND_MESSAGE',
  evidence: {},
  actionMetadata: {},
  confidence: null
});
assert.equal(pendingAction.what_happened, 'A pending action is open for Mrs Adaeze.');
assert.doesNotMatch(pendingAction.what_happened, /recorded a send message/i);

const manualNewPersonRecord = explainAriaAction({
  personName: 'Mrs Adaeze',
  taskKind: 'action',
  observationType: 'NEW_PERSON',
  evidence: {
    kind: 'observation',
    facts: ['Person became known to the organization.'],
    source: 'manual',
    status: 'observed',
    authority: 'manual',
    inference: 'New person discovered.',
    statement: 'PERSON_CREATED',
    occurred_at: '2026-10-25T10:38:26.605Z'
  },
  observationMetadata: { source_event_id: 'example-event-id' },
  actionMetadata: {},
  confidence: 1,
  detectedAt: '2026-10-25T10:38:26.622Z'
});
assert.equal(manualNewPersonRecord.what_happened, 'Person became known to the organization.');
assert.equal(manualNewPersonRecord.source_label, 'Manual entry');
assert.match(manualNewPersonRecord.what_aria_knows, /no further context is recorded/i);
assert.match(manualNewPersonRecord.why_attention, /new to NYEOCARE/i);
assert.match(manualNewPersonRecord.what_is_unknown, /does not prove this was a first visit/i);
assert.match(manualNewPersonRecord.next_step, /Check the person’s existing history/i);
assert.equal(manualNewPersonRecord.action_label, 'Verify context');

const explicitlyApprovedWelcome = explainAriaAction({
  personName: 'Mrs Adaeze',
  taskKind: 'action',
  observationType: 'NEW_PERSON',
  evidence: { facts: ['Person became known to the organization.'], source: 'manual' },
  actionMetadata: { kind: 'new_person_welcome' },
  confidence: 1
});
assert.equal(explicitlyApprovedWelcome.action_label, 'Review welcome');
assert.match(explicitlyApprovedWelcome.next_step, /only if contact is welcome/i);

const requiredFirstVisit = explainAriaAction({
  personName: 'Mrs Adaeze',
  taskKind: 'follow_up',
  actionType: 'SEND_MESSAGE',
  actionMetadata: {
    kind: 'first_session_check_in',
    first_visit_required: true,
    session_name: 'Sunday Gathering',
    session_started_at: '2026-10-25T10:00:00.000Z',
    reason: 'The first recorded visitor attendance requires one human care disposition.',
    summary: 'Mrs Adaeze needs a first-visit care check within 24 hours.',
    knowledge: 'This is the first attendance currently recorded for this visitor in NYEOCARE. That does not prove it was their first-ever visit or that nobody has already welcomed them.',
    suggestion: 'Confirm whether they are visiting for the first time or returning, and whether someone already connected with them. Record what happened; no message is sent automatically.'
  },
  detectedAt: '2026-10-25T10:02:00.000Z'
});
assert.match(requiredFirstVisit.what_happened, /Attendance was recorded for Mrs Adaeze at Sunday Gathering/i);
assert.match(requiredFirstVisit.what_aria_knows, /first attendance currently recorded/i);
assert.match(requiredFirstVisit.why_attention, /one human care disposition/i);
assert.match(requiredFirstVisit.what_is_unknown, /first-ever visit/i);
assert.match(requiredFirstVisit.next_step, /record what actually happened/i);
assert.equal(requiredFirstVisit.source_label, 'Attendance record');
assert.equal(requiredFirstVisit.recorded_at, '2026-10-25T10:00:00.000Z', 'Use the source session timestamp, not the later action creation time.');
assert.equal(requiredFirstVisit.action_label, 'Record outcome');

assert.match(queueSource, /COALESCE\(o\.attention_score,0\)>60/);
assert.match(queueSource, /UPPER\(o\.type\)='UNUSUAL_ABSENCE'/);
assert.match(queueSource, /UPPER\(o\.type\)<>'NEW_PERSON'/);
assert.doesNotMatch(queueSource, /const needsContextReview|requires_context_review:needsContextReview/);
assert.match(queueSource, /COALESCE\(a\.action_metadata->>'kind',''\)\s*<>\s*'scan_review_required'/);
assert.match(queueSource, /COALESCE\(a\.action_metadata->>'kind',''\)='new_person_welcome'[\s\S]{0,120}COALESCE\(a\.action_metadata->>'source_event_type',''\)='PERSON_CREATED'/,
  'Historical welcome actions caused by person creation must be excluded from today and future queue projections.');
assert.doesNotMatch(queueSource, /NOT IN\('scan_review_required','new_person_welcome'\)/);

const director = {
  intelligence: {
    attendance_lens: [{
      person_id: 'person-1',
      classification: 'new_relationship_watch',
      reason: 'Participation is below the previous reference pattern, but this relationship is still new.'
    }]
  }
};
const connected = attachDirectorContext({
  person_id: 'person-1',
  observation_type: 'UNUSUAL_ABSENCE',
  message: absence.what_happened
}, director);
assert.match(connected.director_context.reason, /relationship is still new/i);
assert.equal(connected.director_context.label, 'Across their recorded history');

const unrelated = attachDirectorContext({
  person_id: 'person-2',
  observation_type: 'UNUSUAL_ABSENCE'
}, director);
assert.equal(unrelated.director_context, undefined);

const nonAttendance = attachDirectorContext({
  person_id: 'person-1',
  observation_type: 'NEW_PERSON'
}, director);
assert.equal(nonAttendance.director_context, undefined);

for (const item of [newcomer, absence, missingEvidence]) {
  assert.ok(item.what_happened, 'Every item needs an event explanation.');
  assert.ok(item.what_aria_knows, 'Every item needs a bounded knowledge statement.');
  assert.ok(item.what_is_unknown, 'Every item must make uncertainty explicit.');
  assert.ok(item.next_step, 'Every item needs a concrete next step.');
}

const sharedQueue = {
  items: [
    { id: 'queue-1', source_id: 'source-1', task_kind: 'action', queue_date: '2026-10-25', payload: {
      task_kind: 'action', person_id: 'person-1', title: 'Sis Grace', metadata: { kind: 'new_person_welcome' },
      message: 'A welcome outcome is still open.', has_contact_number: true,
      created_at: '2026-10-25T10:00:00.000Z'
    } }
  ],
  candidateItems: [
    { task_kind: 'action', person_id: 'person-1', title: 'Sis Grace', metadata: { kind: 'new_person_welcome' }, has_contact_number: true, created_at: '2026-10-25T10:00:00.000Z' },
    { task_kind: 'action', person_id: 'person-2', title: 'Grace', metadata: { kind: 'new_person_welcome' }, has_contact_number: false, created_at: '2026-10-25T11:00:00.000Z' }
  ]
};
const currentProjection = projectCanonicalBriefingItems(sharedQueue, director);
assert.equal(currentProjection.length, 1, 'Two identity follow-up candidates with the same normalized name become one shared review item.');
assert.equal(currentProjection[0].task_kind, 'identity_review');
assert.equal(currentProjection[0].metadata.record_count, 2);
assert.deepEqual(currentProjection[0].metadata.person_ids, ['person-1', 'person-2']);
assert.match(currentProjection[0].message, /has not merged them/i);
assert.match(currentProjection[0].suggestion, /compare the available name and phone evidence/i);

const futureOnlyProjection = projectCanonicalBriefingItems({ items: [], candidateItems: sharedQueue.candidateItems }, director);
assert.equal(futureOnlyProjection.length, 1, 'Future candidates use the same identity rule; this is not tied to one named person or only today’s assigned rows.');
assert.equal(futureOnlyProjection[0].id, currentProjection[0].id, 'The cross-surface identity warning has a stable id across current/future projections.');

const explicitlyKeptSeparate = projectCanonicalBriefingItems({
  items: [
    { id: 'queue-a', source_id: 'source-a', task_kind: 'action', payload: sharedQueue.candidateItems[0] },
    { id: 'queue-b', source_id: 'source-b', task_kind: 'action', payload: sharedQueue.candidateItems[1] }
  ],
  candidateItems: sharedQueue.candidateItems,
  notDuplicateIdentityPairs: [{ person_a_id: 'person-1', person_b_id: 'person-2' }]
}, director);
assert.equal(explicitlyKeptSeparate.filter(item => item.task_kind === 'identity_review').length, 0,
  'A durable keep-separate decision must stop the same pair from being warned on every future briefing.');
assert.equal(explicitlyKeptSeparate.length, 2,
  'After an explicit keep-separate decision, the legitimate separate welcome work remains visible.');

const unrelatedNames = projectCanonicalBriefingItems({
  items: [],
  candidateItems: [
    { person_id: 'person-3', title: 'Grace', task_kind: 'action', metadata: { kind: 'new_person_welcome' } },
    { person_id: 'person-4', title: 'Grace Chukwu', task_kind: 'action', metadata: { kind: 'new_person_welcome' } }
  ]
}, director);
assert.equal(unrelatedNames.length, 0, 'A shared first name alone is not sufficient to raise a duplicate-identity warning.');

const samePersonDuplicates = projectCanonicalBriefingItems({
  items: [],
  candidateItems: [
    { person_id: 'person-5', title: 'Grace', task_kind: 'action', metadata: { kind: 'new_person_welcome' }, source_id: 'action-a' },
    { person_id: 'person-5', title: 'Grace', task_kind: 'action', metadata: { kind: 'new_person_welcome' }, source_id: 'action-b' }
  ]
}, director);
assert.equal(samePersonDuplicates.length, 0, 'Duplicate source rows for the same person never create a false multi-person identity warning.');

const requiredVisitProjection = projectCanonicalBriefingItems({
  items: [{
    id: 'queue-required',
    source_id: 'required-action',
    task_kind: 'follow_up',
    queue_date: '2026-10-25',
    priority: 100,
    payload: {
      id: 'required-action',
      source_id: 'required-action',
      task_kind: 'follow_up',
      priority: 100,
      person_id: 'person-6',
      title: 'Mrs Grace',
      metadata: { first_visit_required: true },
      message: 'A first-visit care outcome is due.',
      created_at: '2026-10-25T12:00:00.000Z'
    }
  }],
  candidateItems: [
    { person_id: 'person-6', title: 'Mrs Grace', task_kind: 'follow_up', priority: 100, metadata: { first_visit_required: true }, created_at: '2026-10-25T12:00:00.000Z' },
    { person_id: 'person-7', title: 'Grace', task_kind: 'action', metadata: { kind: 'new_person_welcome' }, created_at: '2026-10-25T13:00:00.000Z' }
  ]
}, director);
assert.equal(requiredVisitProjection.filter(item => item.task_kind === 'identity_review').length, 1);
assert.ok(requiredVisitProjection.some(item => item.person_id === 'person-6' && item.metadata?.first_visit_required === true),
  'An identity warning must never hide a required first-visit outcome.');

console.log('[ARIA ACTION EXPLAINABILITY] evidence, uncertainty, next-step, canonical current/future projection, deduplication, required-task preservation and Director integration checks passed.');

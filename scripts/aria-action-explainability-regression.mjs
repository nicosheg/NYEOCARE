import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { explainAriaAction, attachDirectorContext } from '../lib/aria/actionExplainability.js';

const read = path => readFileSync(path, 'utf8');
const queueSource = read('lib/dailyQueue.js');
const homeSource = read('pages/api/home/bootstrap.js');
const briefingSource = read('pages/api/daily-briefing/latest.js');
const uiSource = read('pages/index.js');
const brainSource = read('lib/aria/corePersonality.js');
const specSource = read('NYEO_SPEC.md');
assert.match(queueSource, /explainAriaAction/);
assert.match(homeSource, /attachDirectorContext/);
assert.match(briefingSource, /attachDirectorContext/);
assert.match(uiSource, /item\.why_attention/);
assert.match(uiSource, /item\.what_is_unknown/);
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
    suggestion: 'Review the signal and decide what to do.'
  },
  confidence: 0.82,
  detectedAt: '2026-10-25T10:00:00.000Z'
});
assert.equal(newcomer.what_happened, 'A new person record was added to the People directory.');
assert.match(newcomer.what_aria_knows, /record was created on 25 October 2026/i);
assert.match(newcomer.why_attention, /interpretation/i);
assert.match(newcomer.what_is_unknown, /whether someone has already welcomed/i);
assert.match(newcomer.next_step, /Check whether a welcome has already happened/i);
assert.notMatch(newcomer.what_happened, /signal worth your attention/i);
assert.equal(newcomer.action_label, 'Check welcome');
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
assert.match(missingEvidence.next_step, /verify the evidence/i);
assert.equal(missingEvidence.confidence, null);

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

console.log('[ARIA ACTION EXPLAINABILITY] evidence, uncertainty, next-step, Director integration and UI-contract checks passed.');

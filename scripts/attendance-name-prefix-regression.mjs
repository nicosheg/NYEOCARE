// scripts/attendance-name-prefix-regression.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { personDisplayName } from '../lib/personDisplayName.mjs';

const read = path => readFileSync(path, 'utf8');

assert.equal(
  personDisplayName({ display_name: 'Bro David Okoro', first_name: 'David', last_name: 'Okoro' }),
  'Bro David Okoro',
  'Attendance must use the canonical display name, including Bro.'
);
assert.equal(
  personDisplayName({ display_name: 'Sis Grace Adeyemi', first_name: 'Grace', last_name: 'Adeyemi' }),
  'Sis Grace Adeyemi',
  'Attendance must preserve Sis.'
);
assert.equal(
  personDisplayName({ display_name: 'Pastor Emma', first_name: 'Emma', last_name: '' }),
  'Pastor Emma',
  'Attendance must preserve professional and organizational titles.'
);
assert.equal(
  personDisplayName({ first_name: 'Nicholas', last_name: 'Egwame', metadata: { honorific: 'Bro' } }),
  'Bro Nicholas Egwame',
  'Legacy records may fall back to the same honorific metadata used by People.'
);
assert.equal(
  personDisplayName({ first_name: 'Nicholas', last_name: 'Egwame', prefix: 'Bro' }),
  'Bro Nicholas Egwame',
  'Legacy top-level prefixes must remain available as a fallback.'
);
assert.equal(
  personDisplayName({ first_name: 'Nicholas', last_name: 'Egwame' }),
  'Nicholas Egwame',
  'Names without a prefix must remain unchanged.'
);
assert.equal(
  personDisplayName({}),
  'Unnamed person',
  'A missing name must render a safe fallback instead of throwing.'
);

const attendance = read('components/AttendanceModal.js');
const peoplePage = read('pages/people.js');
const peopleApi = read('pages/api/attendance/people.js');
const fieldRosterApi = read('pages/api/attendance/field-roster.js');
const fieldChangesApi = read('pages/api/attendance/field-changes.js');
const fieldMode = read('lib/attendanceFieldMode.js');

assert.match(
  attendance,
  /<strong style=\{compactViewport\?mobilePersonName:undefined\}>\{personDisplayName\(p\)\}<\/strong>/,
  'The visible Attendance row must render the shared canonical display-name helper.'
);
assert.match(
  attendance,
  /aria-label=\{\`Record in-person welcome for \$\{personDisplayName\(p\)\}\`\}/,
  'Attendance accessibility labels must identify the same displayed person.'
);
assert.doesNotMatch(
  attendance,
  /<strong style=\{compactViewport\?mobilePersonName:undefined\}>\{p\.first_name\}\s*\{p\.last_name\|\|''\}/,
  'The old prefix-dropping first/last-only renderer must not return.'
);
assert.ok(
  peoplePage.includes("import{personDisplayName}from'../lib/personDisplayName.mjs'") &&
  peoplePage.includes('const fullName=personDisplayName(person)'),
  'People and Attendance must share one display-name contract.'
);
for (const [name, source] of [
  ['first-page Attendance API', peopleApi],
  ['complete Field Mode roster API', fieldRosterApi],
  ['incremental cross-device update API', fieldChangesApi]
]) {
  assert.ok(source.includes('p.display_name'), `${name} must return canonical display_name.`);
}
assert.ok(
  fieldMode.includes('person:{...p}') && fieldMode.includes('.map(x=>x.person)'),
  'Offline Field Mode must persist and restore the complete person payload, including display_name.'
);

console.log('[ATTENDANCE NAME PREFIX] Canonical name display and offline/API contracts passed.');

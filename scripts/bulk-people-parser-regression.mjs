// scripts/bulk-people-parser-regression.mjs
import assert from 'node:assert/strict';
import { parseBulkPeopleRows } from '../lib/bulkPeopleParser.mjs';

const names = [
  'Sis oyindamola',
  'Sis Grace',
  'sis Debby',
  'sis Deborah',
  'sis boluwatife',
  'Sis oluchi',
  'Sis Peace',
  'Sis Gospel'
];

const commaList = parseBulkPeopleRows('Sis oyindamola, Sis Grace, sis Debby, sis Deborah, sis boluwatife, Sis oluchi, Sis Peace, Sis Gospel,', 'member');
assert.equal(commaList.length, 8, 'A comma-separated name list must become eight people, not one CSV row.');
assert.deepEqual(commaList.map(row => row.full_name), names);
assert.ok(commaList.every(row => row.phone === '' && row.type === 'member' && row.email === ''));
assert.deepEqual(commaList.map(row => row.row_number), [1, 2, 3, 4, 5, 6, 7, 8]);
assert.equal(new Set(commaList.map(row => row.source_row_key)).size, 8, 'Each name on one source line needs its own stable retry identity.');
assert.ok(commaList.every(row => JSON.stringify(row.source_line_numbers) === '[1]'));

const twoNames = parseBulkPeopleRows('Sis Peace, Sis Gospel');
assert.deepEqual(twoNames.map(row => row.full_name), ['Sis Peace', 'Sis Gospel']);

const csvRows = parseBulkPeopleRows([
  'Name, Phone, Type, Email',
  'Mummy Christiana, 08022597401, visitor',
  'SIS Sandra Isiocha, 08039579758, member',
  'Bro John Doe, , member',
  'Jane Example'
].join('\n'), 'visitor');
assert.deepEqual(csvRows.map(row => row.full_name), [
  'Mummy Christiana',
  'SIS Sandra Isiocha',
  'Bro John Doe',
  'Jane Example'
]);
assert.equal(csvRows[0].phone, '08022597401');
assert.equal(csvRows[0].type, 'visitor');
assert.equal(csvRows[1].phone, '08039579758');
assert.equal(csvRows[1].type, 'member');
assert.equal(csvRows[2].phone, '');
assert.equal(csvRows[2].type, 'member');

const tabRows = parseBulkPeopleRows('Name\tPhone\tType\tEmail\nJane Example\t08012345678\tmember\tjane@example.com');
assert.equal(tabRows.length, 1);
assert.equal(tabRows[0].full_name, 'Jane Example');
assert.equal(tabRows[0].phone, '08012345678');
assert.equal(tabRows[0].type, 'member');
assert.equal(tabRows[0].email, 'jane@example.com');

const pipeRows = parseBulkPeopleRows('Jane Example | 08012345678 | visitor | jane@example.com');
assert.equal(pipeRows.length, 1);
assert.equal(pipeRows[0].full_name, 'Jane Example');
assert.equal(pipeRows[0].phone, '08012345678');
assert.equal(pipeRows[0].type, 'visitor');
assert.equal(pipeRows[0].email, 'jane@example.com');

const alternating = parseBulkPeopleRows('Bro John Doe\n08012345678\nJane Example\n08098765432');
assert.equal(alternating.length, 2);
assert.deepEqual(alternating.map(row => row.full_name), ['Bro John Doe', 'Jane Example']);
assert.deepEqual(alternating.map(row => row.phone), ['08012345678', '08098765432']);
assert.deepEqual(alternating.map(row => row.source_line_numbers), [[1, 2], [3, 4]]);

const incompletePhone = parseBulkPeopleRows('Jane Example\n080123');
assert.equal(incompletePhone.length, 1);
assert.equal(incompletePhone[0].full_name, 'Jane Example');
assert.equal(incompletePhone[0].phone, '080123', 'A partial number belongs in the phone field so server validation can explain it.');
assert.deepEqual(incompletePhone[0].source_line_numbers, [1, 2]);

const invalidCsvPhone = parseBulkPeopleRows('Jane Example, 080123, member');
assert.equal(invalidCsvPhone.length, 1);
assert.equal(invalidCsvPhone[0].full_name, 'Jane Example');
assert.equal(invalidCsvPhone[0].phone, '080123');

const compactEmail = parseBulkPeopleRows('Jane Example, jane@example.com');
assert.equal(compactEmail.length, 1);
assert.equal(compactEmail[0].full_name, 'Jane Example');
assert.equal(compactEmail[0].email, 'jane@example.com');
assert.equal(compactEmail[0].phone, '');

const blankLineRetry = parseBulkPeopleRows('Completed Person\nNeeds Review');
const retainedRetry = parseBulkPeopleRows('\nNeeds Review');
assert.equal(blankLineRetry[1].source_row_key, retainedRetry[0].source_row_key, 'Keeping blank source lines preserves retry identity.');
assert.deepEqual(retainedRetry[0].source_line_numbers, [2]);

const commaLineRetry = parseBulkPeopleRows('Alice Example, Bob Example');
const sameCommaLineRetry = parseBulkPeopleRows('Alice Example, Bob Example');
assert.deepEqual(commaLineRetry.map(row => row.source_row_key), sameCommaLineRetry.map(row => row.source_row_key));

const orphanPhone = parseBulkPeopleRows('08012345678');
assert.equal(orphanPhone.length, 1, 'A phone without a preceding name must not disappear.');
assert.equal(orphanPhone[0].full_name, '');
assert.equal(orphanPhone[0].phone, '08012345678');
assert.deepEqual(orphanPhone[0].source_line_numbers, [1]);

const blankSeparatedPhone = parseBulkPeopleRows('Jane Example\n\n08012345678');
assert.equal(blankSeparatedPhone.length, 2, 'A phone after a blank line must not attach to an earlier person.');
assert.equal(blankSeparatedPhone[0].full_name, 'Jane Example');
assert.equal(blankSeparatedPhone[0].phone, '');
assert.equal(blankSeparatedPhone[1].full_name, '');
assert.equal(blankSeparatedPhone[1].phone, '08012345678');

const commentSeparatedPhone = parseBulkPeopleRows('Jane Example\n# another list\n08012345678');
assert.equal(commentSeparatedPhone.length, 2, 'A phone after a comment must not attach to an earlier person.');

const headerOnly = parseBulkPeopleRows('Name, Phone, Type, Email');
assert.equal(headerOnly.length, 0);

console.log('[BULK PEOPLE PARSER REGRESSION] PASS: comma-separated name lists, spreadsheet rows, optional contacts, alternating phone lines, stable source identity, and partial-number validation are covered.');

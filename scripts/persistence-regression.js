const assert=require('node:assert/strict');
const fs=require('node:fs');
const people=fs.readFileSync('pages/api/people.js','utf8');
const mutation=fs.readFileSync('lib/aria/peopleMutationEngine.js','utf8');
const resolve=fs.readFileSync('pages/api/review/resolve.js','utf8');
const bulkPeople=fs.readFileSync('pages/api/people/bulk-create.js','utf8');

assert.ok(people.includes("import{updatePersonRecord}from'../../lib/aria/peopleMutationEngine';"),'People API must delegate edits to the canonical mutation engine.');
assert.ok(mutation.includes('WHERE id=$"+idIndex+"::uuid AND organization_id=$"+organizationIndex'),'Person edits must bind UUID and organization id parameters.');
assert.doesNotMatch(people,/WHERE id=\$\{n\} AND organization_id=\$\{n\+1\}/,'The legacy UUID-versus-integer update query must not return.');

assert.match(resolve,/metadata=metadata\|\|\$8::jsonb/);
assert.match(resolve,/metadata=metadata\|\|\$3::jsonb/);


assert.ok(mutation.includes("const rawPhone=String(fields.phone??'').trim()"),'Empty phone must be treated as a clearable value, not an invalid phone.');
assert.ok(mutation.includes("if(rawPhone&&!phone)throw Object.assign(new Error('That phone number is incomplete or invalid.'"),'Non-empty invalid phone values must still be rejected.');
assert.ok(mutation.includes("if(type!==String(current.type||'visitor').toLowerCase())add('type',type)"),'The Member/Visitor type update must remain persisted.');
assert.ok(mutation.includes('fields.status!==undefined'),'The active/inactive status must persist via the same canonical mutation.');
assert.match(bulkPeople,/const MAX_ROWS = 200/);
assert.match(bulkPeople,/pg_advisory_xact_lock/);
assert.match(bulkPeople,/Phone number duplicates row/);
assert.match(mutation,/phone_numbers/);
assert.match(bulkPeople,/findIdentityCandidates/);
assert.ok(bulkPeople.includes('waitUntil(processCreatedPeople('));
assert.ok(bulkPeople.includes("await client.query('COMMIT')"));

console.log('NYEOCARE persistence regression checks passed.');

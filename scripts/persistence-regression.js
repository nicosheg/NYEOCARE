const assert=require('node:assert/strict');
const fs=require('node:fs');
const people=fs.readFileSync('pages/api/people.js','utf8');
const resolve=fs.readFileSync('pages/api/review/resolve.js','utf8');
const bulkPeople=fs.readFileSync('pages/api/people/bulk-create.js','utf8');

assert.match(people,/updates\.push\(\'type=\'\+String\.fromCharCode\(36\)\+n\+\+\)/);
assert.doesNotMatch(people,/updates\.push\(\`type=\$\{n\+\+\}\`\)/);
assert.doesNotMatch(people,/updates\.push\(\'type=;values\.push/);

assert.match(resolve,/metadata=metadata\|\|\$8::jsonb/);
assert.match(resolve,/metadata=metadata\|\|\$3::jsonb/);


assert.ok(people.includes("const rawPhone=String(body.phone??'').trim()"),'Empty phone must be treated as a clearable value, not an invalid phone.');
assert.ok(people.includes("if(rawPhone&&!phone)return res.status(400).json({error:'That phone number is incomplete or invalid.'"),'Non-empty invalid phone values must still be rejected.');
assert.ok(people.includes("if(type!==current.type){updates.push('type='+String.fromCharCode(36)+n++);values.push(type)}"),'The Member/Visitor type update must remain persisted.');
assert.match(bulkPeople,/const MAX_ROWS = 200/);
assert.match(bulkPeople,/pg_advisory_xact_lock/);
assert.match(bulkPeople,/Phone number duplicates row/);
assert.match(bulkPeople,/phone_numbers/);
assert.match(bulkPeople,/waitUntil\\(processCreatedPeople/);
assert.match(bulkPeople,/await client\\.query\\('COMMIT'\\)/);

console.log('NYEOCARE persistence regression checks passed.');

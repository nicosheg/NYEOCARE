const assert=require('node:assert/strict');
const fs=require('node:fs');
const people=fs.readFileSync('pages/api/people.js','utf8');
const resolve=fs.readFileSync('pages/api/review/resolve.js','utf8');

assert.match(people,/updates\.push\(\'type=\$\'\+n\+\+\)/);
assert.doesNotMatch(people,/updates\.push\(\`type=\$\{n\+\+\}\`\)/);
assert.doesNotMatch(people,/updates\.push\(\'type=;values\.push/);

assert.match(resolve,/metadata=metadata\|\|\$8::jsonb/);
assert.match(resolve,/metadata=metadata\|\|\$3::jsonb/);

console.log('NYEOCARE persistence regression checks passed.');

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { filterRowsToOrganization } from '../lib/aria/tenantScope.js';

const currentOrganization = 'org-havilah-test';
const otherOrganization = 'org-another-church-test';

const foreignPerson = {
  id: '22222222-2222-4222-8222-222222222222',
  organization_id: otherOrganization,
  display_name: 'Bro Nicholas',
  phone: '08031234567'
};
const localPerson = {
  id: '11111111-1111-4111-8111-111111111111',
  organization_id: currentOrganization,
  display_name: 'Bro Nicholas',
  phone: '08031234567'
};

// Same name + phone in another organization must never become an identity candidate.
assert.deepEqual(
  filterRowsToOrganization([foreignPerson], currentOrganization),
  [],
  'a foreign-tenant match must not trigger identity review or block saving'
);

// A mixed result must expose only the signed-in organization's row.
assert.deepEqual(
  filterRowsToOrganization([foreignPerson, localPerson], currentOrganization).map(row => row.id),
  [localPerson.id],
  'foreign-tenant candidates must be removed even if a query/adapter returns them'
);

// Do not fail open when tenant context is missing or malformed.
assert.deepEqual(filterRowsToOrganization([foreignPerson, localPerson], ''), []);
assert.deepEqual(filterRowsToOrganization(null, currentOrganization), []);

// Verify the actual canonical mutation engine uses both SQL tenant predicates and
// the filter above, and the main People API does not keep a separate matcher.
const peopleApi = fs.readFileSync(new URL('../pages/api/people.js', import.meta.url), 'utf8');
const mutationEngine = fs.readFileSync(new URL('../lib/aria/peopleMutationEngine.js', import.meta.url), 'utf8');
assert.ok(
  peopleApi.includes("import{identityNameKey,findIdentityCandidates,updatePersonRecord}from'../../lib/aria/peopleMutationEngine';"),
  'People API must import the canonical identity matcher'
);
assert.doesNotMatch(peopleApi, /async function findIdentityCandidates/, 'People API must not retain a duplicate candidate matcher');
assert.match(peopleApi, /findIdentityCandidates\(orgId,incomingNameKey,phone,client\)/);
assert.match(peopleApi, /async function duplicatePhone\(orgId,phone,excludeId=null,db=pool\)/);
assert.match(peopleApi, /SELECT id,organization_id,display_name,phone FROM people/);
assert.match(peopleApi, /return filterRowsToOrganization\(q\.rows,orgId\)\[0\]\|\|null/);
assert.match(mutationEngine, /FROM people p WHERE p\.organization_id=\$1 AND p\.status='active'/);
assert.match(mutationEngine, /FROM people p WHERE p\.organization_id=\$1 AND p\.status IN \('inactive','archived'\)/);
assert.match(mutationEngine, /const scopedRows=filterRowsToOrganization\(result\.rows,organizationId\)/);
assert.match(mutationEngine, /WHERE id=\$1::uuid AND organization_id=\$2/);

console.log('Tenant identity isolation regression checks passed.');

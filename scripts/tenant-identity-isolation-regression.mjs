import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findIdentityCandidates, identityNameKey } from '../lib/aria/peopleMutationEngine.js';

const currentOrganization = 'org-havilah-test';
const otherOrganization = 'org-another-church-test';
const name = 'Bro Nicholas';
const phone = '08031234567';
const nameKey = identityNameKey(name);

function person(id, organizationId) {
  return {
    id,
    organization_id: organizationId,
    first_name: 'Bro',
    last_name: 'Nicholas',
    display_name: name,
    phone,
    phone_numbers: [{ raw: phone, normalized: phone, source: 'test', index: 1 }],
    email: null,
    type: 'member',
    status: 'active',
    created_at: '2026-10-01T00:00:00.000Z',
    phone_match: true,
    similar_name: true
  };
}

function fakeDb(rows, expectedOrganization) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      assert.equal(params[0], expectedOrganization, 'the tenant ID must be the first bound query parameter');
      assert.equal(
        (sql.match(/p\.organization_id=\$1/g) || []).length,
        2,
        'both active and inactive/archived identity searches must be organization-scoped'
      );
      assert.match(sql, /FROM people p WHERE p\.organization_id=\$1 AND p\.status='active'/);
      assert.match(sql, /FROM people p WHERE p\.organization_id=\$1 AND p\.status IN \('inactive','archived'\)/);
      return { rows };
    }
  };
}

// Even if a faulty adapter or future query regression returns a matching person from
// another tenant, that person must not become a candidate and must not block this save.
const crossTenantDb = fakeDb([person('22222222-2222-4222-8222-222222222222', otherOrganization)], currentOrganization);
const crossTenantCandidates = await findIdentityCandidates(
  currentOrganization, nameKey, phone, crossTenantDb
);
assert.deepEqual(crossTenantCandidates, [], 'another organization must not affect identity review or saving');
assert.equal(crossTenantDb.calls.length, 1);

// Identity safety remains enabled inside the same organization.
const localPerson = person('11111111-1111-4111-8111-111111111111', currentOrganization);
const sameTenantDb = fakeDb([localPerson], currentOrganization);
const sameTenantCandidates = await findIdentityCandidates(
  currentOrganization, nameKey, phone, sameTenantDb
);
assert.equal(sameTenantCandidates.length, 1, 'same-organization potential duplicates must still be reviewed');
assert.equal(sameTenantCandidates[0].id, localPerson.id);
assert.equal(sameTenantCandidates[0].name_match, true);
assert.equal(sameTenantCandidates[0].phone_match, true);

// Keep the primary People API on the one canonical tenant-scoped matcher so its
// create flow cannot drift into a second, differently scoped implementation.
const peopleApi = fs.readFileSync(new URL('../pages/api/people.js', import.meta.url), 'utf8');
const mutationEngine = fs.readFileSync(new URL('../lib/aria/peopleMutationEngine.js', import.meta.url), 'utf8');
assert.ok(
  peopleApi.includes("import{identityNameKey,findIdentityCandidates,updatePersonRecord}from'../../lib/aria/peopleMutationEngine';"),
  'People API must import the shared identity matcher'
);
assert.doesNotMatch(peopleApi, /async function findIdentityCandidates/, 'People API must not retain a duplicate candidate matcher');
assert.match(peopleApi, /findIdentityCandidates\(orgId,incomingNameKey,phone,client\)/);
assert.match(mutationEngine, /const scopedRows=result\.rows\.filter\(row=>String\(row\.organization_id\|\|''\)===String\(organizationId\)\)/);
assert.match(mutationEngine, /WHERE id=\$1::uuid AND organization_id=\$2/);

console.log('Tenant identity isolation regression checks passed.');

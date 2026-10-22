import fs from'node:fs';
import assert from'node:assert/strict';
import{inferBulkPeopleTypeIntent}from'../lib/aria/peopleBulkIntent.js';

const markAll=inferBulkPeopleTypeIntent('Mark all the people as members');
assert.deepEqual(markAll,{target_type:'member',source_type:null,scope:'all_active_people',explicit:true});
const visitors=inferBulkPeopleTypeIntent('Make every visitor a member');
assert.deepEqual(visitors,{target_type:'member',source_type:'visitor',scope:'all_active_people',explicit:true});
const reverse=inferBulkPeopleTypeIntent('Change all members to visitors');
assert.deepEqual(reverse,{target_type:'visitor',source_type:'member',scope:'all_active_people',explicit:true});
assert.equal(inferBulkPeopleTypeIntent('How many people are members?'),null);
assert.equal(inferBulkPeopleTypeIntent('I want ARIA to support “mark all the people as members”'),null);
assert.equal(inferBulkPeopleTypeIntent('Mark all the people as administrators'),null);

const read=p=>fs.readFileSync(p,'utf8');
const registry=read('lib/aria/capabilityRegistry.js');
const capabilityEngine=read('lib/aria/capabilityEngine.js');
const mutationEngine=read('lib/aria/peopleMutationEngine.js');
const commandEngine=read('lib/aria/commandEngine.js');
const conversation=read('lib/aria/conversationEngine.js');
assert.match(registry,/bulk_update_people_type:[\s\S]*requiredRole:'owner_or_admin'/);
assert.match(capabilityEngine,/case'bulk_update_people_type'/);
assert.match(mutationEngine,/export async function bulkUpdatePeopleType/);
assert.match(mutationEngine,/BEGIN/);
assert.match(mutationEngine,/PEOPLE_TYPE_BULK_UPDATED/);
assert.match(commandEngine,/inferBulkPeopleTypeIntent/);
assert.match(commandEngine,/requires_confirmation/);
assert.match(conversation,/bulk_update_people_type/);

console.log('[ARIA BULK PEOPLE TYPE REGRESSION]');
console.log('PASS: explicit bulk member/visitor commands are parsed; read-only mentions are not treated as actions; capability is role-gated and confirmation-gated.');

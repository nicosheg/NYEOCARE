import assert from 'node:assert/strict';
import fs from 'node:fs';
import { hashPersonCreatePayload, isValidPersonCreateRequestId } from '../lib/peopleCreateIdempotency.js';

const base={first_name:'Ada',last_name:'Okafor',display_name:'Ada Okafor',phone:'+2348012345678',email:'ADA@EXAMPLE.COM',type:'visitor',birthday:null};
assert.equal(isValidPersonCreateRequestId('7fbe3d72-6380-4ac4-8e6e-faf8e3c1c7ae'),true);
assert.equal(isValidPersonCreateRequestId('bad-request-id'),false);
assert.equal(hashPersonCreatePayload(base),hashPersonCreatePayload({...base,email:'ada@example.com'}),'Canonical email casing must not change the request hash.');
assert.notEqual(hashPersonCreatePayload(base),hashPersonCreatePayload({...base,phone:'+2348099999999'}),'Different phone evidence must not replay the same request.');
assert.notEqual(hashPersonCreatePayload(base),hashPersonCreatePayload({...base,type:'member'}),'Different person relationship type must not replay the same request.');

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const api=read('pages/api/people.js'),page=read('pages/people.js'),migration=read('supabase/migrations/20261026205524_person_create_request_idempotency.sql'),actorMigration=read('supabase/migrations/20261026205826_person_create_request_actor_delete_safe.sql');
assert.ok(api.includes('person_create_requests')&&api.includes('pg_advisory_xact_lock'),'The POST API must serialize retries and consult the durable request record.');
assert.ok(api.includes('PERSON_CREATE_REQUEST_ID_REUSED')&&api.includes('idempotent_replay:true')&&api.includes('idempotent_replay:false'),'The API must distinguish a safe replay from a request-key payload conflict and original creation.');
assert.ok(api.includes('display_name=split.display_name'),'Manual creation must persist the same normalized display name that the name parser returns.');
assert.ok(page.includes('client_request_id:requestId')&&page.includes('addRequestRef.current.signature!==signature'),'The UI must reuse a key on unchanged retries and rotate it when the payload changes.');
assert.ok(page.includes('data.created!==false&&!data.idempotent_replay'),'The UI must not increment the People total for an idempotent replay.');
assert.ok(migration.includes('PRIMARY KEY (organization_id, client_request_id)')&&migration.includes('ENABLE ROW LEVEL SECURITY')&&migration.includes('REVOKE ALL'),'The durable request table must enforce uniqueness and remain server-only.');
assert.ok(actorMigration.includes('ALTER COLUMN created_by DROP NOT NULL')&&actorMigration.includes('ON DELETE SET NULL'),'Removing an operator must not be blocked by historical idempotency records.');
console.log('[PERSON CREATE IDEMPOTENCY REGRESSION]');
console.log('PASS: request hashes, retry replay, key reuse conflicts, client key stability, and server-only migration contract.');

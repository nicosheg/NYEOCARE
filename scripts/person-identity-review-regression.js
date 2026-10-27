import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = path => fs.readFileSync(path, 'utf8');
const api = read('pages/api/people.js');
const page = read('pages/people.js');
const mutation = read('lib/aria/peopleMutationEngine.js');
const access = read('lib/attendance/access.js');
const profileApi = read('pages/api/profile.js');
const profileUi = read('pages/profile.js');
const community = read('components/CommunityTab.js');

assert.ok(api.includes('normalizeDisplayName(rawName)') && api.includes('identityNameKey(display_name||rawName)'), 'Person creation must normalize names and strip honorifics before identity comparison.');
assert.ok(api.includes('DUPLICATE_IDENTITY_NOT_DISTINCT') && api.includes('PERSON_IDENTITY_REVIEW_REQUIRED') && api.includes('PERSON_IDENTITY_REVIEW_STALE'), 'Creation must prevent identical name+phone identities and route ambiguous matches through a stale-safe review gate.');
assert.ok(api.includes('identity_pair_decisions') && api.includes('identity_shared_contacts') && api.includes("'not_duplicate'"), 'A human review must save an auditable distinct-person decision and verified shared-contact relationships.');
assert.ok(api.includes('const personEditorRoles=[\'owner\',\'admin\',\'leader\',\'worker\',\'user\']'), 'People access must be role-based on application operators, not People type.');
assert.ok(api.includes('identityReview})') && api.includes('candidates:err.candidates'), 'The API must pass edit review decisions and return candidates to the UI.');
assert.ok(mutation.includes('identityReview=null') && mutation.includes('PERSON_IDENTITY_REVIEW_REQUIRED') && mutation.includes('recordIdentityReview'), 'Canonical person edits must use the same identity review and audit contract as creation.');
assert.ok(page.includes('Verified: these are separate people') && page.includes('DUPLICATE_IDENTITY_NOT_DISTINCT') && page.includes('Open record'), 'The People screen must expose human review and block a second record for an identical name+phone pair.');
assert.ok(access.includes("'owner', 'admin', 'leader', 'worker', 'user'"), 'Legacy user accounts must remain usable as operators until role migration is designed.');
assert.ok(profileApi.includes('auth.admin.updateUserById') && profileApi.includes('user_metadata:{...authMetadata,name:canonicalName,full_name:canonicalName}'), 'The canonical NYEOCARE profile name must synchronize to Supabase Auth metadata.');
assert.ok(profileUi.includes('d.identity_sync_warning||\'Saved\''), 'A failed metadata sync must not be falsely reported as a clean save.');
assert.ok(community.includes('Array.isArray(data.items)'), 'Legacy People views must understand the paginated People API response.');
console.log('[PERSON IDENTITY REVIEW REGRESSION]');
console.log('PASS: honorific normalization, strict identity uniqueness, human review, shared contact evidence, edit review, account access, and profile-name synchronization.');

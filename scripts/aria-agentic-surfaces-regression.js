import fs from'node:fs';
import assert from'node:assert/strict';

const read=p=>fs.readFileSync(p,'utf8');
const firstExperience=read('components/FirstExperience.js');
const onboardingProvider=read('components/OnboardingProvider.js');
const profileApi=read('pages/api/profile.js');
const mutationEngine=read('lib/organizationMutationEngine.js');
const inviteApi=read('pages/api/users/invite.js');
const ariaPage=read('pages/aria.js');
const launcher=read('components/AriaCommandCenter.js');
const chatApi=read('pages/api/aria/chat.js');
const conversation=read('lib/aria/conversationEngine.js');
const registry=read('lib/aria/capabilityRegistry.js');
const commandEngine=read('lib/aria/commandEngine.js');
const capabilityEngine=read('lib/aria/capabilityEngine.js');
const accessEngine=read('lib/organizationAccessEngine.js');

assert.match(profileApi,/updateOrganizationProfile/,'Profile API must use the canonical organization mutation engine.');
assert.match(mutationEngine,/UPDATE users SET name=/,'Canonical profile engine must update the operator name transactionally.');
assert.match(mutationEngine,/UPDATE organizations SET name=/,'Canonical profile engine must update organization name transactionally.');
assert.match(mutationEngine,/UPDATE organizations SET aria_instructions=/,'Canonical profile engine must update ARIA organization knowledge.');
assert.match(inviteApi,/createOrganizationInvite/,'Invite API must use the canonical invitation mutation engine.');

assert.match(onboardingProvider,/String\(session\.user\?\.id\|\|''\)/,'Onboarding state must be keyed to the authenticated user, not only the organization.');
assert.match(onboardingProvider,/\/api\/onboarding/,'Every authenticated user must load onboarding state from the organization-aware endpoint.');
assert.match(firstExperience,/Keep your profile and organization in order/,'Profile onboarding must describe the real profile surface.');
assert.match(firstExperience,/manage organization access/,'Profile onboarding must describe access management.');
assert.match(firstExperience,/maintain the organization knowledge ARIA uses/,'Profile onboarding must describe ARIA knowledge controls.');

assert.match(launcher,/surface=String\(detail\?\.surface\|\|router\.pathname\|\|'unknown'\)/,'ARIA launcher must preserve originating surface context.');
assert.match(ariaPage,/surface,/,'ARIA page must carry source surface state.');
assert.match(ariaPage,/Next chat ↗/,'WhatsApp batch UI must expose an explicit Next chat action.');
assert.match(ariaPage,/autoAdvance:false/,'WhatsApp batches must default to manual Next-chat progression.');
assert.match(ariaPage,/pendingReturn/,'WhatsApp handoff state must survive leaving and returning to NYEOCARE.');
assert.match(chatApi,/surface:req\.body\?\.surface/,'ARIA chat API must carry surface context.');
assert.match(conversation,/surfaceLabel/,'Conversation execution must use originating surface context.');

assert.match(registry,/update_organization_profile/,'ARIA capability registry must expose profile updates.');
assert.match(registry,/create_organization_invite/,'ARIA capability registry must expose invitation creation.');
assert.match(registry,/manage_organization_access/,'ARIA capability registry must expose canonical access management.');
assert.match(commandEngine,/view organization access/,'ARIA must understand organization access reads.');
assert.match(commandEngine,/remove organization access/,'ARIA must understand organization access removal.');
assert.match(commandEngine,/change organization user role/,'ARIA must understand role changes.');
assert.match(commandEngine,/transfer organization ownership/,'ARIA must understand ownership transfer.');
assert.match(commandEngine,/bounded recovery/,'ARIA command execution must have bounded recovery.');
assert.match(commandEngine,/recoveryDepth<1/,'ARIA recovery must be bounded to one re-plan.');
assert.match(capabilityEngine,/manage_organization_access/,'Capability engine must execute the canonical access engine.');
assert.match(accessEngine,/remove_user/,'Canonical access engine must support removing users.');
assert.match(accessEngine,/change_role/,'Canonical access engine must support role changes.');
assert.match(accessEngine,/transfer_ownership/,'Canonical access engine must support ownership transfer.');
assert.match(accessEngine,/revoke_invitation/,'Canonical access engine must support invitation revocation.');
assert.match(accessEngine,/visibleInvitations=\['owner','admin'\]\.includes\(actor\.role\)/,'Canonical access engine must enforce invitation visibility by role.');

console.log('[ARIA AGENTIC SURFACES REGRESSION]');
console.log('PASS: profile mutation, onboarding ownership, invited-user state model, page context, and WhatsApp session contracts are wired together.');

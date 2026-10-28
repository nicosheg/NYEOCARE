import fs from'node:fs';
import assert from'node:assert/strict';
import { normalizePhoneList, primaryPhone } from '../lib/phoneUtils.js';
import { normalizeDisplayName } from '../lib/scanValidation.js';

const read=p=>fs.readFileSync(p,'utf8');
const peoplePage=read('pages/people.js');
const personPage=read('pages/person/[id].js');
const peopleApi=read('pages/api/people.js');
const phoneUtils=read('lib/phoneUtils.js');
const mutation=read('lib/aria/peopleMutationEngine.js');
const recommendations=read('lib/aria/recommendationEngine.js');
const eventProcessor=read('lib/aria/eventProcessor.js');
const intelligence=read('lib/aria/peopleIntelligence.js');
const command=read('lib/aria/commandEngine.js');
const conversation=read('lib/aria/conversationEngine.js');
const ariaPage=read('pages/aria.js');

assert.ok(peopleApi.includes("import{updatePersonRecord}from'../../lib/aria/peopleMutationEngine';"),'The People API must use the canonical edit mutation.');
assert.ok(peopleApi.includes("const personCreatorRoles=['owner','admin','leader','worker','user']")&&peopleApi.includes("req.method==='POST'&&!personCreatorRoles.includes(role)"),'Authorized organization operators, including the legacy user account role, must be able to create people; People type does not confer account permissions.');
assert.ok(peopleApi.includes("req.method==='GET'&&!personCreatorRoles.includes(role)")&&peopleApi.includes('private contact details are limited to authorized organization operators'),'Members must not receive the organization-wide People directory or private contact details through the API.');
assert.ok(peopleApi.includes("const personEditorRoles=['owner','admin','leader','worker','user']")&&peopleApi.includes("req.method==='PUT'&&!personEditorRoles.includes(role)"),'Only recognized organization operator account roles may edit People; People type must not grant operator permissions.');
assert.ok(peopleApi.includes("requestedPersonStatus")&&peopleApi.includes("p.status=$"),'The inactive status filter must use a bound SQL parameter.');
assert.ok(peopleApi.includes("r.type,r.status,r.birthday"),'People API responses must include organization status.');
assert.ok(peopleApi.includes('p.phone_numbers') && peopleApi.includes('phone:primaryPhone(row)') && peopleApi.includes('phone:primary,phone_numbers:ordered'), 'The People API must expose primary and alternate phones sourced from both storage fields.'); 
assert.ok(peopleApi.includes('jsonb_array_elements(CASE WHEN jsonb_typeof(p.phone_numbers)=\'array\' THEN p.phone_numbers ELSE \'[]\'::jsonb END)'), 'People search must include JSON-stored phone numbers, not only the legacy phone column.');
assert.ok(phoneUtils.includes('function primaryPhone(source)') && phoneUtils.includes('source?.phone_numbers'), 'Primary-phone resolution must be shared and use the same stored contact data as the identity engine.');
assert.ok(phoneUtils.includes('if(source?.phone)values.push(source.phone)'), 'Phone lists must prefer the canonical primary phone before ordered JSON alternates.');
assert.ok(mutation.includes('if(nextPhone||userPrimaryPhoneChanged)') && mutation.includes("add('phone_numbers',desiredPhoneNumbersJson)"), 'Any edit must repair a JSON-only primary into the legacy phone column and keep both phone fields synchronized in one transaction.');
assert.ok(peopleApi.includes('display_name,phone,phone_numbers,email,type') && peopleApi.includes("source:'manual',index:1"), 'Manual person creation must seed the JSON phone list with the normalized primary number.');
assert.ok(mutation.includes("source:'aria_direct_create',index:1") && mutation.includes("source:'aria_roster_import',index:1") && mutation.includes('phone,phone_numbers,type'), 'ARIA-created and roster-imported people must also write their primary phone to both storage fields.');
assert.ok(read('pages/api/people/bulk-create.js').includes('phone,phone_numbers,email,type,birthday') && read('pages/api/people/bulk-create.js').includes("source:'manual',index:1"), 'Bulk People creation must write a synchronized primary phone for each newly created person.');
assert.ok(read('pages/api/identity/resolve.js').includes('phone,phone_numbers,type,status,confidence') && read('pages/api/identity/resolve.js').includes('normalizePhone(rawPhone)'), 'Human scan identity resolution must normalize the phone and persist both primary and JSON phone fields.');
assert.ok(mutation.includes("const identityFieldsChanged=updatedFields.some(field=>['first_name','last_name','display_name'].includes(field))||userPrimaryPhoneChanged") && mutation.includes('if(!userPrimaryPhoneChanged)identityCandidates=identityCandidates.filter(candidate=>candidate.name_match||candidate.similar_name)'), 'A storage-only phone repair must not be mistaken for a user phone change or create a false shared-phone conflict.');
const reviewCenter=read('components/ReviewCenterTab.js');
const duplicateAction=read('pages/api/review/duplicate-action.js');
const reviewResolve=read('pages/api/review/resolve.js');
assert.ok(reviewCenter.includes('selectedCandidate=(item.candidates||[]).find(c=>String(c.id)===String(initialSelected))') && reviewCenter.includes('contactPhones=item.kind!==\'database_duplicate\'&&selectedCandidate?phones(selectedCandidate):p'), 'Review Center must prefill an edit from the selected canonical person, not stale scan-extracted phone values.');
assert.ok(reviewCenter.includes('function selectCandidate(candidate)') && reviewCenter.includes('onClick={()=>selectCandidate(c)}') && reviewCenter.includes("setPhone(existingPhones[0]||'');setPhone2(existingPhones[1]||'')"), 'Changing the selected review target must refresh the phone fields to that exact target before saving.');
assert.ok(reviewResolve.includes("sameVisible?existingTargetPhones:(submittedPhones.length?[...new Set([...submittedPhones,...existingTargetPhones.slice(2)])].slice(0,4):[])"), 'Review Center edits must preserve hidden third/fourth alternate phones when one of the two visible phone fields changes, but honor an explicit clear-all.');
assert.ok(reviewResolve.includes("hasPhoneList=Object.prototype.hasOwnProperty.call(body||{},'phones')") && reviewResolve.includes('values=hasPhoneList?raw:(raw.length?raw:fallback)'), 'An explicit empty phone list must be treated as a deliberate clear rather than silently restoring scan/target phone values.');
assert.ok(duplicateAction.includes('values=[p?.phone,...ordered,...(Array.isArray(p?.phones)?p.phones:[])]'), 'A duplicate merge must retain the selected survivor\'s primary phone before alternate phones from either record.');

assert.ok(mutation.includes('phone_numbers,email,birthday') && mutation.includes('const currentPhone=primaryPhone(current)'), 'An edit must compare against the visible phone even when the primary is stored only in phone_numbers.');
assert.ok(mutation.includes('p.phone,p.phone_numbers,p.email') && mutation.includes('phone:primaryPhone(row)'), 'Edit identity candidates must display the same phone source the backend used to match them.');
assert.ok(mutation.includes("add('phone_numbers',desiredPhoneNumbersJson)") && mutation.includes("if(currentPhoneColumn!==(nextPhone||''))add('phone',nextPhone)"), 'Changing a phone or repairing stored phone data must write phone and phone_numbers together while preserving alternate numbers.');
assert.ok(mutation.includes("function phoneNumbersForEditedPrimary(person,nextPrimary,primarySource='human_edit')"), 'Phone edits must preserve the selected primary and remaining stored alternate numbers without stale phone values.');
assert.ok(mutation.includes("normalizePhoneList({phones:[entry]},{limit:1})"), 'Phone edits must recover a valid raw number when a stored normalized value is invalid.');
assert.ok(duplicateAction.includes('if(normalized)valid.push(normalized);else') && duplicateAction.includes('mergedPrimary=mergedPhones.map(normalizePhone).find(Boolean)||null'), 'Duplicate merges must prefer a valid primary even when older rows contain corrupt normalized values.');
assert.ok(personPage.includes('p?.phone_numbers'), 'Person Journey must display a number stored in phone_numbers when phone is blank.');
assert.ok(peopleApi.includes("p.status IN ('active','inactive')"),'The directory must be able to query active and inactive records.');
assert.ok(!/WHERE id=\$\{n\} AND organization_id=\$\{n\+1\}/.test(peopleApi),'The old UUID-versus-integer update predicate must not return.');

assert.ok(mutation.includes("WHERE id=$\"+idIndex+\"::uuid AND organization_id=$\"+organizationIndex"),'Every person update must bind UUID and organization placeholders.');
assert.ok(mutation.includes("fields.email!==undefined"),'Person email edits must persist.');
assert.ok(mutation.includes("fields.type!==undefined"),'Person member/visitor classification edits must persist.');
assert.ok(mutation.includes("fields.status!==undefined"),'Active/inactive status edits must persist.');
assert.ok(mutation.includes("status IN('active','inactive')"),'Active and inactive records must remain editable unless archived.');
assert.ok(mutation.includes("await directAriaEvent(event)"),'Person edits must be sent to ARIA immediately after the database commit.');
assert.ok(mutation.includes("eventKey:'aria-person-edit:'"),'Person edits must have an auditable ARIA event identity.');

assert.ok(peoplePage.includes("value={personStatusFilter}"),'The People page must expose active/inactive status filtering.');
assert.ok(peoplePage.includes("value={editType}"),'The People edit card must retain member/visitor selection.');
assert.ok(peoplePage.includes("value={editStatus}"),'The People edit card must allow active/inactive status changes.');
assert.ok(peoplePage.includes("if(editStatus!==originalStatus)body.status=editStatus"),'The People edit request must send organization status when it actually changes.');
assert.ok(personPage.includes("value={editType}"),'The person profile editor must offer member/visitor selection.');
assert.ok(personPage.includes("value={editStatus}"),'The person profile editor must offer active/inactive status selection.');
assert.ok(personPage.includes("body.status=nextStatus"),'The profile edit request must persist status changes.');

assert.ok(recommendations.includes("AND(a.person_id IS NULL OR p.status='active')"),'Inactive people must not appear in the current pending-action list.');
assert.ok(recommendations.includes("o.person_id IS NULL OR p.status='active'"),'Inactive people must not receive freshly generated observation follow-up actions.');
assert.ok(eventProcessor.includes("personCanReceiveCurrentAction"),'Queued person-created events must not generate current follow-up actions for inactive people.');
assert.ok(mutation.includes("Person marked inactive; current follow-up paused"),'Making a person inactive must cancel their pending follow-up actions.');
assert.ok(intelligence.includes("status IN('active','inactive')"),'ARIA intelligence must process active and inactive person edits instead of retrying forever.');
assert.ok(intelligence.includes("Current follow-up is paused while this person is inactive."),'Inactive People must have no current next-best-action recommendation.');
assert.ok(intelligence.includes("SELECT id,status,type FROM people")&&intelligence.includes("personType:r.rows[0].type"),'ARIA intelligence must consume the canonical member/visitor field.');
assert.ok(intelligence.includes("type==='visitor'&&count===0")&&intelligence.includes("type==='member'&&count<2"),'Visitor onboarding must not be recommended to members without confirming useful evidence.');
assert.ok(command.includes("not operator account roles or permissions")&&command.includes("Sample records:")&&command.includes("Confirm to apply this exact preview."),'Bulk membership confirmation must distinguish People type from operator access and preview the affected records.');
assert.ok(conversation.includes("?'Confirm change':'Confirm with ARIA'"),'Bulk updates must expose a single clear confirmation action.');
assert.ok(ariaPage.includes("suggestion.label==='Confirm change'?'Confirm':'Prepare it'"),'The bulk action must have one direct Confirm button.');

assert.ok(!peopleApi.includes("ESCAPE E'"),'People search must not generate a malformed PostgreSQL escape clause.');
assert.ok(peopleApi.includes("p.type=$${n++}::text"),'Visitor/member filtering must bind a text placeholder instead of comparing the text type to a numeric index.');
assert.ok(peopleApi.includes("p.status=$${n++}::text"),'Dynamic status filtering must bind an explicit text placeholder.');
assert.ok(peopleApi.includes("ILIKE $${patternIndex}::text")&&!peopleApi.includes("ESCAPE E'"),'Search placeholders must be typed and use PostgreSQL default LIKE escaping.');
assert.ok(peoplePage.includes("height:38")&&peoplePage.includes(".people-control-button{min-height:36px")&&peoplePage.includes(".people-filter-select{width:100%"),'People search and filter controls must stay compact and accessible.');
assert.ok(peopleApi.includes("regexp_replace(COALESCE(p.phone,''), '[^0-9]', '', 'g')")&&peopleApi.includes("SUBSTRING(${phoneDigitsExpr} FROM 4)")&&peopleApi.includes('isPhoneSearch&&digits.length>=3'),'People search must match digit-only and Nigerian local-format versions of phone numbers without treating mixed name searches as phone searches.');
assert.ok(peoplePage.includes('aria-label="Search people by name, phone, or email"')&&peoplePage.includes('aria-label="Clear search"'),'People search must remain accessible and provide a one-tap clear action.');
assert.ok(peoplePage.includes('aria-controls="people-filter-panel"')&&peoplePage.includes('Reset filters')&&peoplePage.includes('aria-pressed={showLivingTruthOnly}'),'People filters must be consolidated into an accessible expandable panel with reset support.');
assert.ok(peoplePage.includes('Add multiple people')&&peoplePage.includes('Bulk add from a list')&&!peoplePage.includes('Bulk add</button>'),'Single and bulk person creation must share one Add people action rather than competing toolbar buttons.');
assert.ok(peoplePage.includes("search||activeFilterCount>0?'No people found':'No people yet'"),'An empty People result caused by any active filter must not be described as an empty organization.');
assert.equal(primaryPhone({phone:null,phone_numbers:[{normalized:'unreadable',raw:'08012345678',index:1}]}),'+2348012345678','Primary-phone resolution must fall back to a valid raw phone when the normalized field is corrupt.');
assert.deepEqual(normalizePhoneList({phone:'+2348098765432',phone_numbers:[{normalized:'invalid',raw:'08012345678',index:1}] }),['+2348098765432','+2348012345678'],'Phone-list resolution must prefer the canonical primary and then recover valid raw alternates.');

assert.ok(!peoplePage.includes('className="person-card-actions"')&&!peoplePage.includes("aria-label={'Message '+fullName}")&&!peoplePage.includes("aria-label={'Add note for '+fullName}")&&!peoplePage.includes("aria-label={'More options for '+fullName}")&&personPage.includes('<div style={S.actions}>')&&personPage.includes('<button style={S.action} disabled={!phone} onClick={message}>Message</button>')&&personPage.includes('<button style={S.action} onClick={()=>setNote(true)}>Note</button>')&&personPage.includes('<button style={S.moreAction} aria-label="More options"')&&personPage.includes('<button style={S.action} aria-label="Edit details" onClick={openEdit}>Edit</button>'), 'People cards must remain uncluttered; Message, Note, More and Edit must live together in the People Journey action row.');
assert.ok(reviewCenter.includes("refreshPeopleAfterReview('review-duplicate-decision'")&&reviewCenter.includes("refreshPeopleAfterReview('review-identity-decision'")&&reviewCenter.includes("publishDataChange('people'")&&reviewCenter.includes("nyeocare:app-refresh"), 'Every persisted Review Center identity decision must signal the People UI to reload canonical records.');

assert.ok(personPage.includes('const body={id};')&&personPage.includes('if(nextPhone!==originalPhone)body.phone=nextPhone')&&personPage.includes('if(nextEmail!==originalEmail)body.email=nextEmail')&&personPage.includes('if(nextBirthday!==originalBirthday)body.birthday=nextBirthday||null'), 'People Journey edits must submit only fields the operator actually changed; an unchanged shared phone must not be resent as a phone edit.');
assert.ok(personPage.includes("setP(prev=>({...prev,...d,communications:prev?.communications||[]")&&personPage.includes("String(d.id||'')!==String(id)")&&personPage.includes('await load(activeToken)'), 'A successful People Journey edit must apply the canonical saved row, verify the returned person ID, and reload the record.');
assert.ok(!peoplePage.includes('className="person-card-actions"')&&!peoplePage.includes("aria-label={'Message '+fullName}")&&!peoplePage.includes("aria-label={'Add note for '+fullName}")&&!peoplePage.includes("aria-label={'More options for '+fullName}")&&peoplePage.includes('personCardPhone(person)')&&peoplePage.includes('primaryPhone(person)'), 'People cards must retain name/contact information while removing the action row.');
assert.ok(personPage.includes('disabled={busy||!editName.trim()}')&&personPage.includes("busy?'Saving…':'Save changes'"), 'The People Journey editor must prevent repeated submits and show its in-flight save state.');
assert.equal(normalizeDisplayName('Caleb $5').display,'Caleb $5','Dollar signs in literal names must survive name normalization.');
assert.ok(mutation.includes("if(existingName.honorific&&!incomingName.honorific)incoming=existingName.honorific+' '+incoming"), 'A direct name edit must preserve the existing recognized honorific while applying the edited name text.');

assert.ok(peoplePage.includes('personCardPhone(person)')&&peoplePage.includes('primaryPhone(person)'), 'People cards must display the canonical primary phone or fall back to the ordered phone_numbers JSON list.');
assert.ok(personPage.includes('<button style={S.action} aria-label="Edit details" onClick={openEdit}>Edit</button>'), 'The single accessible Edit action belongs in the People Journey action row beside Message, Note and More.');

console.log('[PEOPLE EDIT REGRESSION]');
console.log('PASS: SQL-bound edits, email/type/status persistence, inactive directory filtering, and ARIA synchronization/suppression contracts.');

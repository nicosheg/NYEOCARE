const assert=require('node:assert/strict');
const fs=require('node:fs');
const home=fs.readFileSync('pages/index.js','utf8');
const people=fs.readFileSync('pages/people.js','utf8');
const person=fs.readFileSync('pages/person/[id].js','utf8');
const config=fs.readFileSync('next.config.js','utf8');

assert.ok(home.includes("const ReviewCenterTab=dynamic(()=>import('../components/ReviewCenterTab')"));
assert.equal((home.match(/<ReviewCenterTab/g)||[]).length,1);
assert.match(people,/const ReviewCenterTab=dynamic\(\(\)=>import\('\.\.\/components\/ReviewCenterTab'\)/);
assert.equal((people.match(/<ReviewCenterTab modal/g)||[]).length,1);
assert.doesNotMatch(people,/const resolveReview=async/);
assert.doesNotMatch(people,/review-panel-overlay/);
assert.doesNotMatch(people,/const loadFullReview=/);
assert.match(config,/destination: '\/people\?review=1'/);

console.log('NYEOCARE shared Review Center regression checks passed.');

const review=fs.readFileSync('components/ReviewCenterTab.js','utf8');
assert.match(review,/activeGroup/);
assert.match(review,/title:'Follow up'/);
assert.match(review,/title:'Scan review'/);
assert.match(review,/title:'Duplicates'/);
assert.match(review,/Needs attendance confirmation/);
assert.match(review,/Scan identity needs review/);


const reviewResolve=fs.readFileSync('pages/api/review/resolve.js','utf8');
assert.match(reviewResolve,/startsWith\('scan:'\)/);
assert.match(reviewResolve,/Invalid bulk review action/);
assert.match(reviewResolve,/status='rejected'/);

const openStart=review.indexOf('function open(item){');
const closeStart=review.indexOf(' function close()',openStart);
assert.ok(openStart>=0&&closeStart>openStart,'Review detail opener must exist');
const openBody=review.slice(openStart,closeStart);
assert.ok(openBody.includes('setActive(item)'),'opening a review should only open its detail');
assert.doesNotMatch(openBody,/api\(|setItems\(/,'opening a review must not resolve/remove it');
assert.match(review,/active\.kind!=='scan_identity_review'&&<div role="status"/,'the long workflow status must not crowd the scan identity decision screen');
assert.match(review,/const detail=active\?<ModalPortal>/,'the detail sheet must render outside transformed/scrolling ancestors');
assert.match(review,/sheetBody:\{flex:'1 1 auto',minHeight:0,overflowY:'auto'/,'review details must scroll independently');
assert.match(review,/sheetFooter:\{flex:'0 0 auto'/,'decision actions must remain in a pinned footer');
assert.match(review,/Update existing person from scan/,'a scan row must have an explicit update-existing-person action');
assert.match(review,/Confirm match · keep current details/,'identity confirmation must be distinct from editing the person');
assert.match(review,/Add as a new person/,'creating a new person must be a deliberate alternative');
assert.match(review,/candidateId:\['approve','edit'\]\.includes\(action\)\?selected:null/,'editing a selected candidate must target that existing person');
assert.match(review,/onClick=\{\(\)=>save\('edit',false,true\)\}/,'the primary scan action must update the selected People record and merge only approved scan evidence');
assert.match(review,/scan_phone_merge_safe/,'the scan review must explain when a scanned phone can safely be added');
assert.match(review,/scan_name_merge_safe/,'the scan review must explain when a scanned name can safely update the canonical person.');
assert.match(review,/save\(sharedPhoneReview\.action\|\|'edit',true,!!sharedPhoneReview\.includeScannedPhones\)/,'shared-phone confirmation must resume the exact pending scan-update action.');
assert.match(review,/result\?\.persisted!==true/,'the UI must require a verified persistence response before clearing a review');
assert.match(review,/if\(!silent\)setLoading\(false\)/,'silent refresh must not temporarily blank the queue');

assert.match(reviewResolve,/import\{resolveIdentities\}from'\.\.\/\.\.\/\.\.\/lib\/identityResolver'/,'fresh candidates from Review Center must be revalidated server-side before editing');
assert.match(reviewResolve,/freshAllowed\.includes\(selected\)/,'a fresh candidate can be edited only if current server-side identity matching confirms it');
assert.match(reviewResolve,/REVIEW_CANDIDATES_UNAVAILABLE/,'candidate verification failure must keep the review pending');
assert.match(reviewResolve,/REVIEW_CANDIDATE_STALE/,'stale edit targets must not silently turn into person creation');
assert.match(reviewResolve,/REVIEW_PERSISTENCE_VERIFICATION_FAILED/);
assert.match(reviewResolve,/const savedResult=await db\.query/);
assert.match(reviewResolve,/previousTargetName&&normalizeName\(previousTargetName\)!==normalizeName\(finalName\)/,'a corrected existing display name must retain the former canonical name as an alias');
assert.match(reviewResolve,/persisted\.identity_verification_status/);
assert.match(reviewResolve,/record_persisted:true,record_verified:true/);
assert.match(reviewResolve,/WHERE id=\$1 AND organization_id=\$5 AND status='pending' RETURNING id,status/);
assert.match(reviewResolve,/identity_verification_status,identity_verified_at,identity_verified_by,identity_verification_source/);
assert.match(reviewResolve,/review_status:'resolved'.*persisted:true/s);
assert.match(reviewResolve,/const existingTargetPhones=phonesFrom\(target\),scanEvidence=review\.evidence\?\.extracted\|\|\{\},requestedScanPhoneMerge=action==='edit'&&mergeScannedPhones===true/,'existing phones and stored scan evidence must be loaded before a verified scan update');
assert.match(reviewResolve,/chosen=requestedScanPhoneMerge&&!scanNameSafe\?target\.display_name/,'uncertain scan handwriting must preserve the chosen person canonical name');
assert.match(reviewResolve,/phoneNumbersBeingAdded=action==='edit'\?finalPhones\.filter\(value=>!existingTargetPhones\.includes\(value\)\):\[\]/,'a name-only edit must not be blocked by a phone number already on that same record');
assert.match(reviewResolve,/regexp_replace\(COALESCE\(phone,''\),'\[\^0-9\]','','g'\)/,'phone collision matching must compare normalized digits consistently across formats');
assert.match(reviewResolve,/if\(explicitNew&&finalId&&\(candidates\.length\|\|sharedPhoneOwners\.length\)\)/,'an explicit different-person decision must support an intentional shared phone');
assert.match(reviewResolve,/INSERT INTO identity_shared_contacts/,'an explicitly shared phone must be recorded as a shared contact, not used as identity proof');
assert.match(reviewResolve,/human_confirmed_separate_scan_person/,'the shared-contact relation must retain its human-review provenance');
assert.match(reviewResolve,/SHARED_PHONE_REVIEW_REQUIRED/,'an existing-person edit with a newly added shared phone must ask for human confirmation before writing');
assert.match(reviewResolve,/SHARED_PHONE_REVIEW_STALE/,'shared-phone confirmation must be invalidated when the phone owners change');
assert.match(reviewResolve,/human_confirmed_review_edit_shared_phone/,'reviewed existing-person edits must audit an intentional shared phone');
assert.match(review,/Confirm shared phone & save/,'Review Center must offer an explicit human confirmation for a legitimate shared phone');
assert.match(review,/sharedPhoneOwnerIds:sharedPhoneReview\.phone_owners\.map/,'the server must receive the exact owner set the operator reviewed');
assert.match(review,/e\?\.code\|\|''\)\)\)\{setSharedPhoneReview/,'the UI must keep the edit open and show the shared-phone review instead of discarding the error');
const duplicateAction=fs.readFileSync('pages/api/review/duplicate-action.js','utf8')+'\n'+fs.readFileSync('lib/identityMerge.js','utf8');
assert.match(review,/canonicalId:selected,duplicateId:other\.id/,'the selected duplicate candidate must be the canonical record');
assert.match(review,/mergeResult\?\.canonical_id\)!==String\(selected\)/,'the UI must verify that the selected person is the canonical merge survivor before closing the review');
assert.match(review,/mergeResult\?\.archived_id\)!==String\(other\.id\)/,'the UI must verify that only the other selected record was archived');
assert.match(review,/mergeResult\?\.record_verified!==true/,'the UI must not close a merge review without server-side read-back verification');
assert.match(duplicateAction,/await mergePeople\(db,req\.org\.id,canonicalId,duplicateId,req\.user\.id,evidence\)/,'merge must preserve the selected canonical ID');
assert.match(duplicateAction,/UPDATE people SET status='archived'.*\[duplicateId,canonicalId,actorId,org\]/s,'only the non-selected duplicate record should be archived');

assert.ok(review.includes("refreshPeopleAfterReview('review-duplicate-decision'")&&review.includes("refreshPeopleAfterReview('review-identity-decision'")&&review.includes("publishDataChange('people'")&&review.includes("nyeocare:app-refresh"), 'Every verified Review Center identity decision must invalidate People data and refresh mounted directory surfaces.');
assert.ok(!people.includes('className="person-card-actions"')&&person.includes('<div style={S.actions}>')&&person.includes('<button style={S.action} aria-label="Edit details" onClick={openEdit}>Edit</button>')&&person.includes('<button style={S.action} disabled={!phone} onClick={message}>Message</button>')&&person.includes('<button style={S.action} onClick={()=>setNote(true)}>Note</button>'), 'People cards must stay uncluttered while the Journey row exposes accessible Message, Note, More, and Edit actions.');


const mutationEngine=fs.readFileSync('lib/aria/peopleMutationEngine.js','utf8');
const identityAction=fs.readFileSync('pages/api/review/person-identity-action.js','utf8');
const identityMerge=fs.readFileSync('lib/identityMerge.js','utf8');
const identityDecision=fs.readFileSync('components/PeopleEditIdentityDecision.js','utf8');
const peopleApi=fs.readFileSync('pages/api/people.js','utf8');
const reviewApi=fs.readFileSync('pages/api/review/index.js','utf8');
assert.match(mutationEngine,/source:'people_edit_identity_review'/,'People edit conflicts must be persisted as durable identity reviews');
assert.match(mutationEngine,/await client\.query\('COMMIT'\)[\s\S]*review_status:'pending'/,'the review must commit before the edit API returns its conflict');
assert.match(mutationEngine,/if\(!error\?\.committed\)await client\.query\('ROLLBACK'\)/,'a committed pending review must not be rolled back by the error handler');
assert.match(peopleApi,/review_id:String\(err\.review_id\)/,'the People API must return the durable review identifier');
assert.match(reviewApi,/source_person_id:row\.source==='people_edit_identity_review'/,'Review Center must identify the edited source record');
assert.match(identityAction,/currentCandidates\(db,req\.org\.id,proposal,editTargetId\)/,'candidate matching must exclude the original edited person');
assert.match(identityAction,/await mergePeople\(db,req\.org\.id,String\(canonicalId\),String\(editTargetId\)/,'same-person resolution must merge the edited record into the selected survivor');
assert.match(identityAction,/proposedPhones:retainedPhones/,'different-person resolution must retain the original record and record its separate-person pair decisions');
assert.match(identityAction,/IDENTITY_EDIT_MERGE_VERIFICATION_FAILED/,'failed merge verification must roll back and preserve the pending review');
assert.match(identityAction,/IDENTITY_EDIT_SEPARATE_VERIFICATION_FAILED/,'failed edit verification must roll back and preserve the pending review');
assert.match(identityAction,/if\(!editTargetId\)await upsertCreateRequest/,'edit reviews must not be treated as new-person creation requests');
assert.match(identityMerge,/export async function mergePeople/,'edit reviews and duplicate reviews must share history reconciliation');
assert.match(review,/initialReviewId/,'Review Center must open an exact pending review by ID');
assert.match(review,/Same person — merge into selected/,'the edit review must expose an explicit same-person action');
assert.match(review,/Different people — save edit and keep both/,'the edit review must expose an explicit separate-people action');
assert.match(people,/\{editIdentityReview&&<PeopleEditIdentityDecision/,'People edit conflicts must conditionally render the shared identity decision panel only when a durable review exists');
assert.match(person,/\{editIdentityReview&&<PeopleEditIdentityDecision/,'Person Journey must conditionally render the same shared decision panel only when a durable review exists');
assert.match(identityDecision,/Open full review/,'The shared identity decision panel must offer a deep link to the full Review Center item');
assert.match(people,/router\.push\('\/people\?review=1&review_id=/,'People must deep-link to the exact pending Review Center item');
assert.match(person,/r\.push\(\x60\/people\?review=1&review_id=/,'Person Journey must deep-link to the exact pending Review Center item');
assert.doesNotMatch(person,/href=\{\x60\/person\/\$\{candidate\.id\}\x60\}/,'Journey candidate navigation must not replace the review decision');

console.log('NYEOCARE review queue persistence and edit-verification regression checks passed.');

// scripts/scan-review-regression.js
import fs from'fs';
const read=p=>fs.readFileSync(p,'utf8');
const identity=read('lib/identityResolver.js');
const review=read('components/ReviewCenterTab.js');
const reviewApi=read('pages/api/review/index.js');
const resolveApi=read('pages/api/review/resolve.js');
const people=read('pages/people.js');
const vision=read('lib/visionProcessor.js');
const scanValidation=read('lib/scanValidation.js');
const person=read('pages/person/[id].js');
const journeyApi=read('pages/api/person/journey.js');
const navigationBack=read('components/NavigationBack.js');
const duplicateAction=read('pages/api/review/duplicate-action.js');
function assert(v,m){if(!v)throw new Error(m)}
assert(/Math\.round\(\(ns\+ps\.score\)\/2\)/.test(identity),'Identity resolver must use balanced 50/50 scoring.');
assert(/This is a different person/.test(review)&&/Use this person/.test(review)&&/Edit scanned record/.test(review),'Review Center must expose explicit human identity outcomes.');
assert(/name_match_but_phone_not_exact/.test(review)&&/Existing person ·/.test(review),'Review Center must explain name/phone disagreement and distinguish candidate phone from scanned phone.');
assert(/resolveIdentities/.test(reviewApi)&&/sanitizeReasons/.test(reviewApi)&&/phone_missing/.test(reviewApi),'Review API must refresh pending identity evidence using the canonical resolver and remove stale phone-missing claims when a scan actually has a phone.');
assert(/canonicalId:selected,duplicateId:other\.id/.test(review)&&/String\(mergeResult\?\.canonical_id\)!==String\(selected\)/.test(review),'When merging from Review Center, the chosen record ID must be sent as canonical and the response must prove that the same selected record survived.');
assert(/import\{normalizePhoneList,primaryPhone\}from'\.\.\/\.\.\/\.\.\/lib\/phoneUtils'/.test(reviewApi)&&/phone:primaryPhone\(liveRow\)/.test(reviewApi),'Review candidate summaries must show JSON-backed primary phones consistently with the People directory.');
assert(/phonesFrom=row=>normalizePhoneList\(row,\{limit:4\}\)/.test(resolveApi),'Review edits must preserve the canonical primary phone before ordered alternate contacts when saving a selected person.');
assert(/const needsIdentityReview=!decision\|\|decision\.status==='conflict'\|\|decision\.status==='needs_decision'/.test(vision),'Scan persistence must distinguish unresolved identity from field-level uncertainty.');
assert(/if\(decision\?\.status==='alive'&&decision\.best_candidate_id\)/.test(vision)&&/touchRecognizedPerson/.test(vision),'Strong existing identities must be persisted as recognized before any field review is created.');
assert(!/if\(needsIdentityReview\|\|fieldReasons\.length\)/.test(vision),'Field uncertainty must not demote an already-resolved identity into an identity review.');
assert(/keep_separate/.test(resolveApi)&&/identity_pair_decisions/.test(resolveApi),'Review resolve must persist keep-separate decisions.');
assert(/mergeLearningHistory/.test(duplicateAction)&&/mergeActionHistory/.test(duplicateAction)&&/preserveImmutableEventHistory/.test(duplicateAction)&&/mergeObservationHistory/.test(duplicateAction)&&/mergeAttendanceContexts/.test(duplicateAction)&&!/UPDATE aria_events SET person_id/.test(duplicateAction)&&!/DELETE FROM aria_events/.test(duplicateAction),'Duplicate merge must preserve immutable ARIA event history while reconciling mutable ARIA domains.');
assert(/mergePersonRelationships/.test(duplicateAction)&&/mergeIdentitySharedContacts\(db,org,canonicalId,duplicateId\)/.test(duplicateAction)&&/mergeIdentityPairDecisions\(db,org,canonicalId,duplicateId\)/.test(duplicateAction)&&/aria_person_state/.test(duplicateAction),'Duplicate merge must reconcile relationships, shared-contact/pair-decision history, and ARIA person-state uniqueness safely.');
assert(/UPDATE person_aliases SET person_id=\$1/.test(duplicateAction)&&/UPDATE person_roles SET person_id=\$1/.test(duplicateAction)&&/UPDATE person_field_values SET person_id=\$1/.test(duplicateAction)&&/UPDATE person_segment_members SET person_id=\$1/.test(duplicateAction)&&/UPDATE aria_brain_feed SET person_id=\$1/.test(duplicateAction),'Duplicate merge must move non-colliding person memory instead of leaving it stranded on an archived record.');
assert(/\['aria_daily_queue_items','person_id'\]/.test(duplicateAction)&&/UPDATE \$\{table\} SET \$\{column\}=\$1 WHERE organization_id=\$3 AND \$\{column\}=\$2/.test(duplicateAction),'Active ARIA daily-queue items must follow the canonical person only within the current organization during a merge.');
assert(/UPDATE scan_review_items SET proposed_person_id=\$1/.test(duplicateAction),'Resolved scan-review pointers must follow the canonical person during a merge.');
assert(/identity_alias/.test(duplicateAction)&&/human_confirmed_merge/.test(duplicateAction)&&/person_aliases/.test(duplicateAction),'A confirmed merge must teach ARIA the duplicate name as a future identity alias.');
assert(/mergeAttendanceHistory/.test(duplicateAction)&&/mergeAttendanceContexts/.test(duplicateAction)&&/await mergeAttendanceContexts\(db,org,canonicalId,duplicateId\)/.test(duplicateAction)&&/mergeParticipationHistory/.test(duplicateAction)&&/mergeCurrentMemory/.test(duplicateAction),'Duplicate merge must reconcile attendance records, ARIA attendance context uniqueness, participation, and current person memory before identity collapse.');
assert(/people_intelligence/.test(duplicateAction)&&/aria_person_state/.test(duplicateAction),'Duplicate merge must explicitly reconcile current intelligence/state collisions rather than relying on a generic person_id move.');
assert(/allMergedPhoneValues=\[\.\.\.new Set\(\[\.\.\.phoneList\(canonical\),\.\.\.phoneList\(duplicate\)\]\)/.test(duplicateAction)&&/mergedPhones=\[\.\.\.allMergedPhoneValues\.filter\(value=>normalizePhone\(value\)\),\.\.\.allMergedPhoneValues\.filter\(value=>!normalizePhone\(value\)\)\]/.test(duplicateAction)&&/mergedPrimary=mergedPhones\.map\(normalizePhone\)\.find\(Boolean\)\|\|null/.test(duplicateAction)&&!mergedPhonesLimitHack(duplicateAction),'A merge must preserve compatible phone history, put valid numbers ahead of corrupt legacy text, and never write an invalid number as the canonical primary.');
assert(/function phoneList\(p\)\{const stored=Array\.isArray\(p\?\.phone_numbers\)\?p\.phone_numbers:\[\].*values=\[p\?\.phone,\.\.\.ordered/.test(duplicateAction),'Merge reconciliation must prefer the legacy primary phone and preserve ordered JSON alternates when phone_numbers is empty or populated.');
assert(/MERGE_VERIFICATION_FAILED/.test(duplicateAction)&&/record_verified:true/.test(duplicateAction),'The merge endpoint must verify the selected canonical survivor, archived duplicate, and phone preservation before reporting success.');

function mergedPhonesLimitHack(source){return /mergedPhones[^\n]*\.slice\(0,2\)/.test(source)}
assert(!/Some history could not be safely combined\. Nothing was changed\./.test(duplicateAction),'Merge implementation must not collapse distinct history conflicts into the old generic failure path.');
assert(/d\.role=c\.role/.test(duplicateAction)&&!/d\.role=c\.role AND d\.status=c\.status/.test(duplicateAction),'Role collision handling must respect the actual unique key and not incorrectly split by status.');
assert(/return_to=/.test(people),'People cards must preserve the source location.');
assert(navigationBack.includes('nyeocare:navigation-history:v1')&&navigationBack.includes('RESTORE_KEY')&&navigationBack.includes('scrollTo')&&!person.includes('onClick={goBack}'),'Person Journey must use shared history-aware back navigation with scroll restoration.');
assert(/WITH RECURSIVE merged_lineage/.test(journeyApi)&&/person_id IN\(SELECT person_id FROM merged_lineage\)/.test(journeyApi),'Person Journey must include immutable ARIA history from archived identities merged into the canonical person.');
assert(/date_of_birth_raw/.test(reviewApi)&&/birthday:/.test(reviewApi)&&/Not visible on this row/.test(review)&&/date_of_birth_evidence/.test(resolveApi),'Scan Review must retain the literal DOB and distinguish a blank source cell from an unverified date.');
assert(/birthday=COALESCE\(birthday,\$5::date\)/.test(vision)&&/date_of_birth_raw/.test(vision)&&/function parseBirthDate/.test(scanValidation),'Verified scan DOBs may fill an empty birthday but must not overwrite an existing birthday.');
console.log('[SCAN REVIEW] live refresh + navigation checks passed.');

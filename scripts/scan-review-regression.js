// scripts/scan-review-regression.js
import fs from'fs';
const read=p=>fs.readFileSync(p,'utf8');
const identity=read('lib/identityResolver.js');
const review=read('components/ReviewCenterTab.js');
const reviewApi=read('pages/api/review/index.js');
const resolveApi=read('pages/api/review/resolve.js');
const people=read('pages/people.js');
const vision=read('lib/visionProcessor.js');
const person=read('pages/person/[id].js');
const duplicateAction=read('pages/api/review/duplicate-action.js');
function assert(v,m){if(!v)throw new Error(m)}
assert(/Math\.round\(\(ns\+ps\.score\)\/2\)/.test(identity),'Identity resolver must use balanced 50/50 scoring.');
assert(/This is a different person/.test(review)&&/Use this person/.test(review)&&/Edit scanned record/.test(review),'Review Center must expose explicit human identity outcomes.');
assert(/name_match_but_phone_not_exact/.test(review)&&/Existing person ·/.test(review),'Review Center must explain name/phone disagreement and distinguish candidate phone from scanned phone.');
assert(/resolveIdentities/.test(reviewApi)&&/sanitizeReasons/.test(reviewApi)&&/phone_missing/.test(reviewApi),'Review API must refresh pending identity evidence using the canonical resolver and remove stale phone-missing claims when a scan actually has a phone.');
assert(/const needsIdentityReview=!decision\|\|decision\.status==='conflict'\|\|decision\.status==='needs_decision'/.test(vision),'Scan persistence must distinguish unresolved identity from field-level uncertainty.');
assert(/if\(decision\?\.status==='alive'&&decision\.best_candidate_id\)/.test(vision)&&/touchRecognizedPerson/.test(vision),'Strong existing identities must be persisted as recognized before any field review is created.');
assert(!/if\(needsIdentityReview\|\|fieldReasons\.length\)/.test(vision),'Field uncertainty must not demote an already-resolved identity into an identity review.');
assert(/keep_separate/.test(resolveApi)&&/identity_pair_decisions/.test(resolveApi),'Review resolve must persist keep-separate decisions.');
assert(/mergeLearningHistory/.test(duplicateAction)&&/mergeActionHistory/.test(duplicateAction)&&/mergeEventHistory/.test(duplicateAction)&&/mergeObservationHistory/.test(duplicateAction),'Duplicate merge must reconcile ARIA history before moving person references.');
assert(/mergePersonRelationships/.test(duplicateAction)&&/aria_person_state/.test(duplicateAction),'Duplicate merge must reconcile relationship and ARIA person-state uniqueness safely.');
assert(/identity_alias/.test(duplicateAction)&&/human_confirmed_merge/.test(duplicateAction)&&/person_aliases/.test(duplicateAction),'A confirmed merge must teach ARIA the duplicate name as a future identity alias.');
assert(!/Some history could not be safely combined\. Nothing was changed\./.test(duplicateAction),'Merge implementation must not collapse distinct history conflicts into the old generic failure path.');
assert(/return_to=/.test(people),'People cards must preserve the source location.');
assert(/safeReturnTo/.test(person)&&/window\.history\.length/.test(person),'Person Journey back navigation must use a safe explicit return destination with history fallback.');
console.log('[SCAN REVIEW] live refresh + navigation checks passed.');

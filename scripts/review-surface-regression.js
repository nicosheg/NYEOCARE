const assert=require('node:assert/strict');
const fs=require('node:fs');
const home=fs.readFileSync('pages/index.js','utf8');
const people=fs.readFileSync('pages/people.js','utf8');
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
assert.match(review,/Still in Review Center/,'the open detail must keep the pending queue visible');
assert.match(review,/scan review stays pending until the saved People record is verified/);
assert.match(review,/candidateId:\['approve','edit'\]\.includes\(action\)\?selected:null/,'editing a selected candidate must target that existing person');
assert.match(review,/save\(selected\?'edit':'separate'\)/,'editing must update a selected record, or explicitly create a new one');
assert.match(review,/result\?\.persisted!==true/,'the UI must require a verified persistence response before clearing a review');
assert.match(review,/if\(!silent\)setLoading\(false\)/,'silent refresh must not temporarily blank the queue');

assert.match(reviewResolve,/import\{resolveIdentities\}from'\.\.\/\.\.\/\.\.\/lib\/identityResolver'/,'fresh candidates from Review Center must be revalidated server-side before editing');
assert.match(reviewResolve,/freshAllowed\.includes\(selected\)/,'a fresh candidate can be edited only if current server-side identity matching confirms it');
assert.match(reviewResolve,/REVIEW_CANDIDATES_UNAVAILABLE/,'candidate verification failure must keep the review pending');
assert.match(reviewResolve,/REVIEW_CANDIDATE_STALE/,'stale edit targets must not silently turn into person creation');
assert.match(reviewResolve,/REVIEW_PERSISTENCE_VERIFICATION_FAILED/);
assert.match(reviewResolve,/const savedResult=await db\.query/);
assert.match(reviewResolve,/persisted\.identity_verification_status/);
assert.match(reviewResolve,/record_persisted:true,record_verified:true/);
assert.match(reviewResolve,/WHERE id=\$1 AND organization_id=\$5 AND status='pending' RETURNING id,status/);
assert.match(reviewResolve,/identity_verification_status,identity_verified_at,identity_verified_by,identity_verification_source/);
assert.match(reviewResolve,/review_status:'resolved'.*persisted:true/s);
console.log('NYEOCARE review queue persistence and edit-verification regression checks passed.');

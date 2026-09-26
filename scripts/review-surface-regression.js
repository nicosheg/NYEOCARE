function curReviewCenter(source){return source;}
const assert=require('node:assert/strict');
const fs=require('node:fs');
const home=fs.readFileSync('pages/index.js','utf8');
const people=fs.readFileSync('pages/people.js','utf8');
const config=fs.readFileSync('next.config.js','utf8');

assert.match(home,/const ReviewCenterTab=dynamic\(\(\)=>import\('\.\.\/components\/ReviewCenterTab'\)/);
assert.equal((home.match(/<ReviewCenterTab/g)||[]).length,1);
assert.match(curReviewCenter(home),/activeGroup/);
assert.match(people,/import ReviewCenterTab from'\.\.\/components\/ReviewCenterTab';/);
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

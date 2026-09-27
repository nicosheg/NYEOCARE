// scripts/experience-contract-regression.js
// Fast architectural sweep for user-facing reliability hazards.
import{readdirSync,readFileSync}from'node:fs';
import{join}from'node:path';

const read=p=>readFileSync(p,'utf8');
const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(x=>{
 const p=join(dir,x.name);
 return x.isDirectory()?walk(p):x.isFile()&&x.name.endsWith('.js')?[p]:[];
});

const apiFiles=walk('pages/api');
const hazards=[];
for(const file of apiFiles){
 const source=read(file);
 if(!source.includes('pool.connect()')||!source.includes('COMMIT'))continue;
 const commit=source.indexOf('COMMIT');
 const release=source.indexOf('db.release()',commit);
 const boundary=release>=0?release:source.length;
 const postCommit=source.slice(commit,boundary);
 if(/await\s+(?:pool\.)?query\(/.test(postCommit)||
    /await\s+(?:updateEngagementMetricsForPerson|computeRelationshipScore|updatePeopleIntelligence|updatePersonState|createCareDraft|generateText)\s*\(/.test(postCommit)){
  hazards.push(file);
 }
}

const correction=read('pages/api/attendance/aria-correction.js');
const home=read('pages/index.js');
const close=read('pages/api/attendance/close-session.js');
const queue=read('lib/aria/attendanceQueue.js');

const checks=[
 ['No transactional API keeps a serverless DB connection while doing post-commit database/AI work',hazards.length===0],
 ['Tell ARIA attendance correction commits the human fact and queues derived work',/enqueueAttendanceProcessing/.test(correction)&&/await db\.query\('COMMIT'\)/.test(correction)&&/processing_pending:true/.test(correction)],
 ['Tell ARIA attendance correction does not call slow intelligence in the request path',!/createCareDraft/.test(correction)&&!/generateText/.test(correction)&&!/updateEngagementMetricsForPerson/.test(correction)&&!/computeRelationshipScore/.test(correction)&&!/updatePeopleIntelligence/.test(correction)&&!/updatePersonState/.test(correction)],
 ['Attendance close uses the same durable queue boundary',/enqueueAttendanceProcessing/.test(close)&&/processing_pending:true/.test(close)&&/db:client/.test(close)],
 ['Attendance queue is the canonical background boundary',/nyeocare-attendance/.test(queue)&&/pgmq\.send/.test(queue)],
 ['Home handles background correction state without waiting for a draft',/\/api\/attendance\/aria-correction/.test(home)&&/d\.processing_pending/.test(home)]
];

const failures=checks.filter(([,ok])=>!ok).map(([name])=>name);
if(failures.length){
 console.error('[EXPERIENCE CONTRACT] FAILED');
 if(hazards.length)console.error('Post-commit connection hazards:',hazards.join(', '));
 console.error(failures.join(' | '));
 process.exit(1);
}
console.log('[EXPERIENCE CONTRACT] Fast reliability sweep passed.');

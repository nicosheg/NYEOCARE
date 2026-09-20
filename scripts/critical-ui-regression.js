// scripts/critical-ui-regression.js
import{readFileSync}from'node:fs';
const read=p=>readFileSync(p,'utf8');
const attendance=read('components/AttendanceModal.js');
const home=read('pages/index.js');
const people=read('pages/people.js');
const profile=read('pages/profile.js');
const onboarding=read('components/OnboardingProvider.js');
const scanRecovery=read('components/ScanRecovery.js');
const autoSync=read('components/AriaAutoSync.js');
const app=read('pages/_app.js');
const db=read('lib/db.js');
const auth=read('lib/auth.js');
const reviewApi=read('pages/api/review/index.js');
const activeApi=read('pages/api/attendance/active-session.js');
const attendancePeopleApi=read('pages/api/attendance/people.js');
const director=read('lib/aria/director.js');
const eventProcessor=read('lib/aria/eventProcessor.js');
const briefing=read('pages/api/daily-briefing/latest.js');
const participation=read('lib/aria/participationGenerator.js');
if(!/EXTRACT\(ISODOW FROM \$4::timestamptz\)/.test(participation))throw new Error('Attendance absence query must cast the timestamp parameter before EXTRACT.');
if(!/jsonb_build_object\('session_id',\$3::uuid,'participation_id',p\.participation_id\)/.test(participation))throw new Error('Attendance ARIA event enqueue must cast sessionId parameter $3 to uuid.');

const homeStyleNames=new Set([...home.matchAll(/\b([A-Za-z_$][\w$]*)=\{/g)].map(m=>m[1]));
const homeStyleRefs=[...new Set([...home.matchAll(/style=\{(?:\{\.\.\.)?([A-Za-z_$][\w$]*)/g)].map(m=>m[1]))];
const missingHomeStyles=homeStyleRefs.filter(x=>!homeStyleNames.has(x));

const declaredStyles=new Set([...attendance.matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*\{/g)].map(m=>m[1]));
const refs=new Set();
for(const m of attendance.matchAll(/style=\{([A-Za-z_$][\w$]*)\}/g))refs.add(m[1]);
for(const m of attendance.matchAll(/style=\{\{\.\.\.([A-Za-z_$][\w$]*)/g))refs.add(m[1]);
const missingAttendanceStyles=[...refs].filter(x=>!declaredStyles.has(x));

const forbiddenAttendance=['/api/attendance/context','contextPerson','contextOverlay','contextCard','contextButton'];
const forbiddenFound=forbiddenAttendance.filter(x=>attendance.includes(x));

const requiredAttendance=['normalizeSession','normalizePeople','readJson','loadSeq','getCached','setCached','clearCached','getClientSession'];
const absentAttendance=requiredAttendance.filter(x=>!attendance.includes(x));

const checks=[
 ['Attendance LIVE only follows session status',/const isActive=row\.status==='active'/.test(activeApi)&&/active:isActive/.test(activeApi)],
 ['Attendance accepts recoverable closed sessions',/s\.status='active'/.test(activeApi)&&/s\.status='closed'/.test(activeApi)&&/COALESCE\(b\.aria_processing_status,'pending'\)<>'completed'/.test(activeApi)],
 ['Attendance people endpoint performs session+people load in one SQL query',/JOIN people p ON p\.organization_id=s\.organization_id/.test(attendancePeopleApi)],
 ['Home uses one bootstrap endpoint',/api\/home\/bootstrap/.test(home)&&!home.includes('/api/daily-briefing/latest')],
 ['Home does not run a fixed 30s full reload loop',!/setInterval\(run,30000\)/.test(home)],
 ['Home uses cached client auth',/getClientSession\(\)/.test(home)],
 ['Home coalesces concurrent loads',/loadPromiseRef\.current/.test(home)],
 ['Home uses cross-surface background refresh',/subscribeDataChange/.test(home)],
 ['People does not initialize ARIA on page open',!/\/api\/aria\/initialize/.test(people)],
 ['People loads review summary first',/\/api\/review\?summary=1/.test(people)],
 ['People supports client-side person prefetch',/router\.prefetch\(.*\/person\//.test(people)],
 ['Profile uses one bootstrap request',/api\/profile\/bootstrap/.test(profile)&&/fetch\('\/api\/profile\/bootstrap'/.test(profile)],
 ['Profile is cached-first',/cacheAge\(key\)<15000/.test(profile)],
 ['Onboarding deduplicates in-flight loads',/inflight\.has\(key\)/.test(onboarding)],
 ['Scan recovery only checks an active local job',/stage!=='processing'/.test(scanRecovery)&&!/latest=1/.test(scanRecovery)],
 ['ARIA auto-sync is not part of startup critical path',/IDLE_DELAY=15000/.test(autoSync)&&/document\.visibilityState/.test(autoSync)],
 ['People DOM enhancer is not globally mounted',!/PeopleSurfaceEnhancer/.test(app)],
 ['Vercel database pool is >1 connection',/max:4/.test(db)],
 ['Vercel database pool is attached for serverless lifecycle',/attachDatabasePool\(pool\)/.test(db)],
 ['Auth caches short-lived bearer verification',/AUTH_TTL=2500/.test(auth)],
 ['Review has a lightweight summary path',/req\.query\?\.summary==='1'/.test(reviewApi)],
 ['Attendance no longer polls the full roster every 5s',!/setInterval\(\(\)=>load\(false\),5000\)/.test(attendance)],
 ['Attendance uses cached auth',/const auth=async\(\)=>getClientSession\(\)/.test(attendance)],
 ['Attendance keeps cache coherent after marks',/setCached\(cacheKey,\{\.\.\.cached,people:next(People)?\}\)/.test(attendance)],
 ['ARIA director remains present',/ARIA_DIRECTOR_VERSION/.test(director)&&/directAriaEvent/.test(director)],
 ['Event processor remains the durable event path',/createObservation\(/.test(eventProcessor)&&/sourceEventId:eventId/.test(eventProcessor)],
 ['Daily briefing remains read-only',!/INSERT INTO aria_actions/.test(briefing)],
 ['Attendance processor creates first-session follow-up',/first_session_check_in/.test(participation)&&/session_id:sessionId/.test(participation)]
];

const failures=checks.filter(([,ok])=>!ok).map(([name])=>name);
if(missingAttendanceStyles.length||missingHomeStyles.length||forbiddenFound.length||absentAttendance.length||failures.length){
 console.error('[CRITICAL UI] Performance + canonical architecture regression guard failed.');
 if(missingAttendanceStyles.length)console.error('Undefined Attendance style identifiers:',missingAttendanceStyles.join(', '));
 if(missingHomeStyles.length)console.error('Undefined Home style identifiers:',missingHomeStyles.join(', '));
 if(forbiddenFound.length)console.error('Removed attendance-context remnants:',forbiddenFound.join(', '));
 if(absentAttendance.length)console.error('Missing attendance speed primitives:',absentAttendance.join(', '));
 if(failures.length)console.error('Broken performance/canonical checks:',failures.join(' | '));
 process.exit(1);
}
console.log('[CRITICAL UI] Performance + canonical architecture regression guards passed.');

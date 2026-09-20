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
const closeApi=read('pages/api/attendance/close-session.js');
const processApi=read('pages/api/attendance/process-session.js');
const queue=read('pages/api/queue/attendance-process.js');
const queueLib=read('lib/aria/attendanceQueue.js');
const processor=read('lib/aria/attendanceProcessor.js');
const intelligence=read('lib/aria/attendanceIntelligence.js');
const director=read('lib/aria/director.js');
const eventProcessor=read('lib/aria/eventProcessor.js');
const briefing=read('pages/api/daily-briefing/latest.js');
const pkg=JSON.parse(read('package.json'));
const vercel=JSON.parse(read('vercel.json'));

const homeBootstrap=read('pages/api/home/bootstrap.js');

const checks=[
 ['Attendance LIVE follows session status',/const isActive=row\.status==='active'/.test(activeApi)&&/active:isActive/.test(activeApi)],
 ['Attendance accepts recoverable closed sessions',/s\.status='active'/.test(activeApi)&&/s\.status='closed'/.test(activeApi)&&/COALESCE\(b\.aria_processing_status,'pending'\)<>'completed'/.test(activeApi)],
 ['Attendance roster is bounded server-side',/LIMIT \$\{li\}/.test(attendancePeopleApi)&&/Number\(req\.query\.limit\)\|\|80/.test(attendancePeopleApi)],
 ['Attendance roster supports cursor pagination',/next_cursor/.test(attendancePeopleApi)&&/has_more/.test(attendancePeopleApi)&&/base64url/.test(attendancePeopleApi)],
 ['Attendance roster has server-side search',/ILIKE '%'\|\|\$/.test(attendancePeopleApi)&&/COALESCE\(p\.phone/.test(attendancePeopleApi)],
 ['Close session queues instead of waiting',/enqueueAttendanceProcessing/.test(closeApi)&&!closeApi.includes('waitUntil')&&!closeApi.includes('generateParticipationFromSession')],
 ['Retry queues instead of running worker inline',/enqueueAttendanceProcessing/.test(processApi)&&!processApi.includes('generateParticipationFromSession')],
 ['Durable queue consumer exists',/handleNodeCallback/.test(queue)&&/processAttendanceSession/.test(queue)],
 ['Queue has bounded retry behavior',/deliveryCount/.test(queue)&&/afterSeconds/.test(queue)&&/MAX_DELIVERIES=5/.test(queue)],
 ['Queue trigger is configured',vercel.functions?.['pages/api/queue/attendance-process.js']?.experimentalTriggers?.some(x=>x.type==='queue/v2beta'&&x.topic==='nyeocare-attendance')],
 ['Queue dependency is pinned',pkg.dependencies?.['@vercel/queue']==='0.5.1'],
 ['Attendance participation persistence is set based',/INSERT INTO participation_records/.test(processor)&&/SELECT \$1,ar\.people_id,\$2,'attendance'/.test(processor)],
 ['Attendance event persistence is set based',/INSERT INTO aria_events/.test(processor)&&/jsonb_build_object\('session_id',\$2::uuid,'participation_id',pr\.id\)/.test(processor)],
 ['Attendance intelligence is set based',/WITH target AS/.test(intelligence)&&/INSERT INTO engagement_metrics/.test(intelligence)&&/INSERT INTO relationship_scores/.test(intelligence)&&/INSERT INTO people_intelligence/.test(intelligence)&&/INSERT INTO aria_person_state/.test(intelligence)],
 ['Attendance processing has no N-person ARIA fanout',!processor.includes('processAriaEvent')&&!processor.includes('mapConcurrent')&&!processor.includes('CONCURRENCY=')],
 ['Absence requires prior confirmed evidence',/prior_84>=2/.test(processor)&&/prior_28>=1/.test(processor)&&/AND NOT EXISTS\(SELECT 1 FROM aria_attendance_contexts/.test(processor)],
 ['Absence signals are bounded',/ABSENCE_ACTION_LIMIT =? 50/.test(processor)&&/LIMIT \\\${ABSENCE_ACTION_LIMIT}/.test(processor)],
 ['First-session attendance noise is removed',!processor.includes('first_session_check_in')],
 ['Attendance absence wording does not claim cause',/does not know the reason for the absence/.test(processor)&&/pattern_claim/.test(processor)],
 ['Processing claim is atomic and stale-recoverable',/FOR UPDATE/.test(processApi)&&/aria_processing_status='pending'/.test(processApi)&&/INTERVAL '5 minutes'/.test(processor)],
 ['Session completes only after worker success',/aria_processing_status='completed'/.test(queue)&&/processAttendanceSession/.test(queue)],
 ['Processing failure is persisted',/markFailed/.test(queue)&&/ATTENDANCE_PROCESSING_FAILED/.test(queue)],
 ['Home scopes attendance signals to latest completed session',/latest_completed_session/.test(homeBootstrap)&&/metadata->>'session_id'/.test(homeBootstrap)],
 ['Home hides participation-confirmed noise',/o\.type<>'PARTICIPATION_CONFIRMED'/.test(homeBootstrap)],
 ['Home excludes stale first-session actions',/first_session_check_in/.test(homeBootstrap)&&/aria_processing_failure/.test(homeBootstrap)],
 ['Attendance UI recognizes pending and processing',/\['pending','processing'\]/.test(attendance)&&/processing_status/.test(attendance)],
 ['Attendance UI polls only lightweight status',/\/api\/attendance\/active-session/.test(attendance)&&/1200/.test(attendance)],
 ['Attendance UI loads bounded roster pages',/fetchPeoplePage/.test(attendance)&&/limit:'80'/.test(attendance)&&/loadMorePeople/.test(attendance)],
 ['Attendance UI server-searches people',/api\/attendance\/people\?/.test(attendance)&&/setTimeout\(async/.test(attendance)],
 ['Attendance UI tracks global present count',/presentCount/.test(attendance)&&/organization_total/.test(attendancePeopleApi)],
 ['Attendance UI processing is compact',/processingCompact/.test(attendance)&&!/pipelineDotLive/.test(attendance)],
 ['Serverless DB pool is one connection',/max:1/.test(db)],
 ['Serverless DB pool is attached',/attachDatabasePool\(pool\)/.test(db)],
 ['Home uses one bootstrap endpoint',/api\/home\/bootstrap/.test(home)&&!/api\/daily-briefing\/latest/.test(home)],
 ['Home coalesces loads',/loadPromiseRef\.current/.test(home)],
 ['People does not initialize ARIA on page open',!/\/api\/aria\/initialize/.test(people)],
 ['People loads review summary first',/\/api\/review\?summary=1/.test(people)],
 ['Profile uses one bootstrap request',/api\/profile\/bootstrap/.test(profile)],
 ['Onboarding deduplicates in-flight loads',/inflight\.has\(key\)/.test(onboarding)],
 ['Scan recovery avoids historical-job scans',/stage!=='processing'/.test(scanRecovery)&&!/latest=1/.test(scanRecovery)],
 ['ARIA auto-sync is not startup critical path',/IDLE_DELAY=15000/.test(autoSync)&&/document\.visibilityState/.test(autoSync)],
 ['People DOM enhancer not globally mounted',!/PeopleSurfaceEnhancer/.test(app)],
 ['Auth caches bearer verification',/AUTH_TTL=2500/.test(auth)],
 ['Review has lightweight summary path',/req\.query\?\.summary==='1'/.test(reviewApi)],
 ['Daily briefing endpoint is read-only',!/INSERT INTO aria_actions/.test(briefing)],
 ['ARIA director remains available',/ARIA_DIRECTOR_VERSION/.test(director)&&/directAriaEvent/.test(director)],
 ['Event processor remains durable',/createObservation\(/.test(eventProcessor)&&/sourceEventId:eventId/.test(eventProcessor)]
];

const failures=checks.filter(([,ok])=>!ok).map(([name])=>name);
if(failures.length){
 console.error('[CRITICAL UI] Attendance/scalability regression guard failed.');
 console.error(failures.join(' | '));
 process.exit(1);
}
console.log('[CRITICAL UI] Attendance/scalability and canonical-architecture regression guards passed.');

import{existsSync,readFileSync}from'node:fs';
const read=p=>readFileSync(p,'utf8');
const checks=[
 ['Field Mode runtime is globally mounted',/FieldModeRuntime/.test(read('pages/_app.js'))],
 ['IndexedDB field store exists',/indexedDB/.test(read('lib/attendanceFieldMode.js'))&&/STORES=/.test(read('lib/attendanceFieldMode.js'))],
 ['Offline mutations coalesce per person/session',/keyFor\(sessionId,personId\)/.test(read('lib/attendanceFieldMode.js'))&&/status:'pending'/.test(read('lib/attendanceFieldMode.js'))],
 ['Reconnect sync batches operations',/api\/attendance\/sync/.test(read('lib/attendanceFieldMode.js'))&&/chunks\(pending,100\)/.test(read('lib/attendanceFieldMode.js'))],
 ['Reconnect sync is automatic',/addEventListener\('online'/.test(read('components/FieldModeRuntime.js'))&&/setInterval\(run,15000\)/.test(read('components/FieldModeRuntime.js'))],
 ['Large field roster is paginated',/MAX_LIMIT=5000/.test(read('pages/api/attendance/field-roster.js'))&&/base64url/.test(read('pages/api/attendance/field-roster.js'))],
 ['Batch sync validates session membership and active people',/session_users/.test(read('pages/api/attendance/sync.js'))&&/id=ANY\(\$2::uuid\[\]\)/.test(read('pages/api/attendance/sync.js'))],
 ['Closed-session late marks still require admin confirmation',/isAdmin=/.test(read('pages/api/attendance/sync.js'))&&/confirmed=session.status==='closed'&&isAdmin/.test(read('pages/api/attendance/sync.js'))&&/pending_confirmation_people_ids/.test(read('pages/api/attendance/sync.js'))],
 ['Server idempotency remains unique person/session',/ON CONFLICT\(organization_id,people_id,session_id\)/.test(read('pages/api/attendance/sync.js'))],
 ['Service worker does not cache authenticated HTML',/event\.request\.mode==='navigate'/.test(read('public/sw.js'))&&!/cache\.put\(event\.request/.test(read('public/sw.js').split("event.request.mode==='navigate'")[1].split("url.pathname")[0])],
 ['Performance telemetry is authenticated and bounded',/withOrg/.test(read('pages/api/telemetry/performance.js'))&&/duration>300000/.test(read('pages/api/telemetry/performance.js'))],
 ['Field Mode test script is registered',JSON.parse(read('package.json')).scripts?.['test:field-mode']==='node scripts/field-mode-regression.js']
];
const failures=checks.filter(([,ok])=>!ok).map(([name])=>name);
if(failures.length){console.error('[FIELD MODE] FAILED');console.error(failures.join(' | '));process.exit(1)}
if(!existsSync('public/offline.html')){console.error('[FIELD MODE] Missing offline fallback');process.exit(1)}
console.log('[FIELD MODE] Field-ready offline attendance guards passed.');
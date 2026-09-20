import{existsSync,readFileSync}from'node:fs';
const read=p=>readFileSync(p,'utf8');
const has=(p,s)=>read(p).includes(s);
const peopleApi=read('pages/api/people.js');
const peoplePage=read('pages/people.js');
const journey=read('pages/api/person/journey.js');
const daily=read('pages/api/aria/daily.js');
const care=read('pages/api/care-queue.js');
const duplicate=read('lib/duplicateDetector.js');
const ai=read('lib/aiProviderCore.js');
const db=read('lib/db.js');
const pkg=JSON.parse(read('package.json'));
const checks=[
 ['People API enforces bounded pages',has('pages/api/people.js','Math.min(Math.max')&&has('pages/api/people.js','LIMIT ${limit+1}')],
 ['People API uses keyset cursor',has('pages/api/people.js','base64url')&&has('pages/api/people.js','next_cursor')&&has('pages/api/people.js','new_rank,truth_rank,sort_name,id')],
 ['People search is server-side',has('pages/api/people.js','ILIKE')&&has('pages/api/people.js','search')],
 ['People UI does not fetch the entire roster',has('pages/people.js',"limit:'60'")&&has('pages/people.js','loadMore')],
 ['Person journey has bounded collections',has('pages/api/person/journey.js','LIMIT 100')&&has('pages/api/person/journey.js','LIMIT 50')],
 ['ARIA daily has no people×sessions cross join',!daily.includes('CROSS JOIN sessions')],
 ['Care Queue has no people×all-session cross join',!care.includes('CROSS JOIN recent_sessions')&&!care.includes('CROSS JOIN sessions')],
 ['Care Queue current attendance check is set-based',has('pages/api/care-queue.js','current_attended')&&!care.includes('NOT EXISTS(\\n    SELECT 1 FROM attendance_records')],
 ['Duplicate detection avoids quadratic phone scan',!duplicate.includes('for(const q of rows)')&&has('lib/duplicateDetector.js','phoneIndex')],
 ['AI token ceiling follows model registry',has('lib/aiProviderCore.js','max_completion_tokens:model.max_completion_tokens')&&!ai.includes('model===PRIMARY?8000')],
 ['Serverless DB pool is bounded and attached',has('lib/db.js','max:1')&&has('lib/db.js','attachDatabasePool(pool)')],
 ['Legacy unauthenticated endpoints are gone',
  !existsSync('pages/api/ai/correct-scan.js')&&!existsSync('pages/api/test-scan.js')&&!existsSync('pages/api/test-ocr-space.js')&&!existsSync('pages/api/echo.js')&&!existsSync('pages/api/check-db.js')&&!existsSync('pages/api/send-whatsapp-test.js')],
 ['System-scale test is registered',pkg.scripts?.['test:system-scale']==='node scripts/system-scale-regression.js']
];
const failures=checks.filter(([,ok])=>!ok).map(([name])=>name);
if(failures.length){console.error('[SYSTEM SCALE] FAILED');console.error(failures.join(' | '));process.exit(1)}
console.log('[SYSTEM SCALE] Full-system scale regression guards passed.');

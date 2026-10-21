// scripts/scan-regression.js
import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5432/test';
const{validateScanOutput,fuzzyMatch,normalizeName}=await import('../lib/scanValidation.js');const{resolveIdentities}=await import('../lib/identityResolver.js');const{nameSimilarity}=await import('../lib/duplicateDetector.js');
const{getScanProgressPercent}=await import('../lib/scanProgress.js');
const{parseRetryAfterSeconds,parseDurationSeconds,getRateLimitRetrySeconds}=await import('../lib/scanRateLimit.js');
const{mergeScanRegions}=await import('../lib/scanRegionMerge.js');
const{normalizeScanFailureStage,persistScanFailure,recordScanFailureAndAlert,sendScanFailureAlert}=await import('../lib/scanFailure.js');
const admissionSource=readFileSync(new URL('../pages/api/scan/admission.js',import.meta.url),'utf8');
const hybridSource=readFileSync(new URL('../lib/hybridScanProvider.js',import.meta.url),'utf8');
const statusSource=readFileSync(new URL('../pages/api/scan/status.js',import.meta.url),'utf8');
const progressUiSource=readFileSync(new URL('../components/AriaProcessingStatus.js',import.meta.url),'utf8');
const scanModalSource=readFileSync(new URL('../components/ScanModal.js',import.meta.url),'utf8');
const scanStartSource=readFileSync(new URL('../pages/api/scan/start.js',import.meta.url),'utf8');
const scanStartMigrationSource=readFileSync(new URL('../supabase/migrations/20261021153000_scan_start_request_idempotency.sql',import.meta.url),'utf8');
const phone=n=>({normalized:n}),base={type:'person',status:'active',metadata:{identity_verified:true},living_truth:{status:'alive'},identity_verification_status:'verified'};
function clientFor(people){return{async query(sql){if(/FROM people WHERE organization_id/.test(sql))return{rows:people};if(/FROM person_aliases/.test(sql))return{rows:[]};if(/FROM identity_shared_contacts/.test(sql))return{rows:[]};if(/FROM identity_pair_decisions/.test(sql))return{rows:[]};throw new Error(`Unexpected SQL in regression client: ${sql.slice(0,80)}`)}}}
test('single-page validation preserves continuation ownership',()=>{const v=validateScanOutput(JSON.stringify({people:[{r:1,y:100,x:100,n:'Sandra Isichei',p:['08039579786'],nc:98,pc:96,rc:95,ns:'clear',ps:'clear',rs:'clear',f:[],na:[],e:'row 1'},{r:1,y:130,x:120,n:'',p:['08183488629'],nc:98,pc:90,rc:92,ns:'clear',ps:'clear',rs:'clear',f:[],na:[],e:'continuation'}]}));assert.equal(v.valid,true);assert.equal(v.people.length,1);assert.deepEqual(v.people[0].phones,['+2348039579786','+2348183488629'])});
test('Nigerian 020 number is flagged, never silently rewritten',()=>{const v=validateScanOutput(JSON.stringify({people:[{r:1,y:100,x:100,n:'Test Person',p:['02066139143'],nc:98,pc:98,rc:95,ns:'clear',ps:'clear',rs:'clear',f:[],na:[],e:'row'}]}));assert.equal(v.valid,true);assert(v.needsReview[0].reasons.includes('phone_number_not_safely_validated'));assert.equal(v.people[0].phones[0],'+2342066139143')});
test('duplicate exact observation inside one scan is rejected',()=>{const row={r:1,y:100,x:100,n:'Grace Nwosu',p:['08012345678'],nc:99,pc:99,rc:99,ns:'clear',ps:'clear',rs:'clear',f:[],na:[],e:'row'};const second={...row,r:2,y:200};const v=validateScanOutput(JSON.stringify({people:[row,second]}));assert.equal(v.people.length,1);assert.equal(v.rejected[0].reason,'duplicate_identity_in_scan')});
test('70–80% name similarity remains detectable',()=>{const a='Wheen Nwapa',b='Wuean Nwapa',f=fuzzyMatch(a,b),d=nameSimilarity(a,b);assert(f>=.7);assert(d.score>=70&&d.score<96)});
test('exact existing identity remains recognized even when one extracted field needs review',async()=>{const existing={...base,id:'11111111-1111-1111-1111-111111111111',first_name:'Precious',last_name:'Okafor',display_name:'Sis Precious Okafor',phone:'+2348035230123',phone_numbers:[phone('+2348035230123')]};const input=[{row_number:9,name:'Sis Precious Okafor',first_name:'Precious',last_name:'Okafor',phones:['+2348035230123'],rawPhones:['08035230123'],extraction_review_reasons:['name_evidence_ambiguous']}];const out=await resolveIdentities(input,'org-test','job-test',clientFor([existing]));assert.equal(out[0].status,'alive');assert.equal(out[0].best_candidate_id,existing.id);assert(out[0].field_review_reasons.includes('name_evidence_ambiguous'))});
test('two exact same-name owners do not auto-merge',async()=>{const a={...base,id:'11111111-1111-1111-1111-111111111111',display_name:'John Okafor',first_name:'John',last_name:'Okafor',phone_numbers:[phone('+2348011111111')]},b={...base,id:'22222222-2222-2222-2222-222222222222',display_name:'John Okafor',first_name:'John',last_name:'Okafor',phone_numbers:[phone('+2348022222222')]};const out=await resolveIdentities([{row_number:1,name:'John Okafor',phones:[],extraction_review_reasons:[]}],'org-test','job-test',clientFor([a,b]));assert.equal(out[0].status,'conflict');assert.equal(out[0].best_candidate_id,null)});

test('literal honorific and spelling are preserved for display while identity matching may normalize them',()=>{const v=validateScanOutput(JSON.stringify({people:[{r:1,y:100,x:100,n:'Sis. Joy Grace',p:['08012345678'],nc:99,pc:99,rc:99,ns:'clear',ps:'clear',rs:'clear',f:[],na:[],e:'row'}]}));assert.equal(v.valid,true);assert.equal(v.people[0].name,'Sis. Joy Grace');assert.equal(v.people[0].display_name,'Sis. Joy Grace');assert.equal(v.people[0].raw_name,'Sis. Joy Grace');assert.equal(v.people[0].honorific,'Sis.');assert.equal(normalizeName(v.people[0].name),'joy grace')});
test('visible complete Nigerian-register DOB is extracted without inventing or reformating the raw evidence',()=>{const v=validateScanOutput(JSON.stringify({people:[{r:1,y:100,x:100,n:'Mummy Christiana',p:['08012345678'],dob:'23/04/1998',nc:99,pc:99,rc:99,ns:'clear',ps:'clear',rs:'clear',f:[],na:[],e:'name, phone, DOB on the same row'}]}));assert.equal(v.valid,true);assert.equal(v.people[0].name,'Mummy Christiana');assert.equal(v.people[0].date_of_birth_raw,'23/04/1998');assert.equal(v.people[0].birthday,'1998-04-23');assert.equal(v.people[0].date_of_birth_evidence,'clear');assert(!v.people[0].extraction_review_reasons.includes('date_of_birth_needs_verification'))});
test('missing DOB remains absent and does not get inferred',()=>{const v=validateScanOutput(JSON.stringify({people:[{r:1,y:100,x:100,n:'Bro John',p:['08012345678'],nc:99,pc:99,rc:99,ns:'clear',ps:'clear',rs:'clear',f:[],na:[],e:'name and phone row'}]}));assert.equal(v.valid,true);assert.equal(v.people[0].date_of_birth_raw,null);assert.equal(v.people[0].birthday,null);assert.equal(v.people[0].date_of_birth_evidence,null);assert(!v.people[0].extraction_review_reasons.includes('date_of_birth_needs_verification'))});
test('ambiguous or incomplete DOB is kept as raw evidence, not saved as a guessed date',()=>{const v=validateScanOutput(JSON.stringify({people:[{r:1,y:100,x:100,n:'Rev John',p:['08012345678'],dob:'23/04',nc:99,pc:99,rc:99,ns:'clear',ps:'clear',rs:'clear',f:[],na:[],e:'partial date'}]}));assert.equal(v.valid,true);assert.equal(v.people[0].date_of_birth_raw,'23/04');assert.equal(v.people[0].birthday,null);assert.equal(v.people[0].date_of_birth_evidence,'ambiguous');assert(v.people[0].extraction_review_reasons.includes('date_of_birth_needs_verification'));assert(v.needsReview.some(x=>x.reasons.includes('date_of_birth_needs_verification')))});
test('a row without a visible phone remains in Review even when its name is clear',()=>{const v=validateScanOutput(JSON.stringify({people:[{r:1,y:100,x:100,n:'Sister Joy Grace',p:[],dob:'',nc:99,ns:'clear',ps:'clear',rs:'clear',f:[],na:[],e:'name only'}]}));assert.equal(v.valid,true);assert.equal(v.people.length,1);assert.equal(v.people[0].name,'Sister Joy Grace');assert(v.people[0].extraction_review_reasons.includes('phone_missing'));assert(v.needsReview.some(x=>x.reasons.includes('phone_missing')))});
console.log('NYEOCARE scan regression suite ready.');

test('scan progress percentage follows backend milestones and completed image sections',()=>{
 assert.equal(getScanProgressPercent('pending','queued',{}),0);
 assert.equal(getScanProgressPercent('processing','preparing_image',{}),4);
 assert.equal(getScanProgressPercent('processing','understanding_page',{}),10);
 assert.equal(getScanProgressPercent('processing','reading_overlapping_regions',{regions_total:2,regions_completed:0}),15);
 assert.equal(getScanProgressPercent('processing','reading_overlapping_regions',{regions_total:2,regions_completed:1}),40);
 assert.equal(getScanProgressPercent('processing','reading_overlapping_regions',{regions_total:2,regions_completed:2}),65);
 assert.equal(getScanProgressPercent('processing','validating_extraction',{}),75);
 assert.equal(getScanProgressPercent('processing','resolving_identity',{}),85);
 assert.equal(getScanProgressPercent('processing','saving_truth',{}),95);
 assert.equal(getScanProgressPercent('failed','reading_overlapping_regions',{regions_total:2,regions_completed:1}),40);
 assert.equal(getScanProgressPercent('cancelled','saving_truth',{}),95);
 assert.equal(getScanProgressPercent('failed','failed',{}),0);
 assert.equal(getScanProgressPercent('complete','complete',{}),100);
});
test('scan vision remains pinned to Groq Qwen 3.8 with no alternate vision provider or deprecated Qwen fallback',()=>{
 assert.ok(hybridSource.includes("const PRIMARY_KEY='groq-qwen3.8-27b'"));
 for(const forbidden of ['GEMINI','gemini','FALLBACK','qwen3.6-27b'])assert.equal(hybridSource.includes(forbidden),false,`Unexpected alternate scan vision path: ${forbidden}`);
 assert.ok(hybridSource.includes('async function readRegion(region,opt)'));
 assert.ok(hybridSource.includes('callOne(region,PRIMARY,opt,attempt,jsonFallbackUsed)'));
 assert.ok(hybridSource.includes('rateLimitRetries<2'));
 assert.ok(hybridSource.includes('jsonFallbackUsed'));
});
test('scan uses one full-page region and publishes fresh backend heartbeats',()=>{
 assert.ok(hybridSource.includes('for(let i=0;i<regions.length;i++)'));
 assert.ok(hybridSource.includes('return[{id:1,y0:0,y1:H,w:W,h:H,data:page.base64}]'));
 assert.ok(hybridSource.includes('provider:PRIMARY.provider,regions:1,reasoning:\'none\''));
 assert.equal(hybridSource.includes('Promise.all(regions.map'),false);
 assert.ok(hybridSource.includes('setInterval(()=>{if(activeRegion)report(stage'));
 assert.ok(hybridSource.includes('http_ok:typeof r?.response?.ok'));
});
test('status API and scan processing UI share a backend-derived percentage contract',()=>{
 assert.ok(statusSource.includes('progress_percent:getScanProgressPercent(job.status,stage,detail)'));
 assert.ok(progressUiSource.includes('role="progressbar"'));
 assert.ok(progressUiSource.includes('progressPercent=null'));
 assert.ok(progressUiSource.includes('scanProgressSheen'));
 assert.ok(scanModalSource.includes('progressPercent={state.progressPercent}'));
 assert.ok(scanModalSource.includes('progressPercent:d.progress_percent'));
});

test('Groq OTPM message beats the generic TPM reset header',()=>{
 const message='HTTP 429: Rate limit reached on output tokens per minute (OTPM). Please try again in 480ms. Need more tokens?';
 assert.equal(parseRetryAfterSeconds(message),0.48);
 assert.equal(getRateLimitRetrySeconds({message,retryAfter:1,remainingTokens:'3648',remainingRequests:'999',resetTokens:'32.64s',resetRequests:'1m26.4s'}),0.48);
});
test('Groq Retry-After is not inflated by an unrelated non-exhausted token reset',()=>{
 assert.equal(getRateLimitRetrySeconds({message:'quota limit reached',retryAfter:'1',remainingTokens:'3648',remainingRequests:'999',resetTokens:'32.64s',resetRequests:'1m26.4s'}),1);
 assert.equal(getRateLimitRetrySeconds({message:'quota limit reached',remainingTokens:'0',remainingRequests:'999',resetTokens:'2.5s',resetRequests:'1m26.4s'}),2.5);
 assert.equal(parseDurationSeconds('1m26.4s'),86.4);
});
test('scan disables reasoning and bounds output for OTPM while keeping same-model recovery',()=>{
 assert.ok(hybridSource.includes("reasoning_effort:'none'"));
 assert.ok(hybridSource.includes('max_completion_tokens:Math.min(900,model.max_completion_tokens)'));
 assert.ok(hybridSource.includes('Handwritten SIS is the three-letter honorific S-I-S'));
 assert.ok(hybridSource.includes('const retryDelaySeconds=r.response.status===429?cooldownSeconds(rate,providerMessage):0'));
 assert.ok(hybridSource.includes('getRateLimitRetrySeconds({message:row.retry_reason'));
 assert.ok(hybridSource.includes('rateLimitRetries<2'));
 assert.ok(hybridSource.includes("const JSON_RECOVERY_ERROR="));
 assert.ok(hybridSource.includes("JSON_RECOVERY_ERROR.test(String(err?.message||''))"));
 assert.ok(hybridSource.includes("err?.code==='AI_INVALID_RESPONSE'"));
 assert.ok(hybridSource.includes('part.people.length===0'));
 assert.ok(hybridSource.includes("response_format:jsonObjectFallback?{type:'json_object'}:SCHEMA"));
 assert.ok(hybridSource.includes('SAFE_ROW_FLAGS'));
 assert.ok(hybridSource.includes("typeof p.n!=='string'"));
 for(const forbidden of ['GEMINI','gemini','FALLBACK','qwen3.6-27b'])assert.equal(hybridSource.includes(forbidden),false);
});
test('Qwen JSON-object recovery locally validates every row field before acceptance',()=>{
 assert.ok(hybridSource.includes('x.people.length>MAX'));
 assert.ok(hybridSource.includes('p.p.length>2'));
 assert.ok(hybridSource.includes("p.f.some(v=>!SAFE_ROW_FLAGS.has(v))"));
 assert.ok(hybridSource.includes("typeof p.d!=='string'"));
});
test('scan admission preflight returns a countdown and the modal enforces it on initial scan and retry',()=>{
 assert.ok(admissionSource.includes('retry_after_seconds:retrySeconds'));
 assert.ok(admissionSource.includes('retry_at:retrySeconds>0'));
 assert.ok(scanModalSource.includes('/api/scan/admission?_=')); 
 assert.ok(scanModalSource.includes('setInterval(tick,200)'));
 assert.ok(scanModalSource.includes('disabled={cooldownActive}'));
 assert.ok(scanModalSource.includes('Try again in '));
});


test('overlapping region alignment removes duplicate reads and keeps the clearer SIS title',()=>{
 const parts=[
  {region:{id:1,y0:0,y1:744},people:[
   {r:1,y:726,n:'SIS Greevay',p:[],dob:'',f:[],e:'top crop row'},
   {r:2,y:820,n:'Bro Onyebachi',p:[],dob:'',f:[],e:'top crop row'},
   {r:3,y:907,n:'Bro Isaac',p:[],dob:'',f:[],e:'top crop row'},
   {r:4,y:988,n:'Sis Peace',p:[],dob:'',f:[],e:'top crop row'}
  ]},
  {region:{id:2,y0:456,y1:1200},people:[
   {r:1,y:153,n:'SB Greevay',p:[],dob:'',f:[],e:'bottom crop row'},
   {r:2,y:227,n:'Bro onyebuchi',p:[],dob:'',f:[],e:'bottom crop row'},
   {r:3,y:315,n:'Bro Isaac',p:[],dob:'',f:[],e:'bottom crop row'},
   {r:4,y:382,n:'Sis Peace',p:[],dob:'',f:[],e:'bottom crop row'}
  ]}
 ];
 const rows=mergeScanRegions(parts,1200,50);
 assert.equal(rows.length,4);
 assert.equal(rows[0].n,'SIS Greevay');
 assert.equal(rows[1].n,'Bro Onyebachi');
 assert.equal(rows[2].n,'Bro Isaac');
 assert.equal(rows[3].n,'Sis Peace');
 assert(rows.every(row=>row.e.includes('top crop row')&&row.e.includes('bottom crop row')));
});
test('same-region duplicate names remain separate observations without overlap evidence',()=>{
 const rows=mergeScanRegions([
  {region:{id:1,y0:0,y1:1000},people:[
   {r:1,y:400,n:'Bro Isaac',p:[],dob:'',f:[],e:'first person'},
   {r:2,y:460,n:'Bro Isaac',p:[],dob:'',f:[],e:'second person'}
  ]}
 ],1000,50);
 assert.equal(rows.length,2);
});

test('rate-limited scans keep a conservative shared cooldown after bounded retries',()=>{
 assert.ok(hybridSource.includes('MIN_RATE_LIMIT_COOLDOWN_SECONDS=8'));
 assert.ok(hybridSource.includes('Math.max(1000,Math.ceil(wait*1000)+250)'));
 assert.ok(hybridSource.includes('delay=Math.max(MIN_RATE_LIMIT_COOLDOWN_SECONDS,providerDelay)'));
 assert.ok(hybridSource.includes('err.cooldownSeconds=safeCooldown'));
});
test('scan image preparation and secure session retrieval run concurrently',()=>{
 assert.ok(scanModalSource.includes('Promise.all([prepare(file),session()])'));
 assert.ok(scanModalSource.includes('ARIA is preparing the photo and connecting securely'));
});
test('scan start API reports safe stage timings to diagnose cold-start latency',()=>{
 assert.ok(scanStartSource.includes('[SCAN_START_TIMING]'));
 for(const stage of ['admission_ms','image_hash_ms','db_connect_ms','advisory_lock_ms','stale_recovery_ms','insert_commit_ms','total_ms'])assert.ok(scanStartSource.includes(stage));
});



test('scan failure stages normalize to the approved diagnostic vocabulary',()=>{
 assert.equal(normalizeScanFailureStage('ai_request'),'region_read');
 assert.equal(normalizeScanFailureStage('parse_json'),'validate');
 assert.equal(normalizeScanFailureStage('database_save'),'persist');
 assert.equal(normalizeScanFailureStage('not-a-stage'),'unknown');
});

test('scan failure persistence falls back to a minimal status/error_code update after a detailed write fails',async()=>{
 const calls=[];
 const db={async query(sql,params=[]){
  calls.push({sql,params});
  if(sql.includes('SELECT id, organization_id, status, progress_detail')){
   return{rows:[{id:'job-1',organization_id:'org-1',status:'processing',progress_detail:{stage:'reading_overlapping_regions',regions_total:2,regions_completed:1,active_region:2},created_at:new Date().toISOString(),started_at:new Date().toISOString()}]};
  }
  if(sql.includes('failed_stage = $2'))throw new Error('forced detailed terminal-write failure');
  if(sql.includes("SET status = 'failed', error_code = $2")){
   return{rowCount:1,rows:[{id:'job-1',organization_id:'org-1',status:'failed',created_at:new Date().toISOString(),started_at:new Date().toISOString()}]};
  }
  throw new Error('Unexpected test SQL: '+sql);
 }};
 const result=await persistScanFailure(db,{jobId:'job-1',stage:'region_read',code:'AI_PROVIDER_ERROR',detail:{message:'provider rejected request'},startTime:Date.now()});
 assert.equal(result.transitioned,true);
 assert.equal(result.usedFallback,true);
 assert.equal(result.persistenceFailed,false);
 const fallback=calls.find(x=>x.sql.includes("SET status = 'failed', error_code = $2"));
 assert.ok(fallback);
 assert.deepEqual(fallback.params,['job-1','AI_PROVIDER_ERROR']);
 assert.equal(/progress_detail|error_detail|result\s*=/.test(fallback.sql),false);
});

test('minimal terminal-state fallback still attempts exactly one Telegram failure alert',async()=>{
 const calls=[],sent=[];
 const db={async query(sql,params=[]){
  calls.push({sql,params});
  if(sql.includes('SELECT id, organization_id, status, progress_detail')){
   return{rows:[{id:'job-2',organization_id:'org-2',status:'processing',progress_detail:{stage:'reading_overlapping_regions',regions_total:2,regions_completed:1,active_region:2},created_at:new Date().toISOString(),started_at:new Date().toISOString()}]};
  }
  if(sql.includes('failed_stage = $2'))throw new Error('force safe fallback');
  if(sql.includes("SET status = 'failed', error_code = $2")){
   return{rowCount:1,rows:[{id:'job-2',organization_id:'org-2',status:'failed',created_at:new Date().toISOString(),started_at:new Date().toISOString()}]};
  }
  if(sql.includes('SELECT COUNT(*)::int AS count'))return{rows:[{count:1}]};
  if(sql.includes('INSERT INTO public.scan_failure_alerts')){
   return{rowCount:1,rows:[{id:'alert-2'}]};
  }
  if(sql.includes('UPDATE public.scan_failure_alerts SET delivery_status = \'sent\''))return{rowCount:1,rows:[]};
  throw new Error('Unexpected test SQL: '+sql);
 }};
 const result=await recordScanFailureAndAlert(db,{
  jobId:'job-2',organizationId:'org-2',stage:'region_read',code:'AI_PROVIDER_ERROR',
  detail:{message:'provider request rejected'},startTime:Date.now(),
  env:{TELEGRAM_BOT_TOKEN:'test-token',TELEGRAM_CHAT_ID:'test-chat'},
  fetchImpl:async(url,options)=>{sent.push({url,body:JSON.parse(options.body)});return{ok:true,status:200}}
 });
 assert.equal(result.transitioned,true);
 assert.equal(result.usedFallback,true);
 assert.equal(sent.length,1);
 assert.match(sent[0].url,/api\.telegram\.org\/bottest-token\/sendMessage/);
 assert.match(sent[0].body.text,/job-2/);
 assert.match(sent[0].body.text,/AI_PROVIDER_ERROR/);
 assert.ok(calls.some(x=>x.sql.includes("SET status = 'failed', error_code = $2")));
});

test('scan-start stale recovery uses shared failure persistence and background alert delivery',()=>{
 assert.ok(scanStartSource.includes('persistScanFailure(pool'));
 assert.ok(scanStartSource.includes('scheduleStaleAlerts(staleFailures,orgId)'));
 assert.ok(scanStartSource.includes('waitUntil(task)'));
 assert.equal(scanStartSource.includes("UPDATE scan_jobs SET status='failed',progress='failed',error_code='SCAN_STALLED'"),false);
});

test('scan failure without Telegram credentials is recorded as disabled rather than silently skipped',async()=>{
 const calls=[];
 const db={async query(sql,params=[]){
  calls.push({sql,params});
  if(sql.includes('SELECT COUNT(*)::int AS count'))return{rows:[{count:1}]};
  if(sql.includes('INSERT INTO public.scan_failure_alerts')){
   return{rowCount:1,rows:[{id:'alert-disabled-1'}]};
  }
  if(sql.includes("SET delivery_status = 'disabled'"))return{rowCount:1,rows:[]};
  throw new Error('Unexpected test SQL: '+sql);
 }};
 const result=await sendScanFailureAlert(db,{
  jobId:'job-disabled',organizationId:'org-disabled',stage:'region_read',code:'AI_RATE_LIMIT',
  regionStates:{regions_total:2,regions_completed:1},elapsedMs:9000,
  env:{},fetchImpl:async()=>{throw new Error('Telegram must not be called without credentials')}
 });
 assert.equal(result.sent,false);
 assert.equal(result.reason,'TELEGRAM_NOT_CONFIGURED');
 assert.ok(calls.some(x=>x.sql.includes('INSERT INTO public.scan_failure_alerts')));
 const disabled=calls.find(x=>x.sql.includes("SET delivery_status = 'disabled'"));
 assert.ok(disabled);
 assert.match(disabled.params[1],/TELEGRAM_NOT_CONFIGURED/);
});


test('weak-network scan-start retries reuse one durable request id',()=>{
 assert.ok(scanStartSource.includes('client_request_id'));
 assert.ok(scanStartSource.includes('public.scan_start_requests'));
 assert.ok(scanStartSource.includes('requested_image_hash!==hash'));
 assert.ok(scanStartSource.includes('ON CONFLICT (organization_id,client_request_id) DO NOTHING'));
 assert.ok(scanStartSource.includes('Reconnected to its saved result.'));
 assert.ok(scanModalSource.includes('client_request_id:requestId'));
 assert.ok(scanModalSource.includes('SCAN_START_UNCERTAIN'));
 assert.ok(scanModalSource.includes("state.error?.code==='SCAN_START_UNCERTAIN'?'Connection not confirmed.':'Scan not completed.'"));
 assert.ok(scanModalSource.includes('pendingStart.current'));
 assert.ok(scanModalSource.includes('Choose the same photo again'));
 assert.ok(scanModalSource.includes("if(state.stage==='processing'||state.error?.code==='SCAN_START_UNCERTAIN'){onClose?.();return}"));
 assert.ok(scanModalSource.includes('retryServerErrors=false'));
 assert.ok(scanStartMigrationSource.includes('PRIMARY KEY (organization_id, client_request_id)'));
 assert.ok(scanStartMigrationSource.includes('ENABLE ROW LEVEL SECURITY'));
 assert.ok(scanStartMigrationSource.includes('REVOKE ALL ON TABLE public.scan_start_requests'));
});

// scripts/scan-regression.js
import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import sharp from'sharp';
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5432/test';
const{validateScanOutput,fuzzyMatch,normalizeName}=await import('../lib/scanValidation.js');const{resolveIdentities}=await import('../lib/identityResolver.js');const{nameSimilarity}=await import('../lib/duplicateDetector.js');const{getModelConfig}=await import('../lib/modelRegistry.js');
const{getScanProgressPercent}=await import('../lib/scanProgress.js');
const{parseRetryAfterSeconds,parseDurationSeconds,getRateLimitRetrySeconds}=await import('../lib/scanRateLimit.js');
const{mergeScanRegions}=await import('../lib/scanRegionMerge.js');const{formatScanLearningHints}=await import('../lib/scanLearningHints.js');const{resolveScanReasoningEffort,getScanPipelineVersion,SCAN_VISUAL_VERIFICATION_INSTRUCTION}=await import('../lib/scanReasoning.js');
const{normalizeScanFailureStage,persistScanFailure,recordScanFailureAndAlert,sendScanFailureAlert}=await import('../lib/scanFailure.js');
const admissionSource=readFileSync(new URL('../pages/api/scan/admission.js',import.meta.url),'utf8');
const hybridSource=readFileSync(new URL('../lib/hybridScanProvider.js',import.meta.url),'utf8');
const scanImageViewsSource=readFileSync(new URL('../lib/scanImageViews.js',import.meta.url),'utf8');
const statusSource=readFileSync(new URL('../pages/api/scan/status.js',import.meta.url),'utf8');
const progressUiSource=readFileSync(new URL('../components/AriaProcessingStatus.js',import.meta.url),'utf8');
const scanModalSource=readFileSync(new URL('../components/ScanModal.js',import.meta.url),'utf8');
const scanStartSource=readFileSync(new URL('../pages/api/scan/start.js',import.meta.url),'utf8');
const scanStartMigrationSource=readFileSync(new URL('../supabase/migrations/20261021153000_scan_start_request_idempotency.sql',import.meta.url),'utf8');
const scanProviderSource=readFileSync(new URL('../lib/hybridScanProvider.js',import.meta.url),'utf8');
const scanProcessorSource=readFileSync(new URL('../lib/visionProcessor.js',import.meta.url),'utf8');
const scanStatusSource=readFileSync(new URL('../pages/api/scan/status.js',import.meta.url),'utf8');
const scanStateSource=readFileSync(new URL('../lib/scanState.js',import.meta.url),'utf8');
const scanBlankConfirmSource=readFileSync(new URL('../pages/api/scan/confirm-blank.js',import.meta.url),'utf8');
const scanBlankCoreSource=readFileSync(new URL('../lib/scanBlankConfirmation.js',import.meta.url),'utf8');
const{classifyScanRegions}=await import('../lib/scanCompleteness.js');
const{makeScanRegions}=await import('../lib/scanImageViews.js');const{isInputTokenBudgetError,makeFullPageBudgetFallback}=await import('../lib/scanRequestBudget.js');
const{createConfirmBlankHandler}=await import('../lib/scanBlankConfirmation.js');
const phone=n=>({normalized:n}),base={type:'person',status:'active',metadata:{identity_verified:true},living_truth:{status:'alive'},identity_verification_status:'verified'};
function clientFor(people){return{async query(sql){if(/FROM people WHERE organization_id/.test(sql))return{rows:people};if(/FROM person_aliases/.test(sql))return{rows:[]};if(/FROM identity_shared_contacts/.test(sql))return{rows:[]};if(/FROM identity_pair_decisions/.test(sql))return{rows:[]};throw new Error(`Unexpected SQL in regression client: ${sql.slice(0,80)}`)}}}
function fakeBlankConfirmationRuntime(){
 const jobId='11111111-1111-4111-8111-111111111111',organizationId='org-test',imageData=Buffer.from('fake-register-image-bytes'),queries=[],workerCalls=[],scheduled=[];
 const client={async query(sql,params=[]){queries.push({sql:String(sql),params});const q=String(sql).trim().toUpperCase();if(['BEGIN','COMMIT','ROLLBACK'].includes(q))return{rows:[],rowCount:0};if(q.startsWith('SELECT J.ID,J.STATUS,J.PROGRAM_NAME'))return{rows:[{id:jobId,status:'needs_confirmation',program_name:'GIBEON',actor_id:'actor-test',started_at:new Date().toISOString(),created_at:new Date().toISOString(),checkpoint:{version:1,regions:[]},image_data:imageData}]};if(q.includes("SET STATUS='COMPLETE'"))return{rows:[{id:jobId}],rowCount:1};if(q.includes("SET STATUS='PENDING'"))return{rows:[{id:jobId}],rowCount:1};throw Error('Unexpected SQL in fake confirmation database: '+String(sql).slice(0,100))},release(){}};
 const db={async connect(){return client}};
 const handler=createConfirmBlankHandler({db,runVision:(...args)=>{workerCalls.push(args);return Promise.resolve({ok:true})},schedule:task=>{scheduled.push(task)}});
 const response={statusCode:200,headers:{},body:null,setHeader(name,value){this.headers[name]=value;return this},status(code){this.statusCode=code;return this},json(body){this.body=body;return this}};
 return{jobId,organizationId,imageData,queries,workerCalls,scheduled,handler,response,request(confirmBlank){return{method:'POST',body:{job_id:jobId,confirm_blank:confirmBlank},org:{id:organizationId},user:{id:'actor-test'}}}};
}

test('single-page validation preserves continuation ownership',()=>{const v=validateScanOutput(JSON.stringify({people:[{r:1,y:100,x:100,n:'Sandra Isichei',p:['08039579786'],nc:98,pc:96,rc:95,ns:'clear',ps:'clear',rs:'clear',f:[],na:[],e:'row 1'},{r:1,y:130,x:120,n:'',p:['08183488629'],nc:98,pc:90,rc:92,ns:'clear',ps:'clear',rs:'clear',f:[],na:[],e:'continuation'}]}));assert.equal(v.valid,true);assert.equal(v.people.length,1);assert.deepEqual(v.people[0].phones,['+2348039579786','+2348183488629'])});
test('Nigerian 020 number is flagged, never silently rewritten',()=>{const v=validateScanOutput(JSON.stringify({people:[{r:1,y:100,x:100,n:'Test Person',p:['02066139143'],nc:98,pc:98,rc:95,ns:'clear',ps:'clear',rs:'clear',f:[],na:[],e:'row'}]}));assert.equal(v.valid,true);assert(v.needsReview[0].reasons.includes('phone_number_not_safely_validated'));assert.equal(v.people[0].phones[0],'+2342066139143')});
test('duplicate exact observation inside one scan is rejected',()=>{const row={r:1,y:100,x:100,n:'Grace Nwosu',p:['08012345678'],nc:99,pc:99,rc:99,ns:'clear',ps:'clear',rs:'clear',f:[],na:[],e:'row'};const second={...row,r:2,y:200};const v=validateScanOutput(JSON.stringify({people:[row,second]}));assert.equal(v.people.length,1);assert.equal(v.rejected[0].reason,'duplicate_identity_in_scan')});
test('70–80% name similarity remains detectable',()=>{const a='Wheen Nwapa',b='Wuean Nwapa',f=fuzzyMatch(a,b),d=nameSimilarity(a,b);assert(f>=.7);assert(d.score>=70&&d.score<96)});
test('exact existing identity remains recognized even when one extracted field needs review',async()=>{const existing={...base,id:'11111111-1111-1111-1111-111111111111',first_name:'Precious',last_name:'Okafor',display_name:'Sis Precious Okafor',phone:'+2348035230123',phone_numbers:[phone('+2348035230123')]};const input=[{row_number:9,name:'Sis Precious Okafor',first_name:'Precious',last_name:'Okafor',phones:['+2348035230123'],rawPhones:['08035230123'],extraction_review_reasons:['name_evidence_ambiguous']}];const out=await resolveIdentities(input,'org-test','job-test',clientFor([existing]));assert.equal(out[0].status,'alive');assert.equal(out[0].best_candidate_id,existing.id);assert(out[0].field_review_reasons.includes('name_evidence_ambiguous'))});
test('two exact same-name owners do not auto-merge',async()=>{const a={...base,id:'11111111-1111-1111-1111-111111111111',display_name:'John Okafor',first_name:'John',last_name:'Okafor',phone_numbers:[phone('+2348011111111')]},b={...base,id:'22222222-2222-2222-2222-222222222222',display_name:'John Okafor',first_name:'John',last_name:'Okafor',phone_numbers:[phone('+2348022222222')]};const out=await resolveIdentities([{row_number:1,name:'John Okafor',phones:[],extraction_review_reasons:[]}],'org-test','job-test',clientFor([a,b]));assert.equal(out[0].status,'conflict');assert.equal(out[0].best_candidate_id,null)});

test('literal honorific and spelling are preserved for display while identity matching may normalize them',()=>{const v=validateScanOutput(JSON.stringify({people:[{r:1,y:100,x:100,n:'Sis. Joy Grace',p:['08012345678'],nc:99,pc:99,rc:99,ns:'clear',ps:'clear',rs:'clear',f:[],na:[],e:'row'}]}));assert.equal(v.valid,true);assert.equal(v.people[0].name,'Sis. Joy Grace');assert.equal(v.people[0].display_name,'Sis. Joy Grace');assert.equal(v.people[0].raw_name,'Sis. Joy Grace');assert.equal(v.people[0].honorific,'Sis.');assert.equal(normalizeName(v.people[0].name),'joy grace')});
test('likely SIS-to-SB title OCR is flagged without changing the literal name',()=>{const v=validateScanOutput(JSON.stringify({people:[{r:1,y:120,n:'SB Greevay',p:[],d:'',f:[]}]}));assert.equal(v.valid,true);assert.equal(v.people[0].name,'SB Greevay');assert(v.people[0].extraction_review_reasons.includes('suspected_honorific_confusion'));assert(v.needsReview[0].reasons.includes('suspected_honorific_confusion'));assert.match(v.needsReview[0].reason,/SIS.*SB|SB.*SIS/)});
test('different names at the same vertical position are flagged as a possible split row',()=>{const v=validateScanOutput(JSON.stringify({people:[{r:1,y:920,n:'Bro Tonia',p:[],d:'',f:[]},{r:2,y:920,n:'Bose',p:[],d:'',f:[]}]}));assert.equal(v.valid,true);assert.equal(v.people.length,2);assert(v.people.every(x=>x.extraction_review_reasons.includes('split_row_suspected')));assert(v.needsReview.every(x=>x.reasons.includes('split_row_suspected')));assert(v.needsReview.some(x=>/same vertical position/.test(x.reason)))});
test('only repeated, character-only human OCR cues are passed to Qwen as attention hints',()=>{const hints=formatScanLearningHints([{learning_type:'ocr_name_visual_confusion',learning_key:'name:substitute:y>u@6',value:{from:'y',to:'u',kind:'substitute',position:6},confidence:.75,example_count:3},{learning_type:'ocr_phone_digit_confusion',learning_key:'phone:substitute:8>3@4',value:{from:'8',to:'3',kind:'substitute',position:4},confidence:.8,example_count:2},{learning_type:'ocr_name_visual_confusion',learning_key:'name:substitute:bad',value:{from:'Asha',to:'Ella',kind:'substitute'},confidence:.99,example_count:100},{learning_type:'ocr_name_visual_confusion',learning_key:'name:substitute:c>l@2',value:{from:'c',to:'l',kind:'substitute'},confidence:.9,example_count:1}]);assert.match(hints,/name: OCR read 'y'; reviewers confirmed 'u'/);assert.match(hints,/phone: OCR read '8'; reviewers confirmed '3'/);assert.doesNotMatch(hints,/Asha|Ella/);assert.match(hints,/Never substitute a character automatically/);assert.equal(formatScanLearningHints([]),'');assert.ok(scanProviderSource.includes('formatScanLearningHints(opt?.scanLearning)'))});
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
 assert.ok(hybridSource.includes('callOne(requestRegion,PRIMARY,opt,attempt,jsonFallbackUsed)'));
 assert.ok(hybridSource.includes('rateLimitRetries<2'));
 assert.ok(hybridSource.includes('jsonFallbackUsed'));
});
test('scan uses a budgeted overlapping-view provider request and publishes fresh backend heartbeats',()=>{
 assert.ok(hybridSource.includes('for(let i=0;i<regions.length;i++)'));
 assert.ok(hybridSource.includes('makeScanRegions(page)'));
 assert.ok(scanImageViewsSource.includes('images:[top,bottom]'));
 assert.ok(hybridSource.includes("...images.map(view=>({type:'image_url'"));
 assert.ok(hybridSource.includes('provider:PRIMARY.provider,regions:1,reasoning:SCAN_REASONING_EFFORT'));assert.ok(hybridSource.includes('single_request_budgeted_vision_views_groq_qwen_only'));assert.ok(hybridSource.includes('image_views:parts.reduce'));
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

test('Qwen 3.8 output allowance matches the documented maximum and is not capped by scan code',()=>{assert.equal(getModelConfig('groq-qwen3.8-27b').max_completion_tokens,16384);assert.ok(hybridSource.includes('max_completion_tokens:model.max_completion_tokens'));assert.equal(hybridSource.includes('Math.min(900,model.max_completion_tokens)'),false)});
test('Groq HTTP 413 input-token-budget rejection triggers a smaller-view fallback, not a blind retry',()=>{
 assert.equal(isInputTokenBudgetError(413,'Request too large for model: input tokens per minute (ITPM): Limit 7000, Requested 7089'),true);
 assert.equal(isInputTokenBudgetError(413,'Request entity too large because image URL exceeds 20MB'),false);
 assert.equal(isInputTokenBudgetError(429,'input tokens per minute limit'),false);
 const region={id:1,y0:0,y1:2000,h:2000,data:'FULL_PAGE_BASE64',images:[{label:'upper_detail',data:'TOP',y0:0,y1:1240},{label:'lower_detail',data:'BOTTOM',y0:760,y1:2000}]};
 const fallback=makeFullPageBudgetFallback(region);
 assert.equal(fallback.images.length,1);
 assert.equal(fallback.images[0].label,'full_page_budget_fallback');
 assert.equal(fallback.images[0].data,'FULL_PAGE_BASE64');
 assert.equal(fallback.images[0].y1,2000);
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
test('scan uses low-effort hidden reasoning, full model output capacity and same-model recovery',()=>{
 assert.ok(hybridSource.includes('reasoning_effort:reasoningEffort'));
 assert.ok(hybridSource.includes('max_completion_tokens:model.max_completion_tokens'));
 assert.ok(hybridSource.includes('Handwritten SIS is S-I-S, not SB unless B is genuinely visible'));assert.ok(hybridSource.includes('Compare repeated title tokens down the left column'));
 assert.ok(hybridSource.includes('const inputBudgetError=isInputTokenBudgetError(r.response.status,providerMessage)'));assert.ok(hybridSource.includes("code:inputBudgetError?'AI_INPUT_TOKEN_BUDGET'"));assert.ok(hybridSource.includes("err?.code==='AI_INPUT_TOKEN_BUDGET'"));assert.ok(hybridSource.includes('makeFullPageBudgetFallback(requestRegion)'));
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
 assert.ok(scanStartSource.includes('if(!admission.allowed){if(requestId){const hash=imageHash(image_base64);'));
 assert.ok(scanStartSource.includes("j.provider_used||admission.provider||null"));
 assert.ok(scanStartSource.includes('requested_image_hash!==hash'));
 assert.ok(scanStartSource.includes('ON CONFLICT (organization_id,client_request_id) DO NOTHING'));
 assert.ok(scanStartSource.includes('Reconnected to its saved result.'));
 assert.ok(scanModalSource.includes('client_request_id:requestId'));
 assert.ok(scanModalSource.includes('SCAN_START_UNCERTAIN'));
 assert.ok(scanModalSource.includes("state.error?.code==='SCAN_START_UNCERTAIN'?'Connection not confirmed.':'Scan not completed.'"));
 assert.ok(scanModalSource.includes('pendingStart.current'));
 assert.ok(scanModalSource.includes('Choose the same photo again'));
 assert.ok(scanModalSource.includes("if(state.stage==='processing'||state.stage==='needs_confirmation'||state.error?.code==='SCAN_START_UNCERTAIN'){onClose?.();return}"));
 assert.ok(scanModalSource.includes('retryServerErrors=false'));
 assert.ok(scanModalSource.includes('r.status!==503'));
 assert.ok(scanModalSource.includes('||hadUncertainRequest'));
 assert.ok(scanModalSource.includes("definitiveNoJob=['AI_RATE_LIMIT','AI_NOT_CONFIGURED','SCAN_REQUEST_ID_REUSED'].includes(code)"));
 assert.ok(scanStartMigrationSource.includes('PRIMARY KEY (organization_id, client_request_id)'));
 assert.ok(scanStartMigrationSource.includes('ENABLE ROW LEVEL SECURITY'));
 assert.ok(scanStartMigrationSource.includes('REVOKE ALL ON TABLE public.scan_start_requests'));
});


test('an unconfirmed empty region blocks the entire scan even when another region has people',()=>{
 const regions=classifyScanRegions([
  {region:{id:1,y0:0,y1:500},people:[{n:'A'}],attempt_count:1,finishReason:'stop',requestId:'request-1'},
  {region:{id:2,y0:450,y1:1000},people:[],attempt_count:2,finishReason:'stop',requestId:'request-2'}
 ]);
 assert.equal(regions.requiresConfirmation,true);
 assert.equal(regions.complete,false);
 assert.equal(regions.regions[0].status,'valid');
 assert.equal(regions.regions[1].status,'empty_unconfirmed');
 assert.equal(regions.regions[1].error_code,'AI_EMPTY_REGION');
 assert.equal(regions.regions[1].attempt_count,2);
 assert.equal(JSON.stringify(regions).includes('request-1'),true);
 assert.equal(JSON.stringify(regions).includes('A'),true);
});

test('a blank region becomes complete only after explicit blank confirmation',()=>{
 const unconfirmed=classifyScanRegions([{region:{id:1,y0:0,y1:1000},people:[],attempt_count:2,finishReason:'stop'}]);
 assert.equal(unconfirmed.requiresConfirmation,true);
 assert.equal(unconfirmed.complete,false);
 const confirmed=classifyScanRegions([{region:{id:1,y0:0,y1:1000},people:[],completenessStatus:'confirmed_blank',attempt_count:2,finishReason:'stop'}]);
 assert.equal(confirmed.requiresConfirmation,false);
 assert.equal(confirmed.complete,true);
 assert.equal(confirmed.regions[0].status,'confirmed_blank');
});

test('invalid region output cannot satisfy completeness',()=>{
 const invalid=classifyScanRegions([{region:{id:1},people:null,attempt_count:2}]);
 assert.equal(invalid.requiresConfirmation,false);
 assert.equal(invalid.complete,false);
 assert.equal(invalid.regions[0].status,'failed');
 const partialFailure=classifyScanRegions([{region:{id:1,y0:0,y1:500},people:[{n:'Only test row'}],attempt_count:1},{region:{id:2,y0:500,y1:1000},people:null,completenessStatus:'failed',outcome_reason:'AI_RATE_LIMIT',error_code:'AI_RATE_LIMIT',attempt_count:3}]);
 assert.equal(partialFailure.complete,false);
 assert.deepEqual(partialFailure.regions.map(x=>x.status),['valid','failed']);
 assert.equal(partialFailure.regions[1].reason,'AI_RATE_LIMIT');
 assert.equal(partialFailure.regions[1].error_code,'AI_RATE_LIMIT');
});

test('phase 2 empty-page handling stops before validation and identity writes',()=>{
 const confirmationGate=scanProcessorSource.indexOf('if(vision?.requiresConfirmation)');
 const validation=scanProcessorSource.indexOf('const rawContent=');
 assert.ok(confirmationGate>=0&&validation>confirmationGate);
 assert.ok(scanProcessorSource.includes("process.env.SCAN_CONFIRM_EMPTY_REGION==='false'"));
 assert.ok(scanProcessorSource.includes("status='needs_confirmation'"));
 assert.ok(scanProcessorSource.includes("checkpoint=$2::jsonb"));
 assert.ok(scanProcessorSource.includes("reason:'region_failed',regions:err.scan_region_states"));
 assert.ok(scanProviderSource.includes('error.scan_region_states=classifyScanRegions([...parts,failed]).regions'));
 assert.ok(scanProviderSource.includes('import {classifyScanRegions} from \'./scanCompleteness\';'));
 assert.ok(scanProviderSource.indexOf('if(completeness.requiresConfirmation)')<scanProviderSource.indexOf('const merged=mergeScanRegions(parts,page.height,MAX)'));
 assert.ok(scanProviderSource.includes("jsonFallbackUsed=true"));
 assert.ok(scanProviderSource.includes("if(finishReason!=='stop')"));
 assert.ok(scanProviderSource.includes("!p.n.trim()"));
 assert.ok(scanProviderSource.includes('return an empty people array; do not invent entries'));
 assert.ok(scanProcessorSource.includes("reason:'region_failed',regions:err.scan_region_states"));
 assert.ok(scanProviderSource.includes('error.scan_region_states=classifyScanRegions([...parts,failed]).regions'));
 assert.ok(scanStateSource.includes("NEEDS_CONFIRMATION:'needs_confirmation'"));
 assert.ok(scanStatusSource.includes("job.status==='needs_confirmation'"));
 assert.ok(scanStatusSource.includes('requires_confirmation:job.status===\'needs_confirmation\''));
 assert.ok(scanStartSource.includes("j.status==='needs_confirmation'"));
});

test('blank confirmation is org-scoped, writes no People, and either completes blank or rereads saved evidence',()=>{
 assert.ok(scanBlankConfirmSource.includes("export default withOrg(handler)"));
 assert.ok(scanBlankCoreSource.includes("row.status!=='needs_confirmation'"));
 assert.ok(scanBlankCoreSource.includes("status='complete'"));
 assert.ok(scanBlankCoreSource.includes("status='pending'"));
 assert.ok(scanBlankCoreSource.includes('scan_evidence'));
 assert.ok(scanBlankCoreSource.includes('runVision(row.id,imageBase64'));
 assert.ok(scanBlankCoreSource.includes('confirmed_blank'));
 assert.ok(!scanBlankCoreSource.includes('INSERT INTO people'));
 assert.ok(!scanBlankCoreSource.includes('createScanReview'));
 assert.ok(scanModalSource.includes("state.stage==='needs_confirmation'"));
 assert.ok(scanModalSource.includes("onClick={()=>resolveBlank(true)}"));
 assert.ok(scanModalSource.includes("onClick={()=>resolveBlank(false)}"));
});


test('blank-page YES completes the saved scan without People or Review writes',async()=>{
 const x=fakeBlankConfirmationRuntime();
 await x.handler(x.request(true),x.response);
 assert.equal(x.response.statusCode,200);
 assert.equal(x.response.body.status,'complete');
 assert.equal(x.response.body.result.blank_confirmed,true);
 assert.equal(x.response.body.result.new_members,0);
 assert.match(x.response.body.result.summary,/No People or review records were changed/);
 assert.equal(x.workerCalls.length,0);
 assert.equal(x.queries.some(q=>/INSERT INTO people|createScanReview/i.test(q.sql)),false);
 assert.ok(x.queries.some(q=>q.sql.includes("SET status='complete'")));
 assert.ok(x.queries.some(q=>q.sql.trim()==='COMMIT'));
});

test('blank-page NO queues the same saved photo for a fresh Qwen pipeline read',async()=>{
 const x=fakeBlankConfirmationRuntime();
 await x.handler(x.request(false),x.response);
 assert.equal(x.response.statusCode,200);
 assert.equal(x.response.body.status,'pending');
 assert.equal(x.response.body.job_id,x.jobId);
 assert.equal(x.workerCalls.length,1);
 assert.equal(x.workerCalls[0][0],x.jobId);
 assert.equal(x.workerCalls[0][1],x.imageData.toString('base64'));
 assert.equal(x.workerCalls[0][2],x.organizationId);
 assert.equal(x.workerCalls[0][3],'GIBEON');
 assert.deepEqual(x.workerCalls[0][4],{actorId:'actor-test'});
 assert.equal(x.scheduled.length,1);
 assert.ok(x.queries.some(q=>q.sql.includes("SET status='pending'")));
 assert.equal(x.queries.some(q=>/INSERT INTO people|createScanReview/i.test(q.sql)),false);
});


test('Qwen scan uses two overlapping detail crops and preserves a one-image fallback',async()=>{
 const width=1000,height=1800;
 const buffer=await sharp({create:{width,height,channels:3,background:'#ffffff'}}).jpeg({quality:90}).toBuffer();
 const page={width,height,buffer,base64:buffer.toString('base64')};
 const regions=await makeScanRegions(page);
 assert.equal(regions.length,1,'detail crops must not create extra provider requests');
 const region=regions[0];
 assert.equal(region.y0,0);assert.equal(region.y1,height);
 assert.equal(region.images.length,2);
 assert.equal(region.data,page.base64,'original full-page data must remain available for a budget fallback');
 assert.equal(region.images[0].label,'upper_detail');
 assert.equal(region.images[0].y0,0);
 assert.equal(region.images[0].y1,1116);
 assert.equal(region.images[1].label,'lower_detail');
 assert.equal(region.images[1].y0,684);
 assert.equal(region.images[1].y1,height);
 assert.equal(region.images[0].y1-region.images[1].y0,432,'detail images must overlap');
 const upper=await sharp(Buffer.from(region.images[0].data,'base64')).metadata();
 const lower=await sharp(Buffer.from(region.images[1].data,'base64')).metadata();
 assert.deepEqual([upper.width,upper.height],[width,1116]);
 assert.deepEqual([lower.width,lower.height],[width,1116]);
 assert.ok(scanProviderSource.includes("...images.map(view=>({type:'image_url'"));
 assert.ok(scanProviderSource.includes('PHONE DIGITS ARE A REQUIRED EXTRACTION FIELD'));
 assert.ok(scanProviderSource.includes('getScanPipelineVersion(SCAN_REASONING_EFFORT)'));
 assert.ok(scanProviderSource.includes('makeScanRegions(page)'));
 assert.ok(scanImageViewsSource.includes('images:[top,bottom]'));
});

test('Qwen uses bounded low-effort visual verification and still emits schema-only JSON',()=>{
 assert.equal(resolveScanReasoningEffort('low'),'low');
 assert.equal(resolveScanReasoningEffort('none'),'none');
 assert.equal(resolveScanReasoningEffort(null),'low');
 assert.equal(getScanPipelineVersion('low'),'v76-low-reasoning-budgeted-views-json');
 assert.equal(getScanPipelineVersion('none'),'v76-no-reasoning-budgeted-views-json');
 assert.match(SCAN_VISUAL_VERIFICATION_INSTRUCTION,/one brief verification pass/);
 assert.match(SCAN_VISUAL_VERIFICATION_INSTRUCTION,/Count the written rows from top to bottom/);
 assert.match(SCAN_VISUAL_VERIFICATION_INSTRUCTION,/Return only the compact JSON object/);
 assert.match(SCAN_VISUAL_VERIFICATION_INSTRUCTION,/Do not output an explanation/);
 assert.ok(scanProviderSource.includes('reasoning_effort:reasoningEffort'));
 assert.ok(scanProviderSource.includes("reasoning_format:'hidden'"));
 assert.ok(scanProviderSource.includes('SCAN_VISUAL_VERIFICATION_INSTRUCTION'));
 assert.ok(scanProviderSource.includes('max_completion_tokens:model.max_completion_tokens'));
});
test('Qwen extraction telemetry stores phone coverage counts but no extracted personal values',()=>{
 const observerSource=readFileSync(new URL('../lib/aiObserver.js',import.meta.url),'utf8');
 assert.ok(observerSource.includes('additionalMetrics={}'));
 assert.ok(observerSource.includes('extraction_metrics=$1::jsonb'));
 assert.ok(scanProviderSource.includes('rows_with_phones:withPhones'));
 assert.ok(scanProviderSource.includes('rows_without_phones:people.length-withPhones'));
 assert.ok(scanProviderSource.includes('phone_coverage_rate'));
 assert.ok(!scanProviderSource.includes('person.name,phone_digits_sample'));
});

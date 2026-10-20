// scripts/scan-regression.js
import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5432/test';
const{validateScanOutput,fuzzyMatch,normalizeName}=await import('../lib/scanValidation.js');const{resolveIdentities}=await import('../lib/identityResolver.js');const{nameSimilarity}=await import('../lib/duplicateDetector.js');
const{getScanProgressPercent}=await import('../lib/scanProgress.js');
const{parseRetryAfterSeconds,parseDurationSeconds,getRateLimitRetrySeconds}=await import('../lib/scanRateLimit.js');
const admissionSource=readFileSync(new URL('../pages/api/scan/admission.js',import.meta.url),'utf8');
const hybridSource=readFileSync(new URL('../lib/hybridScanProvider.js',import.meta.url),'utf8');
const statusSource=readFileSync(new URL('../pages/api/scan/status.js',import.meta.url),'utf8');
const progressUiSource=readFileSync(new URL('../components/AriaProcessingStatus.js',import.meta.url),'utf8');
const scanModalSource=readFileSync(new URL('../components/ScanModal.js',import.meta.url),'utf8');
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
 assert.ok(hybridSource.includes('callOne(region,PRIMARY,opt,attempt)'));
 assert.ok(hybridSource.includes('attempt>=3||!Number.isFinite(wait)||wait<0||wait>30'));
});
test('scan image regions are processed sequentially and publish fresh backend heartbeats',()=>{
 assert.ok(hybridSource.includes('for(let i=0;i<regions.length;i++)'));
 assert.equal(hybridSource.includes('Promise.all(regions.map'),false);
 assert.ok(hybridSource.includes('setInterval(()=>{if(activeRegion)report(stage'));
 assert.ok(hybridSource.includes('retry_reason:r.response.ok?null:'));
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
test('scan retries the quota-directed wait on the same Qwen model and lowers hidden reasoning overhead',()=>{
 assert.ok(hybridSource.includes("reasoning_effort:'medium'"));
 assert.ok(hybridSource.includes('retryDelaySeconds=r.response.status===429?cooldownSeconds(rate,providerMessage):0'));
 assert.ok(hybridSource.includes('attempt>=3||!Number.isFinite(wait)||wait<0||wait>30'));
 assert.ok(hybridSource.includes('getRateLimitRetrySeconds({message:row.retry_reason'));
 for(const forbidden of ['GEMINI','gemini','FALLBACK','qwen3.6-27b'])assert.equal(hybridSource.includes(forbidden),false);
});
test('scan admission preflight returns a countdown and the modal enforces it on initial scan and retry',()=>{
 assert.ok(admissionSource.includes('retry_after_seconds:retrySeconds'));
 assert.ok(admissionSource.includes('retry_at:retrySeconds>0'));
 assert.ok(scanModalSource.includes('/api/scan/admission?_=')); 
 assert.ok(scanModalSource.includes('setInterval(tick,200)'));
 assert.ok(scanModalSource.includes('disabled={cooldownActive}'));
 assert.ok(scanModalSource.includes('Try again in '));
});

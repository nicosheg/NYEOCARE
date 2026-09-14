// lib/aiProvider.js
import{getModelConfig}from'./modelRegistry';
import{logAIUsage}from'./aiObserver';
import crypto from'crypto';
const GROQ_API_KEY=process.env.GROQ_API_KEY;
const GROQ_URL='https://api.groq.com/openai/v1/chat/completions';
const MODEL_KEY=process.env.GROQ_VISION_MODEL_KEY||'groq-qwen3.8-27b';
const MODEL=getModelConfig(MODEL_KEY);
export const SCAN_PIPELINE_VERSION='v30-orientation-resilient-two-pass';
const MAX_PEOPLE_PER_PAGE=50;
const CONFIGURED_CEILING=Number(process.env.GROQ_SCAN_OUTPUT_CEILING||MODEL.max_completion_tokens||1000);
const PROVIDER_OUTPUT_CEILING=Math.min(1000,Number.isFinite(CONFIGURED_CEILING)&&CONFIGURED_CEILING>0?CONFIGURED_CEILING:1000);
const SAFE_OUTPUT_CEILING=PROVIDER_OUTPUT_CEILING;
const MIN_OUTPUT=700;
const DEFAULT_OUTPUT=Math.min(900,SAFE_OUTPUT_CEILING);
const RECOVERY_MAX=SAFE_OUTPUT_CEILING;
const MAX_RETRIES=2;
const TIMEOUT=90000;
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
function cleanName(value){return String(value||'').replace(/\s+/g,' ').trim()}
const TITLES={mr:'Mr',mrs:'Mrs',ms:'Ms',miss:'Miss',bro:'Bro',brother:'Brother',sis:'Sis',sister:'Sister',pastor:'Pastor',past:'Past',pst:'Pst',rev:'Rev',reverend:'Reverend',dr:'Dr',doctor:'Doctor',elder:'Elder',deacon:'Deacon',deaconess:'Deaconess',chief:'Chief',bishop:'Bishop',apostle:'Apostle',evangelist:'Evangelist',prophet:'Prophet',minister:'Minister',canon:'Canon',father:'Father',archbishop:'Archbishop'};
function capitalizeName(value){return cleanName(value).split(/\s+/).map(part=>part.replace(/[A-Za-zÀ-ÖØ-öø-ÿ]+/g,word=>TITLES[word.toLowerCase()]||word.charAt(0).toUpperCase()+word.slice(1).toLowerCase())).join(' ')}
function parseJSON(text){if(typeof text!=='string'||!text.trim())return null;const cleaned=text.replace(/<think>[\s\S]*?<\/think>/gi,'').replace(/```json/gi,'').replace(/```/g,'').trim();try{return JSON.parse(cleaned)}catch{}const match=cleaned.match(/\{[\s\S]*\}/);if(match)try{return JSON.parse(match[0])}catch{}return null}
function phoneValues(value){const phones=value?.p??value?.phones??value?.phone;if(Array.isArray(phones))return phones.map(v=>String(v??'').trim()).filter(Boolean).slice(0,2);if(phones==null)return[];const phone=String(phones).trim();return phone?[phone]:[]}
function personKey(value){const name=cleanName(value?.n??value?.name??'').toLowerCase(),phones=phoneValues(value).map(v=>String(v).replace(/[\s()-]/g,'')).filter(Boolean).sort(),row=Number.isFinite(Number(value?.r))?Number(value.r):null;return`${row==null?'':`r${row}|`}${name}|${phones.join(',')}`}
function compactPeople(parsed){const rows=Array.isArray(parsed?.people)?parsed.people:Array.isArray(parsed)?parsed:[],seen=new Set(),people=[];for(let i=0;i<rows.length;i++){const row=rows[i],rawName=cleanName(row?.n??row?.name??''),name=capitalizeName(rawName),phones=phoneValues(row),modelRow=Number.isInteger(Number(row?.r))&&Number(row.r)>=1&&Number(row.r)<=MAX_PEOPLE_PER_PAGE?Number(row.r):null,rowNumber=modelRow||i+1,person={name,raw_name:rawName,phone:phones[0]||null,phones,rawPhones:phones,confidence:0,name_confidence:0,phone_confidence:0,pair_confidence:0,row_number:rowNumber,model_row_number:modelRow};if(!person.name&&!person.phone)continue;const key=personKey({...row,r:rowNumber,n:name});if(seen.has(key))continue;seen.add(key);people.push(person);if(people.length>=MAX_PEOPLE_PER_PAGE)break}return people}
function schema(){return{type:'json_schema',json_schema:{name:'scan_people',strict:true,schema:{type:'object',properties:{people:{type:'array',items:{type:'object',properties:{r:{type:'integer',minimum:1,maximum:50},n:{type:'string'},p:{type:'array',items:{type:'string'},maxItems:2}},required:['r','n','p'],additionalProperties:false}}},required:['people'],additionalProperties:false}}}}
function responseFormat(){return MODEL.supports_structured_output?schema():{type:'json_object'}}
function primaryPrompt(){return`You are the vision data-entry specialist for NYEOCARE. Your job is to transcribe a photographed handwritten register, including pages deliberately made difficult by humans. Return ONLY compact JSON: {"people":[{"r":1,"n":"Sis Sandra Isichei","p":["08039579788"]}]}.
FIRST: UNDERSTAND THE PAGE, THEN READ IT.
- Inspect the entire ORIGINAL image before extracting. Determine the true reading orientation from the writing, headings, ruled rows and page structure. The camera may be rotated 90, 180 or 270 degrees, or the page may be upside down. Mentally rotate/re-orient the page as needed and ALWAYS output people in the page's logical top-to-bottom reading order, never camera order.
- Do not assume the first visible edge is the top. Do not assume the largest text is a header. Establish orientation from multiple consistent clues.
- Perspective distortion, tilted/skewed capture, curved book/register binding, cropped edges, shadows, glare, folds, wrinkles, crumpling, stains, ink bleed, faded ink, dirty paper, ruled-line breaks and uneven lighting are noise, not structure. Follow the actual handwriting and row geometry through that noise.
- Never let a stain, fold, shadow, tear, glare or ruled line become a person, digit, title or separator.
- If writing is partly obscured, preserve what is genuinely readable; never hallucinate missing characters.
LAYOUT CONTRACT:
- Read the ORIGINAL page as a human data-entry clerk would. Identify every named-person row. Maximum 50 people.
- r is the physical named-person order on the page, starting at 1.
- A blank ruled line containing only a phone is NOT a new person row.
- If a phone is on a blank line immediately below a named person's line and before the next named person's name, treat it as a continuation phone for the PRECEDING person. Put it in that person's p array.
- Never pair phones by vertical proximity alone or by sequential list position. Pair using the physical ruled-row structure and neighboring names.
- One named person row = one JSON object. Never combine two named people and never split one named person.
- If a page is wrinkled or a row boundary is visually broken, reconstruct the row from the surviving horizontal/ruled geometry rather than inventing a new row.
- Do not stop early. Re-check the bottom of the page and the edges.
PHONE CONTRACT:
- Read ORIGINAL digits only. Never autocomplete, infer, repair, shift, borrow, substitute or normalize a digit to make a number look valid.
- Preserve leading 0 or +234 and internal digit order exactly as written.
- Support up to two genuine phones for one person.
- A continuation-line phone belongs to the preceding named row unless the page layout clearly proves otherwise.
- If a phone is genuinely unreadable, omit it rather than fabricating it.
- Never move a phone from one row to another because the number looks more plausible there.
NAME CONTRACT:
- Preserve meaningful visible titles and identifiers such as Sis, Sister, Bro, Brother, Mr, Mrs, Miss, Ms, Pastor, Rev, Reverend, Dr, Elder, Deacon, Bishop, Apostle and similar forms.
- Preserve meaningful hyphens/apostrophes and uncommon Nigerian/African names.
- Use language/name knowledge only to interpret handwriting, never to replace a clearly written uncommon name with a familiar spelling.
- If a name is genuinely unclear, use the best reading supported by visible strokes; do not invent a different person.
IGNORE:
- Headers, totals, dates, notes, signatures, page numbers and unrelated numbers.
SILENT ADVERSARIAL CHECK BEFORE ANSWERING:
1. Re-read the image at the correct orientation, even if it initially appeared upside down or sideways.
2. Count NAMED PEOPLE, not ink lines.
3. Trace every phone to its physical owner; specifically inspect blank continuation lines.
4. Check that no stain, fold, shadow, glare or ruled line was interpreted as data.
5. Check every digit without repairing it.
6. Check every name and title against the handwriting.
7. Re-check the first rows, middle rows and final two rows.
8. Ensure every named person appears exactly once and r is sequential by named-person order.
Return JSON only.`}
function verificationPrompt(candidate){return`You are the SECOND, independent quality-control reader for NYEOCARE. The ORIGINAL photographed register image is attached. A first vision pass produced the candidate transcription below.
Your task is NOT to trust the candidate. Re-read the ORIGINAL image from scratch, first determining the page's true orientation. The camera may have captured the page upside down, sideways, skewed, folded, wrinkled, stained, shadowed, dirty, faded, curved or partially distorted. Mentally rotate/re-orient it if necessary.
Then audit every row and return the CORRECTED final transcription in exactly this JSON shape: {"people":[{"r":1,"n":"Sis Sandra Isichei","p":["08039579788"]}]}.
QUALITY RULES:
- Use physical ruled-row geometry, not visual proximity or sequential phone position.
- A blank ruled line containing only a phone is a continuation of the preceding named person when it occurs before the next named person's name.
- Never shift phones because another row looks more plausible.
- Count named people, not ink lines.
- Ignore stains, folds, shadows, glare, tears, ink bleed and ruled-line artifacts; they are not characters or rows.
- Preserve titles and uncommon names supported by the handwriting.
- Read every phone digit from the ORIGINAL. Never repair, autocomplete, borrow or substitute digits.
- If the candidate is wrong, change it. If the candidate is correct, reproduce it.
- Do not invent unreadable text.
- Re-check the first, middle and final rows and verify r is sequential by named-person order.
CANDIDATE FROM FIRST PASS:
${candidate}
Return ONLY the audited JSON.`}
async function safeLog(data){try{return await logAIUsage(data)}catch{return null}}
function retryDelay(error,attempt){const header=Number(error?.retryAfter);if(Number.isFinite(header)&&header>0)return Math.min(header*1000+500,90000);const message=String(error?.message||''),seconds=message.match(/try again in\s+(\d+(?:\.\d+)?)s/i);if(seconds)return Math.min(Number(seconds[1])*1000+500,90000);return Math.min(1500*Math.pow(2,attempt-1),8000)}
function imageBytes(imageBase64){const raw=String(imageBase64||'').replace(/^data:[^;]+;base64,/,'');return Math.max(0,Math.floor(raw.length*.75))}
function estimateOutputBudget(imageBase64){const kb=imageBytes(imageBase64)/1024;let budget=DEFAULT_OUTPUT;if(kb<250)budget=Math.min(800,SAFE_OUTPUT_CEILING);else if(kb<500)budget=Math.min(850,SAFE_OUTPUT_CEILING);else budget=Math.min(900,SAFE_OUTPUT_CEILING);return Math.max(MIN_OUTPUT,Math.min(SAFE_OUTPUT_CEILING,budget))}
function classifyOutputLimit(message){const text=String(message||'').toLowerCase();return/output tokens per minute|otpm|requested\s+\d+.*(?:limit|max_tokens)|expected output tokens.*limit|reduce max_tokens|output.*token.*limit/.test(text)}
async function request(imageBase64,text,maxTokens,options){const started=Date.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),TIMEOUT),requestId=crypto.randomUUID();try{const safeMax=Math.max(MIN_OUTPUT,Math.min(SAFE_OUTPUT_CEILING,Math.floor(maxTokens))),body={model:MODEL.model,messages:[{role:'user',content:[{type:'text',text},{type:'image_url',image_url:{url:`data:image/jpeg;base64,${imageBase64}`}}]}],temperature:.05,top_p:.8,max_completion_tokens:safeMax,response_format:responseFormat()};if(MODEL.supports_reasoning_effort){body.reasoning_effort='none';body.reasoning_format='hidden'}const response=await fetch(GROQ_URL,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${GROQ_API_KEY}`},body:JSON.stringify(body),signal:controller.signal}),latency=Date.now()-started;let data={};try{data=await response.json()}catch{}const choice=data?.choices?.[0]||{},usage=data?.usage||{},headers=response.headers,common={organization_id:options.organization_id,job_id:options.job_id,request_id:requestId,provider:'groq',model:MODEL.model,model_key:MODEL_KEY,purpose:options.purpose||'scan',prompt_version:SCAN_PIPELINE_VERSION,attempt:options.attempt||1,input_tokens:Number(usage.prompt_tokens||0),output_tokens:Number(usage.completion_tokens||0),latency_ms:latency,rate_limit_remaining_tokens:headers.get('x-ratelimit-remaining-tokens'),rate_limit_remaining_requests:headers.get('x-ratelimit-remaining-requests'),rate_limit_reset_tokens:headers.get('x-ratelimit-reset-tokens'),rate_limit_reset_requests:headers.get('x-ratelimit-reset-requests'),retry_after:headers.get('retry-after'),requested_output_tokens:safeMax};if(!response.ok){const message=data?.error?.message||`Groq request failed with ${response.status}`,outputLimit=response.status===429&&classifyOutputLimit(message);await safeLog({...common,http_status:response.status,success:false,finish_reason:'error',retry_reason:message});throw Object.assign(new Error(message),{status:response.status,code:outputLimit?'AI_OUTPUT_LIMIT':undefined,retryable:!outputLimit&&[408,429,500,502,503,504].includes(response.status),retryAfter:headers.get('retry-after'),requested_output_tokens:safeMax})}const content=choice?.message?.content||'',finishReason=choice?.finish_reason||'stop';await safeLog({...common,http_status:response.status,success:true,finish_reason:finishReason});if(!content.trim())throw Object.assign(new Error('Groq returned an empty vision response'),{code:'EMPTY_AI_RESPONSE',retryable:true});if(finishReason==='length')throw Object.assign(new Error('ARIA could not safely finish reading this register.'),{code:'AI_OUTPUT_TRUNCATED',retryable:false,requested_output_tokens:safeMax});return{data,attempt:options.attempt||1,usage,requestId,maxTokens:safeMax}}catch(error){if(error?.name==='AbortError')throw Object.assign(new Error('Vision provider timed out'),{code:'AI_TIMEOUT',retryable:true});throw error}finally{clearTimeout(timer)}}
function normalizeResult(result,mode,budget,verification=null){const people=compactPeople(parseJSON(result?.data?.choices?.[0]?.message?.content||''));return{...result,data:{...result.data,choices:[{...(result.data?.choices?.[0]||{}),message:{...(result.data?.choices?.[0]?.message||{}),content:JSON.stringify({people})}}]},verification:{passes:verification?2:1,extracted:people.length,mode,reviewed:!!verification,reviewer_extracted:verification?.length||null},tokenPlan:{primary:budget,verification:verification?Math.min(800,SAFE_OUTPUT_CEILING):null,recovery:RECOVERY_MAX,min_output:MIN_OUTPUT,safe_ceiling:SAFE_OUTPUT_CEILING,provider_ceiling:PROVIDER_OUTPUT_CEILING,max_people_per_page:MAX_PEOPLE_PER_PAGE,adaptive:true,deduplicated:true,row_verified:true,orientation_resilient:true,adversarial_review:!!verification},vision:'groq-two-pass-orientation-row-aware-name-format',pipeline_version:SCAN_PIPELINE_VERSION}}
function canonicalCompactKey(person){return`${String(person?.name||'').trim().toLowerCase()}|${(Array.isArray(person?.phones)?person.phones:[]).map(v=>String(v).replace(/\D/g,'')).join(',')}`}
function compatibleVerification(primary,verified){if(!verified?.length||!primary?.length)return false;if(primary.length!==verified.length)return false;return primary.every((p,i)=>{const v=verified[i];return Number(p.row_number)===Number(v.row_number)&&!!p.name&&!!v.name})}
async function verifyPrimary(imageBase64,primary,options){const candidate=JSON.stringify({people:primary.map((p,i)=>({r:i+1,n:p.name,p:p.phones||[]}))});try{const result=await request(imageBase64,verificationPrompt(candidate),Math.min(800,SAFE_OUTPUT_CEILING),{...options,purpose:'scan_verification',attempt:(options.attempt||1)+1});const people=compactPeople(parseJSON(result.data?.choices?.[0]?.message?.content||''));return{result,people}}catch(error){return{error,people:[]}}}
export function getScanAdmission(){if(!GROQ_API_KEY)return{allowed:false,code:'AI_NOT_CONFIGURED',message:'ARIA scan is not configured.'};return{allowed:true,max_people_per_page:MAX_PEOPLE_PER_PAGE,max_output_tokens:SAFE_OUTPUT_CEILING,provider_output_ceiling:PROVIDER_OUTPUT_CEILING,safe_output_ceiling:SAFE_OUTPUT_CEILING,adaptive:true,row_verified:true,orientation_resilient:true,adversarial_review:true,pipeline_version:SCAN_PIPELINE_VERSION}}
export async function callVisionWithRetry(imageBase64,_unused,onProgress=null,options={}){if(!GROQ_API_KEY)throw Object.assign(new Error('GROQ_API_KEY is missing'),{code:'AI_NOT_CONFIGURED',retryable:false});if(typeof imageBase64!=='string'||imageBase64.length<1000)throw Object.assign(new Error('Invalid scan image'),{code:'INVALID_IMAGE',retryable:false});const outputBudget=estimateOutputBudget(imageBase64);let lastError=null;for(let attempt=1;attempt<=MAX_RETRIES;attempt++){try{onProgress?.('reading_page');let primary;try{primary=await request(imageBase64,primaryPrompt(),outputBudget,{...options,attempt,purpose:'scan_primary'})}catch(error){if(error?.code!=='AI_OUTPUT_TRUNCATED'||outputBudget>=SAFE_OUTPUT_CEILING)throw error;onProgress?.('rereading_original');primary=await request(imageBase64,primaryPrompt(),SAFE_OUTPUT_CEILING,{...options,attempt:attempt+1,purpose:'scan_primary_recovery'})}let primaryPeople=compactPeople(parseJSON(primary.data?.choices?.[0]?.message?.content||''));if(!primaryPeople.length){onProgress?.('rereading_original');const recovery=await request(imageBase64,primaryPrompt(),RECOVERY_MAX,{...options,attempt:attempt+1,purpose:'scan_empty_recovery'}),recoveryPeople=compactPeople(parseJSON(recovery.data?.choices?.[0]?.message?.content||''));if(!recoveryPeople.length)throw Object.assign(new Error('No people could be extracted from the register image'),{code:'NO_PEOPLE_EXTRACTED',retryable:false});onProgress?.('finalizing_scan');return normalizeResult(recovery,'recovery',outputBudget)}onProgress?.('auditing_rows');const verification=await verifyPrimary(imageBase64,primaryPeople,options);if(verification.people.length){if(compatibleVerification(primaryPeople,verification.people)){onProgress?.('finalizing_scan');return normalizeResult({...verification.result,attempt:Math.max(primary.attempt||attempt,verification.result.attempt||attempt)},'verified_two_pass',outputBudget,verification.people)}}onProgress?.('finalizing_scan');return normalizeResult(primary,'primary_with_qc',outputBudget,verification.people)}catch(error){lastError=error;if(error?.code==='AI_OUTPUT_LIMIT'||error?.code==='AI_OUTPUT_TRUNCATED'||attempt>=MAX_RETRIES||!error?.retryable)throw error;onProgress?.(error?.status===429?'provider_wait':'retrying');await sleep(retryDelay(error,attempt))}}throw lastError||new Error('Vision scan failed')}

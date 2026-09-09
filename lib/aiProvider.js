// lib/aiProvider.js
import{getModelConfig}from'./modelRegistry';
import{logAIUsage}from'./aiObserver';
import{reserveBudget,confirmReservation,cancelReservation}from'./budgetGuard';
import{randomUUID}from'crypto';

const GROQ_API_KEY=process.env.GROQ_API_KEY;
const GROQ_URL='https://api.groq.com/openai/v1/chat/completions';
const configuredModel=process.env.GROQ_VISION_MODEL_KEY;
const DEFAULT_MODEL_KEY=configuredModel==='groq-qwen3.6-27b'?'groq-qwen3.8-27b':configuredModel||'groq-qwen3.8-27b';
const OUTPUT_MAX=800;
const OUTPUT_RETRY_MAX=450;
const SAFETY=80;
const REQUEST_TIMEOUT_MS=60000;
const MAX_RETRY_AFTER_SEC=90;
const TPM_HEADROOM=3800;
const PROMPT_VERSION='v10-compact-json-vision';

function retryable(status){return[408,429,500,502,503,504].includes(status)}
function parseJSON(content){
let text=String(content||'').replace(/<think>[\s\S]*?<\/think>/gi,'').replace(/```json|```/gi,'').trim();
try{return JSON.parse(text)}catch{}
const object=text.match(/\{[\s\S]*\}/);
if(object)try{return JSON.parse(object[0])}catch{}
const array=text.match(/\[[\s\S]*\]/);
if(array)try{return{people:JSON.parse(array[0])}}catch{}
return null
}
function parseReset(v){
const m=String(v||'').match(/([\d.]+)(ms|s|m|h)/i);
if(!m)return 10000;
const n=Number(m[1]),u=m[2].toLowerCase();
return u==='ms'?n:u==='s'?n*1000:u==='m'?n*60000:n*3600000
}
function gate(){
const g=globalThis.__NYEOCARE_GROQ_GATE;
return g&&typeof g==='object'?g:null
}
function setGate(headers){
const remaining=Number(headers.get('x-ratelimit-remaining-tokens'));
const reset=headers.get('x-ratelimit-reset-tokens');
globalThis.__NYEOCARE_GROQ_GATE={remainingTokens:Number.isFinite(remaining)?remaining:null,resetTokens:reset,resetAt:Date.now()+parseReset(reset),updatedAt:Date.now()}
}
async function waitForCapacity(required){
const g=gate();
if(!g||g.remainingTokens===null||Date.now()>=Number(g.resetAt||0)||g.remainingTokens>=required)return;
const resetAt=Number(g.resetAt||0);
if(!Number.isFinite(resetAt)||resetAt<=Date.now())return;
await new Promise(r=>setTimeout(r,Math.min(Math.max(resetAt-Date.now(),1000),MAX_RETRY_AFTER_SEC*1000)))
}
export function getScanAdmission(){
if(!GROQ_API_KEY)return{allowed:false,code:'AI_NOT_CONFIGURED',message:'ARIA scan is not configured yet.'};
const g=gate(),remaining=g&&Number.isFinite(Number(g.remainingTokens))?Number(g.remainingTokens):null,resetAt=g&&Number.isFinite(Number(g.resetAt))?Number(g.resetAt):0;
if(remaining!==null&&Date.now()<resetAt&&remaining<TPM_HEADROOM)return{allowed:false,code:'AI_CAPACITY_LOW',message:'ARIA is waiting for enough provider capacity. Please try again shortly.',retry_after_seconds:Math.ceil((resetAt-Date.now())/1000)};
return{allowed:true,required_output_tokens:OUTPUT_MAX,safety_tokens:SAFETY}
}
function extractionPrompt(fallback=false){
return`You are ARIA, digitising a photographed handwritten attendance register. Read the ORIGINAL IMAGE itself. Accuracy is more important than completeness, but return every real person you can safely identify.

First understand the page structure. Identify the actual register rows and the name/phone columns. The page may be tilted, crooked, crowded, folded or uneven. Do not assume perfect horizontal alignment.

PAIRING: a phone belongs to a name only when the image visibly supports that relationship. Same-row placement is strongest. Also follow a clearly visible arrow, bracket, continuation mark, line or other explicit visual connection. Never pair by array position, proximity alone, or guessed correction.

NAME: preserve the written spelling and visible title such as Sis, Bro, Mrs, Pastor, Dr, Rev, Elder or Deacon. Never replace an unusual name with a common name.

PHONE: read every visible digit. Never invent, autocorrect or silently change digits. If a digit is genuinely unreadable, use null.

Do not use outside knowledge to reconstruct missing handwriting. Do not resurrect or infer people who are not actually visible in this image.

IGNORE headers, totals, notes, signatures, dates and non-person text. Never split one person's continued entry or merge different people.

For every real person return compact fields:
r=logical row number
n=name or null
p=phone as visibly written or null
c=0-100 confidence for the complete name+phone+pairing
rel=same_row, arrow_link, continuation, visual_link, or uncertain
e=null for same_row otherwise a very short visible-link description

Return JSON only:
{"people":[{"r":1,"n":"Sis Sandra","p":"08039579788","c":98,"rel":"same_row","e":null}]}

Do not add prose.${fallback?' Re-read the ORIGINAL IMAGE from scratch because the previous extraction found no usable people.':''}`
}
function normalizePerson(row){
const name=String(row?.n??row?.name??'').trim()||null;
const phone=String(row?.p??row?.phone??'').trim()||null;
const confidence=Math.max(0,Math.min(100,Number(row?.c??row?.confidence)||0));
const relation=String(row?.rel??row?.phone_relation??'uncertain').trim();
const evidence=row?.e??row?.link_evidence??null;
const rowNumber=Number(row?.r??row?.row_number);
return{row_number:Number.isInteger(rowNumber)?rowNumber:null,name,phone,name_confidence:confidence,phone_confidence:confidence,pair_confidence:confidence,phone_relation:relation,link_evidence:evidence==null?null:String(evidence).trim()||null}
}
function reconcile(extracted){
const draft=Array.isArray(extracted?.people)?extracted.people:Array.isArray(extracted)?extracted:[];
return draft.map(normalizePerson).filter(x=>x.name||x.phone).map(row=>{
const verified=!!row.name&&!!row.phone&&row.name_confidence>=98&&row.phone_confidence>=98&&row.pair_confidence>=98&&['same_row','arrow_link','continuation','visual_link'].includes(row.phone_relation)&&(row.phone_relation==='same_row'||!!row.link_evidence);
return{...row,verification_status:verified?'verified':'review',verification_reasons:verified?[]:['verification_threshold_not_met']}
})
}
async function callGroq(imageBase64,prompt,options={}){
if(!GROQ_API_KEY)throw Object.assign(new Error('AI service is not configured'),{status:503,retryable:false});
const{organization_id,job_id,purpose='scan',prompt_version=PROMPT_VERSION,attempt=1,evaluation=false,maxCompletionTokens=OUTPUT_MAX}=options;
await waitForCapacity(Math.min(TPM_HEADROOM,2048+maxCompletionTokens+900));
const config=getModelConfig(DEFAULT_MODEL_KEY);
let reservationId=null,settled=false;
if(!evaluation){
const budget=await reserveBudget(organization_id,purpose,DEFAULT_MODEL_KEY);
if(!budget.allowed)throw Object.assign(new Error('AI budget capacity is unavailable'),{status:429,retryable:false,code:'AI_BUDGET_UNAVAILABLE'});
reservationId=budget.reservationId
}
const requestId=randomUUID(),started=Date.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
try{
const body={model:config.model,messages:[{role:'user',content:[{type:'text',text:prompt},{type:'image_url',image_url:{url:`data:image/jpeg;base64,${imageBase64}`}}]}],temperature:.1,top_p:.9,max_completion_tokens:maxCompletionTokens,response_format:{type:'json_object'}};
if(config.supports_reasoning_effort){body.reasoning_effort='none';body.reasoning_format='hidden'}
const response=await fetch(GROQ_URL,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${GROQ_API_KEY}`},body:JSON.stringify(body),signal:controller.signal});
const latency=Date.now()-started;
setGate(response.headers);
let data={};
try{data=await response.json()}catch{}
const headers=response.headers,retryAfter=headers.get('retry-after'),finishReason=data?.choices?.[0]?.finish_reason||'stop';
if(!response.ok){
if(reservationId&&!settled){await cancelReservation(reservationId);settled=true}
if(!evaluation)await logAIUsage({organization_id,job_id,request_id:requestId,model_key:DEFAULT_MODEL_KEY,provider:'groq',model:config.model,purpose,prompt_version,attempt,latency_ms:latency,finish_reason:'error',http_status:response.status,success:false,retry_reason:data?.error?.message||`HTTP ${response.status}`,rate_limit_remaining_tokens:headers.get('x-ratelimit-remaining-tokens'),rate_limit_remaining_requests:headers.get('x-ratelimit-remaining-requests'),rate_limit_reset_tokens:headers.get('x-ratelimit-reset-tokens'),rate_limit_reset_requests:headers.get('x-ratelimit-reset-requests'),retry_after:retryAfter});
throw Object.assign(new Error(data?.error?.message||'AI service temporarily unavailable'),{status:response.status,retryable:retryable(response.status),retryAfter,rateLimitedOutput:/OTPM|output tokens per minute/i.test(data?.error?.message||'')})
}
const content=data?.choices?.[0]?.message?.content,usage=data?.usage||{},inputTokens=Number(usage.prompt_tokens||0),outputTokens=Number(usage.completion_tokens||0);
if(typeof content!=='string'||!content.trim())throw Object.assign(new Error('ARIA produced an empty response'),{status:502,retryable:false,code:'EMPTY_AI_RESPONSE'});
if(finishReason==='length')throw Object.assign(new Error('ARIA reached the safe output limit while reading the register.'),{status:502,retryable:false,code:'AI_OUTPUT_TRUNCATED'});
const actualCost=inputTokens/1000*config.input_cost_per_1k+outputTokens/1000*config.output_cost_per_1k;
if(reservationId&&!evaluation){
if(!await confirmReservation(reservationId,actualCost))throw Object.assign(new Error('AI accounting confirmation failed'),{status:500,retryable:false,code:'AI_ACCOUNTING_ERROR'});
settled=true
}
if(!evaluation)await logAIUsage({organization_id,job_id,request_id:requestId,model_key:DEFAULT_MODEL_KEY,provider:'groq',model:config.model,purpose,prompt_version,attempt,input_tokens:inputTokens,output_tokens:outputTokens,latency_ms:latency,finish_reason:finishReason,http_status:response.status,success:true,retry_reason:null,rate_limit_remaining_tokens:headers.get('x-ratelimit-remaining-tokens'),rate_limit_remaining_requests:headers.get('x-ratelimit-remaining-requests'),rate_limit_reset_tokens:headers.get('x-ratelimit-reset-tokens'),rate_limit_reset_requests:headers.get('x-ratelimit-reset-requests'),retry_after:retryAfter});
return{data,provider:'groq',model:config.model,modelKey:DEFAULT_MODEL_KEY,requestId,usage:{prompt_tokens:inputTokens,completion_tokens:outputTokens},attempt,finishReason}
}catch(err){
if(reservationId&&!settled)try{await cancelReservation(reservationId)}catch{}
throw err
}finally{clearTimeout(timer)}
}
export async function callVisionWithRetry(imageBase64,_unusedLayout,onProgress=null,options={}){
const admission=getScanAdmission();
if(!admission.allowed)throw Object.assign(new Error(admission.message),{status:429,retryable:false,code:admission.code,retryAfter:admission.retry_after_seconds});
if(typeof imageBase64!=='string'||imageBase64.length<1000)throw Object.assign(new Error('Invalid scan image.'),{status:400,retryable:false,code:'INVALID_IMAGE'});
let lastError=null;
for(let attempt=1;attempt<=3;attempt++){
try{
onProgress?.('reading_page');
const cap=attempt===1?OUTPUT_MAX:OUTPUT_RETRY_MAX;
const result=await callGroq(imageBase64,extractionPrompt(false),{...options,attempt,maxCompletionTokens:cap});
let parsed=parseJSON(result.data?.choices?.[0]?.message?.content||''),people=reconcile(parsed);
if(!people.length){
onProgress?.('retrying',1200);
const fallbackAttempt=attempt+1;
const fallback=await callGroq(imageBase64,extractionPrompt(true),{...options,attempt:fallbackAttempt,maxCompletionTokens:OUTPUT_RETRY_MAX});
parsed=parseJSON(fallback.data?.choices?.[0]?.message?.content||'');
people=reconcile(parsed);
if(people.length){
onProgress?.('finalizing_scan');
return{...fallback,data:{...fallback.data,choices:[{...(fallback.data.choices?.[0]||{}),message:{...(fallback.data.choices?.[0]?.message||{}),content:JSON.stringify({people})}}]},attempt:fallbackAttempt,verification:{passes:2,extracted:people.length,verified:people.filter(x=>x.verification_status==='verified').length,review:people.filter(x=>x.verification_status!=='verified').length},tokenPlan:{extract_max:OUTPUT_MAX,recovery_max:OUTPUT_RETRY_MAX,safety:SAFETY},vision:'groq-json-object-recovery'}
}
}
if(!people.length)throw Object.assign(new Error('ARIA could not extract any usable register entries after re-reading the original image.'),{status:502,retryable:false,code:'NO_PEOPLE_EXTRACTED'});
onProgress?.('finalizing_scan');
return{...result,data:{...result.data,choices:[{...(result.data.choices?.[0]||{}),message:{...(result.data.choices?.[0]?.message||{}),content:JSON.stringify({people})}}]},attempt,verification:{passes:1,extracted:people.length,verified:people.filter(x=>x.verification_status==='verified').length,review:people.filter(x=>x.verification_status!=='verified').length},tokenPlan:{extract_max:OUTPUT_MAX,recovery_max:OUTPUT_RETRY_MAX,safety:SAFETY},vision:'groq-json-object-vision'}
}catch(err){
lastError=err;
if(err.rateLimitedOutput&&attempt<3){
const delay=Number.isFinite(Number(err.retryAfter))?Math.min(Number(err.retryAfter),MAX_RETRY_AFTER_SEC)*1000:30000;
onProgress?.('retrying',delay);
await new Promise(r=>setTimeout(r,delay));
continue
}
if(!err.retryable||attempt>=3)throw err;
const delay=Number.isFinite(Number(err.retryAfter))?Math.min(Number(err.retryAfter),MAX_RETRY_AFTER_SEC)*1000:Math.min(3000*Math.pow(2,attempt-1),30000);
onProgress?.('retrying',delay);
await new Promise(r=>setTimeout(r,delay))
}
}
throw lastError||new Error('ARIA scan failed safely')
  }

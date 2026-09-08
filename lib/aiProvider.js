// lib/aiProvider.js
import{getModelConfig}from'./modelRegistry';
import{logAIUsage}from'./aiObserver';
import{reserveBudget,confirmReservation,cancelReservation}from'./budgetGuard';
import{randomUUID}from'crypto';

const GROQ_API_KEY=process.env.GROQ_API_KEY;
const GROQ_URL='https://api.groq.com/openai/v1/chat/completions';
const configuredModel=process.env.GROQ_VISION_MODEL_KEY;
const DEFAULT_MODEL_KEY=configuredModel==='groq-qwen3.6-27b'?'groq-qwen3.8-27b':configuredModel||'groq-qwen3.8-27b';
const EXTRACT_MAX=720;
const SAFETY=80;
const SCAN_OUTPUT_NEED=EXTRACT_MAX+SAFETY;
const REQUEST_TIMEOUT_MS=60000;
const MAX_RETRY_AFTER_SEC=90;
const COMBINED_HEADROOM=720;
const PROMPT_VERSION='v9-single-pass-vision';

const scanSchema={type:'object',properties:{people:{type:'array',items:{type:'object',properties:{row_number:{type:'integer'},name:{type:['string','null']},phone:{type:['string','null']},name_confidence:{type:'number'},phone_confidence:{type:'number'},pair_confidence:{type:'number'},phone_relation:{type:'string',enum:['same_row','arrow_link','continuation','visual_link','uncertain']},link_evidence:{type:['string','null']}},required:['row_number','name','phone','name_confidence','phone_confidence','pair_confidence','phone_relation','link_evidence'],additionalProperties:false}}},required:['people'],additionalProperties:false};

function retryable(status){return[408,429,500,502,503,504].includes(status)}
function parseJSON(content){try{return JSON.parse(String(content||'').replace(/<think>[\s\S]*?<\/think>/gi,'').trim())}catch{return null}}
function parseReset(v){const m=String(v||'').match(/([\d.]+)(ms|s|m|h)/i);if(!m)return 10000;const n=Number(m[1]),u=m[2].toLowerCase();return u==='ms'?n:u==='s'?n*1000:u==='m'?n*60000:n*3600000}
function gate(){const g=globalThis.__NYEOCARE_GROQ_GATE;return g&&typeof g==='object'?g:null}
function setGate(headers){const remaining=Number(headers.get('x-ratelimit-remaining-tokens'));const reset=headers.get('x-ratelimit-reset-tokens');globalThis.__NYEOCARE_GROQ_GATE={remainingTokens:Number.isFinite(remaining)?remaining:null,resetTokens:reset,resetAt:Date.now()+parseReset(reset),updatedAt:Date.now()}}
async function waitForCapacity(required){const g=gate();if(!g)return;if(g.remainingTokens===null||Date.now()>=Number(g.resetAt||0)||g.remainingTokens>=required)return;const resetAt=Number(g.resetAt||0);if(!Number.isFinite(resetAt)||resetAt<=Date.now())return;const wait=Math.min(Math.max(resetAt-Date.now(),1000),MAX_RETRY_AFTER_SEC*1000);await new Promise(r=>setTimeout(r,wait))}
export function getScanAdmission(){if(!GROQ_API_KEY)return{allowed:false,code:'AI_NOT_CONFIGURED',message:'ARIA scan is not configured yet.'};const g=gate(),remaining=g&&Number.isFinite(Number(g.remainingTokens))?Number(g.remainingTokens):null,resetAt=g&&Number.isFinite(Number(g.resetAt))?Number(g.resetAt):0;if(remaining!==null&&Date.now()<resetAt&&remaining<COMBINED_HEADROOM)return{allowed:false,code:'AI_CAPACITY_LOW',message:'ARIA is waiting for enough provider capacity. Please try again shortly.',retry_after_seconds:Math.ceil((resetAt-Date.now())/1000)};return{allowed:true,required_output_tokens:EXTRACT_MAX,safety_tokens:SAFETY}}

function extractionPrompt(){return`You are ARIA, safely digitising the ORIGINAL handwritten register image.

Perform ONE complete visual pass. Read the page yourself, understand its real rows and columns, then VERIFY every extracted person against the ORIGINAL IMAGE before returning the result. Do not use positional guessing, independent OCR pairing, array position, or invented corrections.

For every real person entry return exactly one object. Ignore headers, totals, notes, signatures, dates and non-person text. Never split one person's continued writing into two people and never merge nearby people unless the page visibly connects them.

NAME: preserve the written name and visible honorific. Do not normalize spelling into a common name.
PHONE: read every visible digit. Do not invent or autocorrect digits. If a digit is genuinely unreadable, return phone null.
PAIRING: a phone can belong to a name on the same row, another row, or a displaced position when an explicit arrow, bracket, continuation, line or other strong visual link proves the relationship. Never invent a link.

phone_relation must be same_row, arrow_link, continuation, visual_link, or uncertain. link_evidence is null for same_row; otherwise use a very short description of the visible link, 8 words or fewer.

CONFIDENCE is 0-100. name_confidence means the name is read correctly; phone_confidence means every phone digit is correct; pair_confidence means the phone definitely belongs to that person.

SAFETY: uncertain information is better than a guess. Return every person you can safely identify, but do not fabricate missing digits. Before returning, re-check the whole image and each row once more.

OUTPUT: JSON only, no prose, no markdown. Keep JSON compact. Return all people in the image.`}

function reconcile(extracted){
const draft=Array.isArray(extracted?.people)?extracted.people:[];
return draft.map(row=>{
const name=String(row?.name||'').trim()||null,phone=String(row?.phone||'').trim()||null,relation=String(row?.phone_relation||'uncertain'),nameConfidence=Number(row?.name_confidence)||0,phoneConfidence=Number(row?.phone_confidence)||0,pairConfidence=Number(row?.pair_confidence)||0;
const verified=!!name&&!!phone&&nameConfidence>=95&&phoneConfidence>=95&&pairConfidence>=98&&relation!=='uncertain'&&(relation==='same_row'||!!row?.link_evidence);
return{...row,name,phone,name_confidence:nameConfidence,phone_confidence:phoneConfidence,pair_confidence:pairConfidence,verification_status:verified?'verified':'review',verification_reasons:verified?[]:['verification_threshold_not_met']
}).filter(x=>x.name||x.phone)
}

async function callGroq(imageBase64,prompt,schema,options={}){
if(!GROQ_API_KEY)throw Object.assign(new Error('AI service is not configured'),{status:503,retryable:false});
const{organization_id,job_id,purpose='scan',prompt_version=PROMPT_VERSION,attempt=1,evaluation=false,maxCompletionTokens=EXTRACT_MAX}=options;
await waitForCapacity(Math.min(COMBINED_HEADROOM,maxCompletionTokens));
const config=getModelConfig(DEFAULT_MODEL_KEY);
let reservationId=null,settled=false;
if(!evaluation){const budget=await reserveBudget(organization_id,purpose,DEFAULT_MODEL_KEY);if(!budget.allowed)throw Object.assign(new Error('AI budget capacity is unavailable'),{status:429,retryable:false});reservationId=budget.reservationId}
const requestId=randomUUID(),started=Date.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
try{
const body={model:config.model,messages:[{role:'user',content:[{type:'text',text:prompt},{type:'image_url',image_url:{url:`data:image/jpeg;base64,${imageBase64}`}}]}],temperature:.05,top_p:.9,max_completion_tokens:maxCompletionTokens};
if(config.supports_reasoning_effort)body.reasoning_effort='none';
if(config.supports_reasoning_effort)body.reasoning_format='hidden';
body.response_format=config.supports_structured_output?{type:'json_schema',json_schema:{name:'register_scan',strict:true,schema}}:{type:'json_object'};
const response=await fetch(GROQ_URL,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${GROQ_API_KEY}`},body:JSON.stringify(body),signal:controller.signal});
const latency=Date.now()-started;
setGate(response.headers);
let data={};try{data=await response.json()}catch{}
const retryAfter=response.headers.get('retry-after');
if(!response.ok){
if(reservationId&&!settled){await cancelReservation(reservationId);settled=true}
if(!evaluation)await logAIUsage({organization_id,job_id,request_id:requestId,model_key:DEFAULT_MODEL_KEY,provider:'groq',model:config.model,purpose,prompt_version,attempt,latency_ms:latency,finish_reason:'error',http_status:response.status,success:false,retry_reason:data?.error?.message||`HTTP ${response.status}`,rate_limit_remaining_tokens:response.headers.get('x-ratelimit-remaining-tokens'),rate_limit_reset_tokens:response.headers.get('x-ratelimit-reset-tokens'),retry_after:retryAfter});
throw Object.assign(new Error(data?.error?.message||'AI service temporarily unavailable'),{status:response.status,retryable:retryable(response.status),retryAfter})
}
const content=data?.choices?.[0]?.message?.content,usage=data?.usage||{},inputTokens=Number(usage.prompt_tokens||0),outputTokens=Number(usage.completion_tokens||0),finishReason=data?.choices?.[0]?.finish_reason||'stop';
if(typeof content!=='string'||!content.trim())throw Object.assign(new Error('ARIA produced an empty response'),{status:502,retryable:false,code:'EMPTY_AI_RESPONSE'});
const parsed=parseJSON(content);
if(!parsed||!Array.isArray(parsed.people)||!parsed.people.length)throw Object.assign(new Error(finishReason==='length'?'ARIA could not finish the register within the safe output limit. Please use a clearer, closer photo or split a very large register into two scans.':'ARIA returned no safe register entries.'),{status:502,retryable:false,code:finishReason==='length'?'AI_OUTPUT_TRUNCATED':'NO_PEOPLE_EXTRACTED'});
const actualCost=inputTokens/1000*config.input_cost_per_1k+outputTokens/1000*config.output_cost_per_1k;
if(reservationId&&!evaluation){if(!await confirmReservation(reservationId,actualCost))throw Object.assign(new Error('AI accounting confirmation failed'),{status:500,retryable:false});settled=true}
if(!evaluation)await logAIUsage({organization_id,job_id,request_id:requestId,model_key:DEFAULT_MODEL_KEY,provider:'groq',model:config.model,purpose,prompt_version,attempt,input_tokens:inputTokens,output_tokens:outputTokens,latency_ms:latency,finish_reason:finishReason,http_status:response.status,success:true,retry_reason:null,rate_limit_remaining_tokens:response.headers.get('x-ratelimit-remaining-tokens'),rate_limit_reset_tokens:response.headers.get('x-ratelimit-reset-tokens'),retry_after:retryAfter});
return{data,provider:'groq',model:config.model,modelKey:DEFAULT_MODEL_KEY,requestId,usage:{prompt_tokens:inputTokens,completion_tokens:outputTokens},attempt,finishReason}
}catch(err){if(reservationId&&!settled)try{await cancelReservation(reservationId)}catch{}throw err}finally{clearTimeout(timer)}
}

export async function callVisionWithRetry(imageBase64,_unusedLayout,onProgress=null,options={}){
const admission=getScanAdmission();
if(!admission.allowed)throw Object.assign(new Error(admission.message),{status:429,retryable:false,code:admission.code,retryAfter:admission.retry_after_seconds});
if(typeof imageBase64!=='string'||imageBase64.length<1000)throw Object.assign(new Error('Invalid scan image.'),{status:400,retryable:false,code:'INVALID_IMAGE'});
let lastError=null;
for(let attempt=1;attempt<=2;attempt++)try{
onProgress?.('reading_page');
const result=await callGroq(imageBase64,extractionPrompt(),scanSchema,{...options,attempt,maxCompletionTokens:EXTRACT_MAX});
const parsed=parseJSON(result.data?.choices?.[0]?.message?.content||''),people=reconcile(parsed);
if(!people.length)throw Object.assign(new Error('ARIA could not safely verify any register entries'),{status:502,retryable:false,code:'NO_VERIFIED_ROWS'});
onProgress?.('finalizing_scan');
return{...result,data:{...result.data,choices:[{...(result.data.choices?.[0]||{}),message:{...(result.data.choices?.[0]?.message||{}),content:JSON.stringify({people})}}]},attempt,verification:{passes:1,extracted:people.length,verified:people.filter(x=>x.verification_status==='verified').length,review:people.filter(x=>x.verification_status!=='verified').length},tokenPlan:{extract_max:EXTRACT_MAX,audit_max:0,safety:SAFETY,total_reserved:SCAN_OUTPUT_NEED},vision:'direct-groq-single-pass'}
}catch(err){
lastError=err;
if(!err.retryable||attempt>=2)throw err;
const delay=Number.isFinite(Number(err.retryAfter))?Math.min(Number(err.retryAfter),MAX_RETRY_AFTER_SEC)*1000:Math.min(3000*Math.pow(2,attempt-1),30000);
onProgress?.('retrying',delay);
await new Promise(r=>setTimeout(r,delay))
}
throw lastError||new Error('ARIA scan failed safely');
  }

// lib/aiProvider.js
import{getModelConfig}from'./modelRegistry';
import{logAIUsage}from'./aiObserver';
const GROQ_API_KEY=process.env.GROQ_API_KEY;
const GROQ_URL='https://api.groq.com/openai/v1/chat/completions';
const configuredModel=process.env.GROQ_VISION_MODEL_KEY;
const MODEL_KEY=configuredModel==='groq-qwen3.6-27b'?'groq-qwen3.8-27b':configuredModel||'groq-qwen3.8-27b';
const MODEL=getModelConfig(MODEL_KEY);
const OUTPUT_MAX=Math.min(900,MODEL.max_completion_tokens||900);
const RECOVERY_MAX=Math.min(600,MODEL.max_completion_tokens||600);
const TIMEOUT=90000;
const MAX_RETRIES=3;
const PIPELINE_VERSION='v11-smart-token-vision';

function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function parseJSON(text){
if(!text||typeof text!=='string')return null;
const cleaned=text.replace(/<think>[\s\S]*?<\/think>/gi,'').replace(/```json/gi,'').replace(/```/g,'').trim();
try{return JSON.parse(cleaned)}catch{}
const object=cleaned.match(/\{[\s\S]*\}/);
if(object)try{return JSON.parse(object[0])}catch{}
const array=cleaned.match(/\[[\s\S]*\]/);
if(array)try{return{people:JSON.parse(array[0])}}catch{}
return null
}
function compactPeople(parsed){
const rows=Array.isArray(parsed?.people)?parsed.people:Array.isArray(parsed)?parsed:[];
return rows.map(x=>{
const confidence=Math.max(0,Math.min(100,Number(x?.c??x?.confidence??x?.pair_confidence)||0));
const relation=String(x?.rel??x?.phone_relation??'uncertain').trim();
return{
row_number:Number.isInteger(Number(x?.r??x?.row_number))?Number(x.r??x.row_number):null,
name:String(x?.n??x?.name??'').trim()||null,
phone:String(x?.p??x?.phone??'').trim()||null,
confidence,
name_confidence:confidence,
phone_confidence:confidence,
pair_confidence:confidence,
phone_relation:relation,
link_evidence:x?.e==null?null:String(x.e).trim()||null,
verification_status:confidence>=98&&relation!=='uncertain'?'verified':'review',
verification_reasons:confidence>=98&&relation!=='uncertain'?[]:['verification_threshold_not_met']
}
}).filter(x=>x.name||x.phone)
}
function prompt(recovery=false){
return`Read the ORIGINAL photographed attendance register carefully.

This is handwriting recognition, not a text-generation task. Understand the page layout before extracting rows. The page may be tilted, crowded, folded, faint or uneven.

Find real people only. Ignore headers, totals, dates, notes, signatures and other non-person text.

For every visible person:
- Preserve the written name and honorific.
- Read the phone digits exactly as visible.
- NEVER invent missing digits.
- NEVER autocorrect a phone number from memory.
- Pair a phone with a person only when the image visibly supports it.
- Same-row pairing is strongest.
- Also accept an explicit arrow, line, bracket or continuation mark.
- Never pair merely because two values are nearby.
- Never split one person into multiple people.
- Never merge two people.
- Do not use outside knowledge to repair handwriting.

Return ONLY compact JSON:
{"people":[{"r":1,"n":"Sis Sandra","p":"08039579788","c":99,"rel":"same_row","e":null}]}

c is your confidence from 0-100 for the COMPLETE name, phone and pairing.
rel must be same_row, arrow_link, continuation, visual_link or uncertain.
e is null for same_row, otherwise a short description of the visible connection.

If a phone cannot be safely read, use null rather than guessing.
If a name cannot be safely read, use null rather than guessing.
${recovery?'Re-read the ORIGINAL IMAGE from the beginning. The previous pass produced no usable entries. Do not explain anything; return JSON only.':''}`
}
async function safeLog(data){
try{await logAIUsage(data)}catch{}
}
function retryDelay(response,attempt){
const retryAfter=Number(response?.headers?.get('retry-after'));
if(Number.isFinite(retryAfter)&&retryAfter>0)return Math.min(retryAfter*1000,60000);
return Math.min(2000*Math.pow(2,attempt-1),15000)
}
async function request(imageBase64,text,maxTokens,options,attempt){
const started=Date.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),TIMEOUT);
try{
const body={
model:MODEL.model,
messages:[{role:'user',content:[
{type:'text',text},
{type:'image_url',image_url:{url:`data:image/jpeg;base64,${imageBase64}`}}
]}],
temperature:.1,
top_p:.9,
max_completion_tokens:maxTokens,
response_format:{type:'json_object'}
};
if(MODEL.supports_reasoning_effort){body.reasoning_effort='none';body.reasoning_format='hidden'}
const response=await fetch(GROQ_URL,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${GROQ_API_KEY}`},body:JSON.stringify(body),signal:controller.signal});
const latency=Date.now()-started;
let data={};
try{data=await response.json()}catch{}
const usage=data?.usage||{};
const headers=response.headers;
if(!response.ok){
await safeLog({organization_id:options.organization_id,job_id:options.job_id,provider:'groq',model:MODEL.model,model_key:MODEL_KEY,purpose:options.purpose||'scan',prompt_version:PIPELINE_VERSION,attempt,input_tokens:Number(usage.prompt_tokens||0),output_tokens:Number(usage.completion_tokens||0),latency_ms:latency,http_status:response.status,success:false,finish_reason:'error',retry_reason:data?.error?.message||`HTTP ${response.status}`,rate_limit_remaining_tokens:headers.get('x-ratelimit-remaining-tokens'),rate_limit_reset_tokens:headers.get('x-ratelimit-reset-tokens'),retry_after:headers.get('retry-after')});
const error=new Error(data?.error?.message||`Groq request failed with ${response.status}`);
error.status=response.status;
error.rateLimited=response.status===429;
error.retryable=[408,429,500,502,503,504].includes(response.status);
throw error
}
const content=data?.choices?.[0]?.message?.content||'';
const finishReason=data?.choices?.[0]?.finish_reason||'stop';
await safeLog({organization_id:options.organization_id,job_id:options.job_id,provider:'groq',model:MODEL.model,model_key:MODEL_KEY,purpose:options.purpose||'scan',prompt_version:PIPELINE_VERSION,attempt,input_tokens:Number(usage.prompt_tokens||0),output_tokens:Number(usage.completion_tokens||0),latency_ms:latency,http_status:response.status,success:true,finish_reason:finishReason,retry_reason:null,rate_limit_remaining_tokens:headers.get('x-ratelimit-remaining-tokens'),rate_limit_reset_tokens:headers.get('x-ratelimit-reset-tokens'),retry_after:headers.get('retry-after')});
if(!content.trim())throw Object.assign(new Error('Groq returned an empty vision response'),{code:'EMPTY_AI_RESPONSE',retryable:false});
if(finishReason==='length')throw Object.assign(new Error('Groq response reached its output limit'),{code:'AI_OUTPUT_TRUNCATED',retryable:false});
return{data,attempt,usage}
}finally{clearTimeout(timer)}
}
export function getScanAdmission(){
if(!GROQ_API_KEY)return{allowed:false,code:'AI_NOT_CONFIGURED',message:'ARIA scan is not configured.'};
return{allowed:true}
}
export async function callVisionWithRetry(imageBase64,_unused,onProgress=null,options={}){
if(!GROQ_API_KEY)throw Object.assign(new Error('GROQ_API_KEY is missing'),{code:'AI_NOT_CONFIGURED',retryable:false});
if(typeof imageBase64!=='string'||imageBase64.length<1000)throw Object.assign(new Error('Invalid scan image'),{code:'INVALID_IMAGE',retryable:false});
let lastError=null;
for(let attempt=1;attempt<=MAX_RETRIES;attempt++){
try{
onProgress?.('reading_page');
const first=await request(imageBase64,prompt(false),OUTPUT_MAX,options,attempt);
let parsed=parseJSON(first.data?.choices?.[0]?.message?.content||''),people=compactPeople(parsed);
if(people.length){
onProgress?.('finalizing_scan');
return{...first,data:{...first.data,choices:[{...(first.data.choices?.[0]||{}),message:{...(first.data.choices?.[0]?.message||{}),content:JSON.stringify({people})}}]},verification:{passes:1,extracted:people.length,verified:people.filter(x=>x.verification_status==='verified').length,review:people.filter(x=>x.verification_status!=='verified').length},tokenPlan:{primary:OUTPUT_MAX,recovery:RECOVERY_MAX},vision:'groq-smart-token-vision',pipeline_version:PIPELINE_VERSION}
}
onProgress?.('rereading_original');
const recovery=await request(imageBase64,prompt(true),RECOVERY_MAX,{...options,purpose:'scan_recovery'},attempt+1);
parsed=parseJSON(recovery.data?.choices?.[0]?.message?.content||'');
people=compactPeople(parsed);
if(people.length){
onProgress?.('finalizing_scan');
return{...recovery,data:{...recovery.data,choices:[{...(recovery.data.choices?.[0]||{}),message:{...(recovery.data.choices?.[0]?.message||{}),content:JSON.stringify({people})}}]},verification:{passes:2,extracted:people.length,verified:people.filter(x=>x.verification_status==='verified').length,review:people.filter(x=>x.verification_status!=='verified').length},tokenPlan:{primary:OUTPUT_MAX,recovery:RECOVERY_MAX},vision:'groq-smart-token-recovery',pipeline_version:PIPELINE_VERSION}
}
throw Object.assign(new Error('No usable people were found in the register image'),{code:'NO_PEOPLE_EXTRACTED',retryable:false})
}catch(err){
lastError=err;
if(err.rateLimited&&attempt<MAX_RETRIES){
onProgress?.('provider_wait');
await sleep(retryDelay(err,attempt));
continue
}
if(!err.retryable||attempt>=MAX_RETRIES)throw err;
await sleep(retryDelay(err,attempt))
}
}
throw lastError||new Error('Vision scan failed')
  }

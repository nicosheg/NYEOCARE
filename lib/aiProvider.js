// lib/aiProvider.js
import{getModelConfig}from'./modelRegistry';
import{logAIUsage}from'./aiObserver';
import{reserveBudget,confirmReservation,cancelReservation}from'./budgetGuard';
import{randomUUID}from'crypto';

const GROQ_API_KEY=process.env.GROQ_API_KEY;
const GROQ_URL='https://api.groq.com/openai/v1/chat/completions';
const configuredModel=process.env.GROQ_VISION_MODEL_KEY;
const DEFAULT_MODEL_KEY=configuredModel==='groq-qwen3.6-27b'?'groq-qwen3.8-27b':configuredModel||'groq-qwen3.8-27b';
const REQUEST_TIMEOUT_MS=60000;
const MAX_RETRY_AFTER_SEC=60;

const schema={
type:'object',
properties:{
people:{
type:'array',
items:{
type:'object',
properties:{
row_number:{type:'integer'},
name:{type:['string','null']},
phone:{type:['string','null']},
confidence:{type:'number'}
},
required:['row_number','name','phone','confidence'],
additionalProperties:false
}
}
},
required:['people'],
additionalProperties:false
};

function retryable(status){return[408,429,500,502,503,504].includes(status)}

function suspicious(content){
try{
const parsed=JSON.parse(String(content||''));
const people=Array.isArray(parsed.people)?parsed.people:[];
if(!people.length)return true;
return people.some(p=>{
const n=String(p?.name||'').trim(),phone=String(p?.phone||'').trim();
const digits=n.replace(/\D/g,'');
const header=/^(name|names|phone|phones|mobile|number|telephone|contact)$/i.test(n);
return !n||header||digits.length>=7||!phone||Number(p?.confidence||0)<60;
});
}catch{return true}
}

function promptFor(verification,draft){
const base=`You are ARIA, a high-accuracy register digitisation engine. Read the photographed register itself, not assumptions. The register contains rows where a person's NAME and PHONE belong to the SAME physical row. Preserve that row pairing exactly.

Extract every genuine person row that is visibly readable.

CRITICAL RULES:
- Never move a phone number from one row to another.
- Never put a phone number in the name field.
- Never put column headers such as NAME, NAMES, PHONE, MOBILE, NUMBER or CONTACT into people.
- Never invent missing characters.
- If a name is unreadable, use null.
- If a phone is unreadable, use null.
- If a row contains only a phone number, keep it as a row with name=null so it can be reviewed.
- Ignore column headers, totals, dates, notes and decorative text.
- Keep names exactly as visually written except for surrounding whitespace.
- Keep phone digits exactly as visually visible; do not invent a country code.
- Preserve row_number according to the physical order from top to bottom.
- Return all visible person rows, including rows with one unreadable field.
- Do not merge two different physical rows.
- Do not split one physical row into two people.
- Accuracy is more important than completeness.
- JSON only.`;
if(!verification)return base+`\nThis is the first extraction pass. Inspect the whole image carefully before producing the JSON.`;
return base+`\nThis is a verification pass. Re-read the ORIGINAL IMAGE from scratch, then compare it with the draft below. Correct every row-level error you find. The draft is NOT authoritative and may be wrong.\nDRAFT:\n${draft}`;
}

async function callGroq(imageBase64,options={}){
if(!GROQ_API_KEY)throw Object.assign(new Error('AI service is not configured'),{status:503,retryable:false});
if(!imageBase64||typeof imageBase64!=='string'||imageBase64.length<10)throw Object.assign(new Error('Invalid image data'),{status:400,retryable:false});
const{organization_id,job_id,purpose='scan',prompt_version='v4',attempt=1,evaluation=false,verification=false,draft=''}=options;
const config=getModelConfig(DEFAULT_MODEL_KEY);
let reservationId=null,settled=false;
if(!evaluation){
const budget=await reserveBudget(organization_id,purpose,DEFAULT_MODEL_KEY);
if(!budget.allowed)throw Object.assign(new Error('AI service temporarily unavailable'),{status:429,retryable:false});
reservationId=budget.reservationId;
}
const requestId=randomUUID(),started=Date.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
try{
const response=await fetch(GROQ_URL,{
method:'POST',
headers:{'Content-Type':'application/json',Authorization:`Bearer ${GROQ_API_KEY}`},
body:JSON.stringify({
model:config.model,
messages:[{role:'user',content:[{type:'text',text:promptFor(verification,draft)},{type:'image_url',image_url:{url:`data:image/jpeg;base64,${imageBase64}`}}]}],
temperature:verification?.2:.2,
top_p:.95,
max_completion_tokens:config.max_completion_tokens,
reasoning_effort:config.supports_reasoning_effort?'high':'none',
reasoning_format:'hidden',
response_format:config.supports_structured_output?{type:'json_schema',json_schema:{name:'register_people',strict:true,schema}}:{type:'json_object'}
}),
signal:controller.signal
});
const latency=Date.now()-started;
let data={};try{data=await response.json()}catch{}
const headers=response.headers,retryAfter=headers.get('retry-after');
if(!response.ok){
if(reservationId&&!settled){await cancelReservation(reservationId);settled=true}
if(!evaluation)await logAIUsage({organization_id,job_id,request_id:requestId,model_key:DEFAULT_MODEL_KEY,provider:'groq',model:config.model,purpose,prompt_version,attempt,latency_ms:latency,finish_reason:'error',http_status:response.status,success:false,retry_reason:data?.error?.message||`HTTP ${response.status}`,rate_limit_remaining_tokens:headers.get('x-ratelimit-remaining-tokens'),rate_limit_remaining_requests:headers.get('x-ratelimit-remaining-requests'),rate_limit_reset_tokens:headers.get('x-ratelimit-reset-tokens'),rate_limit_reset_requests:headers.get('x-ratelimit-reset-requests'),retry_after:retryAfter});
throw Object.assign(new Error(data?.error?.message||'AI service temporarily unavailable'),{status:response.status,retryable:retryable(response.status),retryAfter});
}
const content=data?.choices?.[0]?.message?.content;
const usage=data?.usage||{};
const inputTokens=Number(usage.prompt_tokens||0),outputTokens=Number(usage.completion_tokens||0);
if(typeof content!=='string'||!content.trim())throw Object.assign(new Error('Invalid AI response'),{status:502,retryable:true});
const actualCost=inputTokens/1000*config.input_cost_per_1k+outputTokens/1000*config.output_cost_per_1k;
if(reservationId&&!evaluation){if(!await confirmReservation(reservationId,actualCost))throw Object.assign(new Error('AI accounting confirmation failed'),{status:500,retryable:false});settled=true}
if(!evaluation)await logAIUsage({organization_id,job_id,request_id:requestId,model_key:DEFAULT_MODEL_KEY,provider:'groq',model:config.model,purpose,prompt_version,attempt,input_tokens:inputTokens,output_tokens:outputTokens,latency_ms:latency,finish_reason:data?.choices?.[0]?.finish_reason||'stop',http_status:response.status,success:true,retry_reason:null,rate_limit_remaining_tokens:headers.get('x-ratelimit-remaining-tokens'),rate_limit_remaining_requests:headers.get('x-ratelimit-remaining-requests'),rate_limit_reset_tokens:headers.get('x-ratelimit-reset-tokens'),rate_limit_reset_requests:headers.get('x-ratelimit-reset-requests'),retry_after:retryAfter});
return{data,provider:'groq',model:config.model,modelKey:DEFAULT_MODEL_KEY,requestId,usage:{prompt_tokens:inputTokens,completion_tokens:outputTokens},attempt};
}finally{
clearTimeout(timer);
if(reservationId&&!settled)try{await cancelReservation(reservationId)}catch{}
}
}

export async function callVisionWithRetry(imageBase64,onRetry=null,options={}){
let lastError=null;
for(let attempt=1;attempt<=3;attempt++){
try{
const first=await callGroq(imageBase64,{...options,attempt});
const firstContent=first?.data?.choices?.[0]?.message?.content||'';
if(suspicious(firstContent)){
try{
const verified=await callGroq(imageBase64,{...options,attempt:attempt+1,verification:true,draft:firstContent});
if(verified?.data?.choices?.[0]?.message?.content)return{...verified,attempt:Math.max(attempt,verified.attempt||attempt)};
}catch(error){console.warn('[VISION VERIFY]',error?.message||error)}
}
return{...first,attempt};
}catch(err){
lastError=err;
if(!err.retryable||attempt>=3)throw err;
let delay;
const parsed=Number(err.retryAfter);
if(Number.isFinite(parsed)&&parsed>=0)delay=Math.min(parsed,MAX_RETRY_AFTER_SEC)*1000;
else delay=Math.min(2000*Math.pow(2,attempt-1),30000);
if(onRetry)onRetry(attempt,delay);
await new Promise(resolve=>setTimeout(resolve,delay));
}
}
throw lastError||new Error('All retries failed');
 }

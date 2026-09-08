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
const AUDIT_MAX=240;
const SAFETY=40;
const SCAN_OUTPUT_NEED=EXTRACT_MAX+AUDIT_MAX;
const REQUEST_TIMEOUT_MS=60000;
const MAX_RETRY_AFTER_SEC=90;
const COMBINED_HEADROOM=2600;

const extractSchema={type:'object',properties:{people:{type:'array',items:{type:'object',properties:{row_number:{type:'integer'},name:{type:['string','null']},phone:{type:['string','null']},name_confidence:{type:'number'},phone_confidence:{type:'number'},pair_confidence:{type:'number'}},required:['row_number','name','phone','name_confidence','phone_confidence','pair_confidence'],additionalProperties:false}}},required:['people'],additionalProperties:false};
const auditSchema={type:'object',properties:{ok:{type:'boolean'},issues:{type:'array',items:{type:'object',properties:{row_number:{type:'integer'},corrected_name:{type:['string','null']},corrected_phone:{type:['string','null']},name_confidence:{type:'number'},phone_confidence:{type:'number'},pair_confidence:{type:'number'},reason:{type:'string'}},required:['row_number','corrected_name','corrected_phone','name_confidence','phone_confidence','pair_confidence','reason'],additionalProperties:false}}},required:['ok','issues'],additionalProperties:false};

function retryable(status){return[408,429,500,502,503,504].includes(status)}
function parseJSON(content){try{const cleaned=String(content||'').replace(/<think>[\s\S]*?<\/think>/gi,'').trim();return JSON.parse(cleaned)}catch{return null}}
function parseReset(v){const s=String(v||'');const m=s.match(/([\d.]+)(ms|s|m|h)/i);if(!m)return 10000;const n=Number(m[1]),u=m[2].toLowerCase();return u==='ms'?n:u==='s'?n*1000:u==='m'?n*60000:n*3600000}
function gate(){return globalThis.__NYEOCARE_GROQ_GATE||null}
function setGate(headers){const remaining=Number(headers.get('x-ratelimit-remaining-tokens'));const reset=headers.get('x-ratelimit-reset-tokens');globalThis.__NYEOCARE_GROQ_GATE={remainingTokens:Number.isFinite(remaining)?remaining:null,resetTokens:reset,resetAt:Date.now()+parseReset(reset),updatedAt:Date.now()}}
async function waitForCapacity(required){
 const g=gate();
 if(!g||g.remainingTokens===null||Date.now()>=Number(g.resetAt||0))return;
 if(g.remainingTokens>=required)return;
 const wait=Math.min(Math.max(Number(g.resetAt)-Date.now(),1000),90000);
 await new Promise(r=>setTimeout(r,wait));
}
export function getScanAdmission(){
 if(!GROQ_API_KEY)return{allowed:false,code:'AI_NOT_CONFIGURED',message:'ARIA scan is not configured yet.'};
 if(!process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT||!process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY)return{allowed:false,code:'LAYOUT_NOT_CONFIGURED',message:'ARIA scan is waiting for Document Intelligence configuration.'};
 const g=gate();
 if(g?.remainingTokens!==null&&Date.now()<Number(g.resetAt||0)&&g.remainingTokens<COMBINED_HEADROOM)return{allowed:false,code:'AI_CAPACITY_LOW',message:'ARIA is waiting for enough provider capacity. Please try again shortly.',retry_after_seconds:Math.ceil((Number(g.resetAt)-Date.now())/1000)};
 return{allowed:true,required_output_tokens:SCAN_OUTPUT_NEED,safety_tokens:SAFETY};
}
function extractionPrompt(layout){
 const rows=(layout?.rows||[]).map(r=>({row_number:r.row_number,name_hint:r.name_hint||null,phone_hint:r.phone_hint||null,name_y:r.name_y??null,phone_y:r.phone_y??null})); 
 return`You are ARIA, a forensic register digitisation engine. Read the ORIGINAL IMAGE, not just the hints.

The document-layout engine has already identified physical rows. Those rows are the authoritative physical structure.

RULES:
1. One physical register row = one person.
2. Never shift a phone to another row.
3. Never pair by array position after independently reading columns.
4. Never invent or repair unreadable digits.
5. Read every visible digit individually.
6. Preserve the visible person's name, including titles such as Sis, Bro, Mrs, Mr and Pastor.
7. If a name or phone cannot be safely read, return null.
8. Ignore headers and non-person rows.
9. row_number MUST correspond to the supplied physical row.
10. pair_confidence means confidence that the name and phone belong to THIS physical row.
11. Output JSON only.
12. Do not explain your reasoning.

LAYOUT ROWS:
${JSON.stringify(rows)}

Return one object per genuine person row.`;
}
function auditPrompt(layout,draft){
 const rows=(layout?.rows||[]).map(r=>({row_number:r.row_number,name_hint:r.name_hint||null,phone_hint:r.phone_hint||null,name_y:r.name_y??null,phone_y:r.phone_y??null}));
 return`You are ARIA's final register verifier. Re-read the ORIGINAL IMAGE.

The draft is untrusted. Check every row against the actual handwriting and physical row geometry.

Only return rows that need correction or cannot be safely verified.
If every row is correct, return {"ok":true,"issues":[]}.

Never invent a correction. If uncertain, return the row with null corrected fields and explain briefly in reason.
A phone belongs to a person ONLY when the image proves the same physical row.

LAYOUT:
${JSON.stringify(rows)}

DRAFT:
${draft}

Return JSON only.`;
}
async function callGroq(imageBase64,prompt,schema,options={}){
 if(!GROQ_API_KEY)throw Object.assign(new Error('AI service is not configured'),{status:503,retryable:false});
 const{organization_id,job_id,purpose='scan',prompt_version='v7',attempt=1,evaluation=false,maxCompletionTokens=EXTRACT_MAX}=options;
 await waitForCapacity(Math.min(COMBINED_HEADROOM,2600));
 const config=getModelConfig(DEFAULT_MODEL_KEY);
 let reservationId=null,settled=false;
 if(!evaluation){
  const budget=await reserveBudget(organization_id,purpose,DEFAULT_MODEL_KEY);
  if(!budget.allowed)throw Object.assign(new Error('AI budget capacity is unavailable'),{status:429,retryable:false});
  reservationId=budget.reservationId;
 }
 const requestId=randomUUID(),started=Date.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
 try{
  const response=await fetch(GROQ_URL,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${GROQ_API_KEY}`},body:JSON.stringify({
   model:config.model,
   messages:[{role:'user',content:[{type:'text',text:prompt},{type:'image_url',image_url:{url:`data:image/jpeg;base64,${imageBase64}`}}]}],
   temperature:.05,
   top_p:.9,
   max_completion_tokens:maxCompletionTokens,
   reasoning_effort:config.supports_reasoning_effort?'none':undefined,
   reasoning_format:config.supports_reasoning_effort?'hidden':undefined,
   response_format:config.supports_structured_output?{type:'json_schema',json_schema:{name:'register_scan',strict:true,schema}}:{type:'json_object'}
  }),signal:controller.signal});
  const latency=Date.now()-started;
  setGate(response.headers);
  let data={};try{data=await response.json()}catch{}
  const retryAfter=response.headers.get('retry-after');
  if(!response.ok){
   if(reservationId&&!settled){await cancelReservation(reservationId);settled=true}
   if(!evaluation)await logAIUsage({organization_id,job_id,request_id:requestId,model_key:DEFAULT_MODEL_KEY,provider:'groq',model:config.model,purpose,prompt_version,attempt,latency_ms:latency,finish_reason:'error',http_status:response.status,success:false,retry_reason:data?.error?.message||`HTTP ${response.status}`,rate_limit_remaining_tokens:response.headers.get('x-ratelimit-remaining-tokens'),rate_limit_remaining_requests:response.headers.get('x-ratelimit-remaining-requests'),rate_limit_reset_tokens:response.headers.get('x-ratelimit-reset-tokens'),rate_limit_reset_requests:response.headers.get('x-ratelimit-reset-requests'),retry_after:retryAfter});
   throw Object.assign(new Error(data?.error?.message||'AI service temporarily unavailable'),{status:response.status,retryable:retryable(response.status),retryAfter});
  }
  const content=data?.choices?.[0]?.message?.content,usage=data?.usage||{},inputTokens=Number(usage.prompt_tokens||0),outputTokens=Number(usage.completion_tokens||0),finishReason=data?.choices?.[0]?.finish_reason||'stop';
  if(typeof content!=='string'||!content.trim())throw Object.assign(new Error('ARIA produced an empty response'),{status:502,retryable:true});
  if(finishReason==='length')throw Object.assign(new Error('ARIA response reached its safe token limit. The scan was not accepted.'),{status:502,retryable:false,code:'AI_OUTPUT_TRUNCATED'});
  const actualCost=inputTokens/1000*config.input_cost_per_1k+outputTokens/1000*config.output_cost_per_1k;
  if(reservationId&&!evaluation){if(!await confirmReservation(reservationId,actualCost))throw Object.assign(new Error('AI accounting confirmation failed'),{status:500,retryable:false});settled=true}
  if(!evaluation)await logAIUsage({organization_id,job_id,request_id:requestId,model_key:DEFAULT_MODEL_KEY,provider:'groq',model:config.model,purpose,prompt_version,attempt,input_tokens:inputTokens,output_tokens:outputTokens,latency_ms:latency,finish_reason:finishReason,http_status:response.status,success:true,retry_reason:null,rate_limit_remaining_tokens:response.headers.get('x-ratelimit-remaining-tokens'),rate_limit_remaining_requests:response.headers.get('x-ratelimit-remaining-requests'),rate_limit_reset_tokens:response.headers.get('x-ratelimit-reset-tokens'),rate_limit_reset_requests:response.headers.get('x-ratelimit-reset-requests'),retry_after:retryAfter});
  return{data,provider:'groq',model:config.model,modelKey:DEFAULT_MODEL_KEY,requestId,usage:{prompt_tokens:inputTokens,completion_tokens:outputTokens},attempt,rateLimit:{remainingTokens:Number(response.headers.get('x-ratelimit-remaining-tokens')),remainingRequests:Number(response.headers.get('x-ratelimit-remaining-requests')),resetTokens:response.headers.get('x-ratelimit-reset-tokens')}};
 }finally{clearTimeout(timer);if(reservationId&&!settled)try{await cancelReservation(reservationId)}catch{}}
}
function reconcile(extracted,audit){
 const draft=Array.isArray(extracted?.people)?extracted.people:[];
 const issues=new Map((Array.isArray(audit?.issues)?audit.issues:[]).map(x=>[Number(x.row_number),x]));
 return draft.map(row=>{
  const issue=issues.get(Number(row.row_number));
  if(!issue){
   const verified=String(row.name||'').trim()&&String(row.phone||'').trim()&&Number(row.pair_confidence)>=98&&Number(row.name_confidence)>=95&&Number(row.phone_confidence)>=95;
   return{...row,verification_status:verified?'verified':'review',verification_reasons:verified?[]:['verification_threshold_not_met']};
  }
  const name=issue.corrected_name===null?row.name:issue.corrected_name;
  const phone=issue.corrected_phone===null?row.phone:issue.corrected_phone;
  const verified=String(name||'').trim()&&String(phone||'').trim()&&Number(issue.pair_confidence)>=98&&Number(issue.name_confidence)>=95&&Number(issue.phone_confidence)>=95;
  return{...row,name,phone,name_confidence:Number(issue.name_confidence)||0,phone_confidence:Number(issue.phone_confidence)||0,pair_confidence:Number(issue.pair_confidence)||0,verification_status:verified?'verified':'review',verification_reasons:verified?[]:[issue.reason||'row_requires_human_review']};
 }).filter(x=>x?.name||x?.phone);
}
export async function callVisionWithRetry(imageBase64,layout,onProgress=null,options={}){
 const admission=getScanAdmission();
 if(!admission.allowed)throw Object.assign(new Error(admission.message),{status:429,retryable:false,code:admission.code,retryAfter:admission.retry_after_seconds});
 let lastError=null;
 for(let attempt=1;attempt<=2;attempt++){
  try{
   onProgress?.('reading_handwriting');
   const first=await callGroq(imageBase64,extractionPrompt(layout),extractSchema,{...options,attempt,maxCompletionTokens:EXTRACT_MAX});
   const firstContent=first.data?.choices?.[0]?.message?.content||'',parsed=parseJSON(firstContent);
   if(!Array.isArray(parsed?.people)||!parsed.people.length)throw Object.assign(new Error('ARIA could not extract any safe register rows'),{status:502,retryable:false});
   onProgress?.('verifying_rows');
   const audit=await callGroq(imageBase64,auditPrompt(layout,firstContent),auditSchema,{...options,attempt,maxCompletionTokens:AUDIT_MAX});
   const auditContent=audit.data?.choices?.[0]?.message?.content||'',auditParsed=parseJSON(auditContent);
   if(!auditParsed||!Array.isArray(auditParsed.issues))throw Object.assign(new Error('ARIA verification returned an invalid result'),{status:502,retryable:false});
   const reconciled=reconcile(parsed,auditParsed);
   if(!reconciled.length)throw Object.assign(new Error('ARIA could not safely verify any register rows'),{status:502,retryable:false});
   return{...audit,data:{...audit.data,choices:[{...(audit.data.choices?.[0]||{}),message:{...(audit.data.choices?.[0]?.message||{}),content:JSON.stringify({people:reconciled})}}]},attempt,verification:{passes:2,extracted:parsed.people.length,verified:reconciled.filter(x=>x.verification_status==='verified').length,review:reconciled.filter(x=>x.verification_status!=='verified').length},tokenPlan:{extract_max:EXTRACT_MAX,audit_max:AUDIT_MAX,safety:SAFETY,total_reserved:SCAN_OUTPUT_NEED+SAFETY}};
  }catch(err){
   lastError=err;
   if(!err.retryable||attempt>=2)throw err;
   const parsedDelay=Number(err.retryAfter);
   const delay=Number.isFinite(parsedDelay)?Math.min(parsedDelay,MAX_RETRY_AFTER_SEC)*1000:Math.min(3000*Math.pow(2,attempt-1),30000);
   if(onProgress)onProgress('retrying',delay);
   await new Promise(resolve=>setTimeout(resolve,delay));
  }
 }
 throw lastError||new Error('ARIA scan failed safely');
}

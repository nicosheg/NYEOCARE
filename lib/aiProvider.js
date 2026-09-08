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
const AUDIT_MAX=300;
const SAFETY=60;
const SCAN_OUTPUT_NEED=EXTRACT_MAX+AUDIT_MAX+SAFETY;
const REQUEST_TIMEOUT_MS=60000;
const MAX_RETRY_AFTER_SEC=90;
const COMBINED_HEADROOM=1800;
const PROMPT_VERSION='v8-direct-vision';

const extractSchema={type:'object',properties:{people:{type:'array',items:{type:'object',properties:{
row_number:{type:'integer'},name:{type:['string','null']},phone:{type:['string','null']},
name_confidence:{type:'number'},phone_confidence:{type:'number'},pair_confidence:{type:'number'},
phone_relation:{type:'string',enum:['same_row','arrow_link','continuation','visual_link','uncertain']},
link_evidence:{type:['string','null']}
},required:['row_number','name','phone','name_confidence','phone_confidence','pair_confidence','phone_relation','link_evidence'],additionalProperties:false}}},required:['people'],additionalProperties:false};

const auditSchema={type:'object',properties:{ok:{type:'boolean'},issues:{type:'array',items:{type:'object',properties:{
row_number:{type:'integer'},corrected_name:{type:['string','null']},corrected_phone:{type:['string','null']},
name_confidence:{type:'number'},phone_confidence:{type:'number'},pair_confidence:{type:'number'},
phone_relation:{type:'string',enum:['same_row','arrow_link','continuation','visual_link','uncertain']},
link_evidence:{type:['string','null']},reason:{type:'string'}
},required:['row_number','corrected_name','corrected_phone','name_confidence','phone_confidence','pair_confidence','phone_relation','link_evidence','reason'],additionalProperties:false}}},required:['ok','issues'],additionalProperties:false};

function retryable(status){return[408,429,500,502,503,504].includes(status)}
function parseJSON(content){try{return JSON.parse(String(content||'').replace(/<think>[\s\S]*?<\/think>/gi,'').trim())}catch{return null}}
function parseReset(v){const m=String(v||'').match(/([\d.]+)(ms|s|m|h)/i);if(!m)return 10000;const n=Number(m[1]),u=m[2].toLowerCase();return u==='ms'?n:u==='s'?n*1000:u==='m'?n*60000:n*3600000}
function gate(){const g=globalThis.__NYEOCARE_GROQ_GATE;return g&&typeof g==='object'?g:null}
function setGate(headers){const remaining=Number(headers.get('x-ratelimit-remaining-tokens'));const reset=headers.get('x-ratelimit-reset-tokens');globalThis.__NYEOCARE_GROQ_GATE={remainingTokens:Number.isFinite(remaining)?remaining:null,resetTokens:reset,resetAt:Date.now()+parseReset(reset),updatedAt:Date.now()}}
async function waitForCapacity(required){const g=gate();if(!g)return;if(g.remainingTokens===null||Date.now()>=Number(g.resetAt||0)||g.remainingTokens>=required)return;const resetAt=Number(g.resetAt||0);if(!Number.isFinite(resetAt)||resetAt<=Date.now())return;const wait=Math.min(Math.max(resetAt-Date.now(),1000),90000);await new Promise(r=>setTimeout(r,wait))}
export function getScanAdmission(){
 if(!GROQ_API_KEY)return{allowed:false,code:'AI_NOT_CONFIGURED',message:'ARIA scan is not configured yet.'};
 const g=gate();
 const remaining=g&&Number.isFinite(Number(g.remainingTokens))?Number(g.remainingTokens):null;
 const resetAt=g&&Number.isFinite(Number(g.resetAt))?Number(g.resetAt):0;
 if(remaining!==null&&Date.now()<resetAt&&remaining<COMBINED_HEADROOM)return{allowed:false,code:'AI_CAPACITY_LOW',message:'ARIA is waiting for enough provider capacity. Please try again shortly.',retry_after_seconds:Math.ceil((resetAt-Date.now())/1000)};
 return{allowed:true,required_output_tokens:EXTRACT_MAX+AUDIT_MAX,safety_tokens:SAFETY}
}
function extractionPrompt(){
return`You are ARIA, an expert human register digitisation operator with visual understanding.

Your ONLY job is to accurately reconstruct the people written in the ORIGINAL IMAGE.

IMPORTANT: YOU ARE LOOKING AT THE ACTUAL IMAGE. Do not depend on OCR, external layout analysis, guessed rows, or positional assumptions.

FIRST UNDERSTAND THE PAGE:
- Find the real register area.
- Identify headers, columns, margins, row lines and writing patterns.
- Determine how the writer actually records a person.
- Account for crooked, folded, rumpled, tilted, uneven or poorly aligned paper.
- Account for handwriting that crosses lines or columns.

THEN RECONSTRUCT PEOPLE.

THE CENTRAL RULE:
A name and phone number belong together according to the HUMAN MEANING OF THE PAGE, NOT merely their nearest coordinates.

A phone may be:
1. on the same physical row;
2. on the next or previous row because the writer continued writing;
3. beside an arrow pointing from the number to the person's name;
4. connected by a bracket, line, circle, underline, continuation mark or other obvious visual cue;
5. displaced because the register is crowded or the paper is rumpled.

FOLLOW EXPLICIT VISUAL LINKS.
If a number is written elsewhere but an arrow clearly points to a person's name, follow that arrow.
If the writer obviously continued a person's entry on another line, treat it as that person's information.
Do NOT reject a valid association merely because the name and number are not horizontally aligned.

BUT:
Never invent an arrow or relationship that is not visible.
Never move a number simply because it makes the data look more normal.
Never use array position to pair independently extracted names and phones.

PHONE ACCURACY:
Read every visible digit individually.
Do not autocorrect a digit to make a Nigerian number look conventional.
Do not turn an uncertain digit into a guessed digit.
Preserve the number as actually written when confidently readable.
If a digit is genuinely unreadable, return null rather than hallucinating it.

NAME ACCURACY:
Preserve the written person's name.
Preserve visible titles such as Sis, Bro, Mr, Mrs, Pastor, Dr, Rev, Elder, Deacon and Deaconess.
Do not replace unusual names with common names.
Do not invent spelling corrections.

RUMPLE/CROOKED-PAGE RULE:
The physical page may be distorted.
Reason over the writing, visible row structure, column structure and connecting marks rather than assuming perfectly straight rows.

ROW RULE:
row_number represents the logical person entry as reconstructed from the page.
It does NOT mean "the nearest OCR line."
Do not split one person's continued information into two people.
Do not merge two people merely because their writing is close.

CONFIDENCE:
name_confidence = confidence that the name was read correctly.
phone_confidence = confidence that every phone digit was read correctly.
pair_confidence = confidence that THIS phone belongs to THIS person after considering rows, arrows, continuation marks and page structure.

phone_relation must be:
same_row = clearly same physical row
arrow_link = explicit arrow/visual pointer connects them
continuation = writing clearly continues across another line
visual_link = another strong visible structural relationship connects them
uncertain = relationship cannot safely be established

link_evidence should briefly describe the visible relationship, or null when same_row is obvious.

SAFETY:
A missing phone is better than a fabricated phone.
An uncertain pairing must be returned for review.
Do not silently guess.

Ignore headers, totals, notes, signatures, dates and non-person text.

Return JSON only.`;
}
function auditPrompt(draft){
return`You are ARIA performing a FINAL VISUAL AUDIT of a handwritten register.

Look at the ORIGINAL IMAGE again. The draft below is UNTRUSTED.

Check every person against the actual handwriting.

For each row verify:
1. the exact name;
2. every phone digit;
3. whether the phone really belongs to that person;
4. arrows, continuation marks, brackets, lines and visual pointers;
5. crooked, rumpled or displaced writing;
6. whether two entries were accidentally merged;
7. whether one entry was accidentally split;
8. whether any digit or name was hallucinated.

A phone does NOT have to be on the same physical line.
If an arrow or continuation clearly connects a displaced number to a person's name, preserve that relationship.

Only return rows that require correction or cannot safely be verified.
If all rows are correct return {"ok":true,"issues":[]}.

Never invent corrections.
If uncertain, return null for the uncertain corrected field and explain the uncertainty.

DRAFT:
${draft}

Return JSON only.`;
}
async function callGroq(imageBase64,prompt,schema,options={}){
 if(!GROQ_API_KEY)throw Object.assign(new Error('AI service is not configured'),{status:503,retryable:false});
 const{organization_id,job_id,purpose='scan',prompt_version=PROMPT_VERSION,attempt=1,evaluation=false,maxCompletionTokens=EXTRACT_MAX}=options;
 await waitForCapacity(Math.min(COMBINED_HEADROOM,1800));
 const config=getModelConfig(DEFAULT_MODEL_KEY);
 let reservationId=null,settled=false;
 if(!evaluation){const budget=await reserveBudget(organization_id,purpose,DEFAULT_MODEL_KEY);if(!budget.allowed)throw Object.assign(new Error('AI budget capacity is unavailable'),{status:429,retryable:false});reservationId=budget.reservationId}
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
 }finally{
  clearTimeout(timer);
  if(reservationId&&!settled)try{await cancelReservation(reservationId)}catch{}
 }
}
function reconcile(extracted,audit){
 const draft=Array.isArray(extracted?.people)?extracted.people:[],issues=new Map((Array.isArray(audit?.issues)?audit.issues:[]).map(x=>[Number(x.row_number),x]));
 return draft.map(row=>{
  const issue=issues.get(Number(row.row_number));
  if(!issue){
   const verified=String(row.name||'').trim()&&String(row.phone||'').trim()&&Number(row.pair_confidence)>=98&&Number(row.name_confidence)>=95&&Number(row.phone_confidence)>=95&&String(row.phone_relation||'uncertain')!=='uncertain';
   return{...row,verification_status:verified?'verified':'review',verification_reasons:verified?[]:['verification_threshold_not_met']};
  }
  const name=issue.corrected_name===null?row.name:issue.corrected_name;
  const phone=issue.corrected_phone===null?row.phone:issue.corrected_phone;
  const relation=issue.phone_relation||row.phone_relation||'uncertain';
  const verified=String(name||'').trim()&&String(phone||'').trim()&&Number(issue.pair_confidence)>=98&&Number(issue.name_confidence)>=95&&Number(issue.phone_confidence)>=95&&relation!=='uncertain';
  return{...row,name,phone,name_confidence:Number(issue.name_confidence)||0,phone_confidence:Number(issue.phone_confidence)||0,pair_confidence:Number(issue.pair_confidence)||0,phone_relation:relation,link_evidence:issue.link_evidence||row.link_evidence||null,verification_status:verified?'verified':'review',verification_reasons:verified?[]:[issue.reason||'row_requires_human_review']};
 }).filter(Boolean);
}
export async function callVisionWithRetry(imageBase64,_unusedLayout,onProgress=null,options={}){
 const admission=getScanAdmission();
 if(!admission.allowed)throw Object.assign(new Error(admission.message),{status:429,retryable:false,code:admission.code,retryAfter:admission.retry_after_seconds});
 if(typeof imageBase64!=='string'||imageBase64.length<1000)throw Object.assign(new Error('Invalid scan image.'),{status:400,retryable:false,code:'INVALID_IMAGE'});
 let lastError=null;
 for(let attempt=1;attempt<=2;attempt++){
  try{
   onProgress?.('reading_page');
   const first=await callGroq(imageBase64,extractionPrompt(),extractSchema,{...options,attempt,maxCompletionTokens:EXTRACT_MAX});
   const firstContent=first.data?.choices?.[0]?.message?.content||'',parsed=parseJSON(firstContent);
   if(!Array.isArray(parsed?.people)||!parsed.people.length)throw Object.assign(new Error('ARIA could not extract any safe register entries'),{status:502,retryable:false,code:'NO_PEOPLE_EXTRACTED'});
   onProgress?.('understanding_links');
   const audit=await callGroq(imageBase64,auditPrompt(firstContent),auditSchema,{...options,attempt,maxCompletionTokens:AUDIT_MAX});
   const auditContent=audit.data?.choices?.[0]?.message?.content||'',auditParsed=parseJSON(auditContent);
   if(!auditParsed||!Array.isArray(auditParsed.issues))throw Object.assign(new Error('ARIA visual verification returned an invalid result'),{status:502,retryable:false,code:'INVALID_VERIFICATION'});
   onProgress?.('finalizing_scan');
   const reconciled=reconcile(parsed,auditParsed);
   if(!reconciled.length)throw Object.assign(new Error('ARIA could not safely verify any register entries'),{status:502,retryable:false,code:'NO_VERIFIED_ROWS'});
   return{...audit,data:{...audit.data,choices:[{...(audit.data.choices?.[0]||{}),message:{...(audit.data.choices?.[0]?.message||{}),content:JSON.stringify({people:reconciled})}}]},attempt,verification:{passes:2,extracted:parsed.people.length,verified:reconciled.filter(x=>x.verification_status==='verified').length,review:reconciled.filter(x=>x.verification_status!=='verified').length},tokenPlan:{extract_max:EXTRACT_MAX,audit_max:AUDIT_MAX,safety:SAFETY,total_reserved:SCAN_OUTPUT_NEED},vision:'direct-groq'};
  }catch(err){
   lastError=err;
   if(!err.retryable||attempt>=2)throw err;
   const parsedDelay=Number(err.retryAfter),delay=Number.isFinite(parsedDelay)?Math.min(parsedDelay,MAX_RETRY_AFTER_SEC)*1000:Math.min(3000*Math.pow(2,attempt-1),30000);
   onProgress?.('retrying',delay);
   await new Promise(r=>setTimeout(r,delay));
  }
 }
 throw lastError||new Error('ARIA scan failed safely');
            }

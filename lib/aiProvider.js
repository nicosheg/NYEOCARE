// lib/aiProvider.js
import{getModelConfig}from'./modelRegistry';
import{logAIUsage}from'./aiObserver';
import crypto from'crypto';

const GROQ_API_KEY=process.env.GROQ_API_KEY,GROQ_URL='https://api.groq.com/openai/v1/chat/completions';
const configuredModel=process.env.GROQ_VISION_MODEL_KEY;
const MODEL_KEY=configuredModel==='groq-qwen3.6-27b'?'groq-qwen3.6-27b':configuredModel||'groq-qwen3.8-27b';
const MODEL=getModelConfig(MODEL_KEY);
const MAX_PEOPLE_PER_PAGE=50,OUTPUT_MAX=Math.min(1200,MODEL.max_completion_tokens||1200),RECOVERY_MAX=700,TIMEOUT=90000,MAX_RETRIES=2,PIPELINE_VERSION='v16-scan-review-flow';

function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function cleanName(v){return String(v||'').replace(/\s+/g,' ').trim()}
function parseJSON(text){
 if(!text||typeof text!=='string')return null;
 const cleaned=text.replace(/<think>[\s\S]*?<\/think>/gi,'').replace(/```json/gi,'').replace(/```/g,'').trim();
 try{return JSON.parse(cleaned)}catch{}
 const object=cleaned.match(/\{[\s\S]*\}/);
 if(object)try{return JSON.parse(object[0])}catch{}
 return null;
}
function phoneValues(x){
 const value=x?.p??x?.phone??x?.phones;
 if(Array.isArray(value))return value.map(v=>String(v??'').trim()).filter(Boolean).slice(0,2);
 if(value==null)return[];
 const s=String(value).trim();
 return s?[s]:[];
}
function compactPeople(parsed){
 const rows=Array.isArray(parsed?.people)?parsed.people:Array.isArray(parsed)?parsed:[];
 return rows.slice(0,MAX_PEOPLE_PER_PAGE).map(x=>{
  const name=cleanName(x?.n??x?.name??''),phones=phoneValues(x);
  return{name,raw_name:name,phone:phones[0]||null,phones,confidence:0,name_confidence:0,phone_confidence:0,pair_confidence:0,row_number:null};
 }).filter(x=>x.name||x.phone);
}
function prompt(recovery=false){
 return`Read the ORIGINAL photographed register page. Extract every real person on THIS PAGE, maximum 50 people.

Return ONLY:
{"people":[{"n":"Name","p":["08012345678"]}]}

Rules:
- n is the person's written name and MUST preserve meaningful spaces.
- Keep church titles/prefixes exactly as part of the name: Bro, Sis, Sister, Pastor, Rev, Mrs, Mr, Dr, Elder, Deacon, Deaconess, etc.
- NEVER remove or merge a church title into the next word.
- p contains every phone number visibly assigned to that person, normally 0, 1 or 2.
- Read the ORIGINAL digits. NEVER invent, autocomplete, repair or substitute digits.
- Preserve leading 0 or +234.
- A phone belongs to a name only when the page visually supports that assignment through the same row, arrow, line or continuation.
- Do not assign a nearby phone merely because it is close.
- If a digit is genuinely unreadable, omit that phone instead of guessing.
- Ignore headers, totals, dates, notes and signatures.
- Do not return confidence, row numbers, explanations or reasoning.
- Never return more than 50 people.
${recovery?'Re-read the original page once more. Return compact JSON only. Focus on exact digits, spaces, church titles and name/phone pairing. Never guess.':''}`;
}
function responseFormat(){
 if(!MODEL.supports_structured_output)return{type:'json_object'};
 return{type:'json_schema',json_schema:{name:'scan_people',strict:true,schema:{type:'object',properties:{people:{type:'array',items:{type:'object',properties:{n:{type:'string'},p:{type:'array',items:{type:'string'}}},required:['n','p'],additionalProperties:false}}},required:['people'],additionalProperties:false}}};
}
async function safeLog(data){try{return await logAIUsage(data)}catch{return null}}
function retryDelay(error,attempt){
 const retryAfter=Number(error?.retryAfter);
 if(Number.isFinite(retryAfter)&&retryAfter>0)return Math.min(retryAfter*1000,60000);
 return Math.min(1500*Math.pow(2,attempt-1),8000);
}
async function request(imageBase64,text,maxTokens,options,attempt){
 const started=Date.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),TIMEOUT),requestId=crypto.randomUUID();
 try{
  const body={model:MODEL.model,messages:[{role:'user',content:[{type:'text',text},{type:'image_url',image_url:{url:`data:image/jpeg;base64,${imageBase64}`}}]}],temperature:.1,top_p:.8,max_completion_tokens:maxTokens,response_format:responseFormat()};
  if(MODEL.supports_reasoning_effort){body.reasoning_effort='none';body.reasoning_format='hidden'}
  const response=await fetch(GROQ_URL,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${GROQ_API_KEY}`},body:JSON.stringify(body),signal:controller.signal});
  const latency=Date.now()-started;
  let data={};try{data=await response.json()}catch{}
  const usage=data?.usage||{},headers=response.headers,common={organization_id:options.organization_id,job_id:options.job_id,request_id:requestId,provider:'groq',model:MODEL.model,model_key:MODEL_KEY,purpose:options.purpose||'scan',prompt_version:PIPELINE_VERSION,attempt,input_tokens:Number(usage.prompt_tokens||0),output_tokens:Number(usage.completion_tokens||0),latency_ms:latency,rate_limit_remaining_tokens:headers.get('x-ratelimit-remaining-tokens'),rate_limit_remaining_requests:headers.get('x-ratelimit-remaining-requests'),rate_limit_reset_tokens:headers.get('x-ratelimit-reset-tokens'),rate_limit_reset_requests:headers.get('x-ratelimit-reset-requests'),retry_after:headers.get('retry-after')};
  if(!response.ok){
   const message=data?.error?.message||`Groq request failed with ${response.status}`;
   await safeLog({...common,http_status:response.status,success:false,finish_reason:'error',retry_reason:message});
   throw Object.assign(new Error(message),{status:response.status,retryable:[408,429,500,502,503,504].includes(response.status),retryAfter:headers.get('retry-after')});
  }
  const choice=data?.choices?.[0]||{},content=choice?.message?.content||'',finishReason=choice?.finish_reason||'stop';
  await safeLog({...common,http_status:response.status,success:true,finish_reason:finishReason});
  if(!content.trim())throw Object.assign(new Error('Groq returned an empty vision response'),{code:'EMPTY_AI_RESPONSE',retryable:true});
  if(finishReason==='length')throw Object.assign(new Error('Groq response reached its output limit'),{code:'AI_OUTPUT_TRUNCATED',retryable:false});
  return{data,attempt,usage,requestId};
 }catch(err){
  if(err?.name==='AbortError')throw Object.assign(new Error('Vision provider timed out'),{code:'AI_TIMEOUT',retryable:true});
  throw err;
 }finally{clearTimeout(timer)}
}
function normalizeResult(result,mode){
 const people=compactPeople(parseJSON(result?.data?.choices?.[0]?.message?.content||''));
 return{...result,data:{...result.data,choices:[{...(result.data?.choices?.[0]||{}),message:{...(result.data?.choices?.[0]?.message||{}),content:JSON.stringify({people})}}]},verification:{passes:mode==='recovery'?2:1,extracted:people.length},tokenPlan:{primary:OUTPUT_MAX,recovery:RECOVERY_MAX,max_people_per_page:MAX_PEOPLE_PER_PAGE},vision:'groq-compact-name-phone',pipeline_version:PIPELINE_VERSION};
}
export function getScanAdmission(){
 if(!GROQ_API_KEY)return{allowed:false,code:'AI_NOT_CONFIGURED',message:'ARIA scan is not configured.'};
 return{allowed:true,max_people_per_page:MAX_PEOPLE_PER_PAGE,max_output_tokens:OUTPUT_MAX};
}
export async function callVisionWithRetry(imageBase64,_unused,onProgress=null,options={}){
 if(!GROQ_API_KEY)throw Object.assign(new Error('GROQ_API_KEY is missing'),{code:'AI_NOT_CONFIGURED',retryable:false});
 if(typeof imageBase64!=='string'||imageBase64.length<1000)throw Object.assign(new Error('Invalid scan image'),{code:'INVALID_IMAGE',retryable:false});
 let lastError=null;
 for(let attempt=1;attempt<=MAX_RETRIES;attempt++)try{
  onProgress?.('reading_page');
  const vision=await request(imageBase64,prompt(false),OUTPUT_MAX,options,attempt);
  const people=compactPeople(parseJSON(vision.data?.choices?.[0]?.message?.content||''));
  if(people.length){onProgress?.('finalizing_scan');return normalizeResult(vision,'primary')}
  onProgress?.('rereading_original');
  const recovery=await request(imageBase64,prompt(true),RECOVERY_MAX,{...options,purpose:'scan_recovery'},attempt+1);
  const recoveryPeople=compactPeople(parseJSON(recovery.data?.choices?.[0]?.message?.content||''));
  if(recoveryPeople.length){onProgress?.('finalizing_scan');return normalizeResult(recovery,'recovery')}
  throw Object.assign(new Error('No people could be extracted from the register image'),{code:'NO_PEOPLE_EXTRACTED',retryable:false});
 }catch(err){
  lastError=err;
  if(err?.code==='AI_OUTPUT_TRUNCATED'||attempt>=MAX_RETRIES||!err?.retryable)throw err;
  onProgress?.(err?.status===429?'provider_wait':'retrying');
  await sleep(retryDelay(err,attempt));
 }
 throw lastError||new Error('Vision scan failed');
}

// lib/aiProvider.js
import{getModelConfig}from'./modelRegistry';
import{logAIUsage}from'./aiObserver';
import crypto from'crypto';

const GROQ_API_KEY=process.env.GROQ_API_KEY;
const GROQ_URL='https://api.groq.com/openai/v1/chat/completions';
const configuredModel=process.env.GROQ_VISION_MODEL_KEY;
const MODEL_KEY=configuredModel==='groq-qwen3.6-27b'?'groq-qwen3.8-27b':configuredModel||'groq-qwen3.8-27b';
const MODEL=getModelConfig(MODEL_KEY);
const OUTPUT_MAX=Math.min(1200,Math.max(900,MODEL.max_completion_tokens||1200));
const RETRY_OUTPUT_MAX=Math.min(1200,Math.max(900,MODEL.max_completion_tokens||1200));
const RECOVERY_MAX=Math.min(1000,Math.max(800,MODEL.max_completion_tokens||1000));
const TIMEOUT=90000;
const MAX_RETRIES=3;
const PIPELINE_VERSION='v12-reliable-compact-vision';

function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function parseJSON(text){
 if(!text||typeof text!=='string')return null;
 const cleaned=text.replace(/<think>[\s\S]*?<\/think>/gi,'').replace(/```json/gi,'').replace(/```/g,'').trim();
 try{return JSON.parse(cleaned)}catch{}
 const object=cleaned.match(/\{[\s\S]*\}/);
 if(object)try{return JSON.parse(object[0])}catch{}
 const array=cleaned.match(/\[[\s\S]*\]/);
 if(array)try{return{people:JSON.parse(array[0])}}catch{}
 return null;
}
function compactPeople(parsed){
 const rows=Array.isArray(parsed?.people)?parsed.people:Array.isArray(parsed)?parsed:[];
 return rows.map(x=>{
  const confidence=Math.max(0,Math.min(100,Number(x?.c??x?.confidence??x?.pair_confidence)||0));
  const relation=String(x?.rel??x?.phone_relation??'uncertain').trim().toLowerCase();
  const verified=confidence>=98&&relation!=='uncertain';
  return{
   row_number:Number.isInteger(Number(x?.r??x?.row_number))?Number(x?.r??x?.row_number):null,
   name:String(x?.n??x?.name??'').trim()||null,
   phone:String(x?.p??x?.phone??'').trim()||null,
   confidence,
   name_confidence:confidence,
   phone_confidence:confidence,
   pair_confidence:confidence,
   phone_relation:relation,
   link_evidence:x?.e==null?null:String(x.e).trim()||null,
   verification_status:verified?'verified':'review',
   verification_reasons:verified?[]:['verification_threshold_not_met']
  };
 }).filter(x=>x.name||x.phone);
}
function prompt(recovery=false){
 return`Read the ORIGINAL photographed attendance register carefully. This is handwriting recognition, not text generation. Understand the page layout before extracting rows. The page may be tilted, crowded, folded, faint or uneven.
Find real people only. Ignore headers, totals, dates, notes, signatures and other non-person text.
For every visible person:
- Preserve the written name and honorific.
- Read phone digits exactly as visible.
- NEVER invent missing digits or autocorrect from memory.
- Pair a phone only when the image visibly supports it.
- Same-row pairing is strongest.
- Also accept an explicit arrow, line, bracket or continuation mark.
- Never pair merely because values are nearby.
- Never split one person into multiple people.
- Never merge two people.
- Do not use outside knowledge to repair handwriting.
Return ONLY compact JSON: {"people":[{"r":1,"n":"Sis Sandra","p":"08039579788","c":99,"rel":"same_row","e":null}]}
c is confidence 0-100 for the complete name, phone and pairing.
rel must be same_row, arrow_link, continuation, visual_link or uncertain.
e is null for same_row, otherwise a short description of the visible connection.
If a phone cannot be safely read, use null. If a name cannot be safely read, use null.
${recovery?'Re-read the ORIGINAL IMAGE from the beginning. The previous pass produced no usable entries. Return every clearly visible person you can safely identify. JSON only.':''}`;
}
async function safeLog(data){try{return await logAIUsage(data)}catch{return null}}
function retryDelay(error,attempt){
 const retryAfter=Number(error?.retryAfter);
 if(Number.isFinite(retryAfter)&&retryAfter>0)return Math.min(retryAfter*1000,60000);
 return Math.min(2000*Math.pow(2,attempt-1),15000);
}
async function request(imageBase64,text,maxTokens,options,attempt){
 const started=Date.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),TIMEOUT),requestId=crypto.randomUUID();
 try{
  const body={model:MODEL.model,messages:[{role:'user',content:[{type:'text',text},{type:'image_url',image_url:{url:`data:image/jpeg;base64,${imageBase64}`}}]}],temperature:.1,top_p:.9,max_completion_tokens:maxTokens,response_format:{type:'json_object'}};
  if(MODEL.supports_reasoning_effort){body.reasoning_effort='none';body.reasoning_format='hidden'}
  const response=await fetch(GROQ_URL,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${GROQ_API_KEY}`},body:JSON.stringify(body),signal:controller.signal});
  const latency=Date.now()-started;
  let data={};try{data=await response.json()}catch{}
  const usage=data?.usage||{},headers=response.headers;
  const common={organization_id:options.organization_id,job_id:options.job_id,request_id:requestId,provider:'groq',model:MODEL.model,model_key:MODEL_KEY,purpose:options.purpose||'scan',prompt_version:PIPELINE_VERSION,attempt,input_tokens:Number(usage.prompt_tokens||0),output_tokens:Number(usage.completion_tokens||0),latency_ms:latency,rate_limit_remaining_tokens:headers.get('x-ratelimit-remaining-tokens'),rate_limit_remaining_requests:headers.get('x-ratelimit-remaining-requests'),rate_limit_reset_tokens:headers.get('x-ratelimit-reset-tokens'),rate_limit_reset_requests:headers.get('x-ratelimit-reset-requests'),retry_after:headers.get('retry-after')};
  if(!response.ok){
   const message=data?.error?.message||`Groq request failed with ${response.status}`;
   await safeLog({...common,http_status:response.status,success:false,finish_reason:'error',retry_reason:message});
   throw Object.assign(new Error(message),{status:response.status,rateLimited:response.status===429,retryable:[408,429,500,502,503,504].includes(response.status),retryAfter:headers.get('retry-after')});
  }
  const choice=data?.choices?.[0]||{},content=choice?.message?.content||'',finishReason=choice?.finish_reason||'stop';
  await safeLog({...common,http_status:response.status,success:true,finish_reason:finishReason});
  if(!content.trim())throw Object.assign(new Error('Groq returned an empty vision response'),{code:'EMPTY_AI_RESPONSE',retryable:true});
  if(finishReason==='length')throw Object.assign(new Error('Groq response reached its output limit'),{code:'AI_OUTPUT_TRUNCATED',retryable:true,outputTruncated:true});
  return{data,attempt,usage,requestId};
 }catch(err){
  if(err?.name==='AbortError')throw Object.assign(new Error('Vision provider timed out'),{code:'AI_TIMEOUT',retryable:true});
  throw err;
 }finally{clearTimeout(timer)}
}
function normalizeResult(result,vision,mode){
 const people=compactPeople(parseJSON(result?.data?.choices?.[0]?.message?.content||''));
 return{...result,data:{...result.data,choices:[{...(result.data?.choices?.[0]||{}),message:{...(result.data?.choices?.[0]?.message||{}),content:JSON.stringify({people})}}]},verification:{passes:mode==='recovery'?2:1,extracted:people.length,verified:people.filter(x=>x.verification_status==='verified').length,review:people.filter(x=>x.verification_status!=='verified').length},tokenPlan:{primary:OUTPUT_MAX,retry:RETRY_OUTPUT_MAX,recovery:RECOVERY_MAX},vision:mode==='recovery'?'groq-smart-token-recovery':'groq-smart-token-vision',pipeline_version:PIPELINE_VERSION};
}
export function getScanAdmission(){
 if(!GROQ_API_KEY)return{allowed:false,code:'AI_NOT_CONFIGURED',message:'ARIA scan is not configured.'};
 return{allowed:true};
}
export async function callVisionWithRetry(imageBase64,_unused,onProgress=null,options={}){
 if(!GROQ_API_KEY)throw Object.assign(new Error('GROQ_API_KEY is missing'),{code:'AI_NOT_CONFIGURED',retryable:false});
 if(typeof imageBase64!=='string'||imageBase64.length<1000)throw Object.assign(new Error('Invalid scan image'),{code:'INVALID_IMAGE',retryable:false});
 let lastError=null;
 for(let attempt=1;attempt<=MAX_RETRIES;attempt++){
  try{
   onProgress?.('reading_page');
   let vision=await request(imageBase64,prompt(false),OUTPUT_MAX,options,attempt);
   let parsed=parseJSON(vision.data?.choices?.[0]?.message?.content||''),people=compactPeople(parsed);
   if(people.length){onProgress?.('finalizing_scan');return normalizeResult(vision,vision,'primary')}
   onProgress?.('rereading_original');
   vision=await request(imageBase64,prompt(true),RECOVERY_MAX,{...options,purpose:'scan_recovery'},attempt+1);
   parsed=parseJSON(vision.data?.choices?.[0]?.message?.content||'');
   people=compactPeople(parsed);
   if(people.length){onProgress?.('finalizing_scan');return normalizeResult(vision,vision,'recovery')}
   throw Object.assign(new Error('No usable people were found in the register image'),{code:'NO_PEOPLE_EXTRACTED',retryable:true});
  }catch(err){
   lastError=err;
   if(attempt>=MAX_RETRIES)throw err;
   if(err?.code==='NO_PEOPLE_EXTRACTED'||err?.outputTruncated||err?.retryable){
    onProgress?.(err?.status===429?'provider_wait':'retrying');
    await sleep(retryDelay(err,attempt));
    continue;
   }
   throw err;
  }
 }
 throw lastError||new Error('Vision scan failed');
 }

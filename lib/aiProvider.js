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
const RECOVERY_MAX=Math.min(1000,Math.max(800,MODEL.max_completion_tokens||1000));
const TIMEOUT=90000,MAX_RETRIES=3,PIPELINE_VERSION='v13-simple-name-phone';

function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function titleWord(v){return String(v||'').split(/(\s+|-|')/).map(x=>/^[a-z]/i.test(x)?x.charAt(0).toUpperCase()+x.slice(1).toLowerCase():x).join('')}
function normalizeDisplayName(name){return String(name||'').replace(/\s+/g,' ').trim().split(' ').map(titleWord).join('')}

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

function phoneValues(x){
 const value=x?.p??x?.phone??x?.phones;
 if(Array.isArray(value))return value.map(v=>String(v??'').trim()).filter(Boolean).slice(0,2);
 if(value==null)return[];
 const s=String(value).trim();
 return s?[s]:[];
}

function compactPeople(parsed){
 const rows=Array.isArray(parsed?.people)?parsed.people:Array.isArray(parsed)?parsed:[];
 return rows.map(x=>{
  const phones=phoneValues(x);
  const name=normalizeDisplayName(String(x?.n??x?.name??'').trim())||null;
  const rawName=String(x?.o??x?.raw_name??x?.n??x?.name??'').trim()||null;
  const nc=Math.max(0,Math.min(100,Number(x?.nc??x?.name_confidence??0)||0));
  const pc=Math.max(0,Math.min(100,Number(x?.pc??x?.phone_confidence??0)||0));
  const c=Math.max(0,Math.min(100,Number(x?.c??x?.confidence??Math.min(nc||0,pc||0))||0));
  return{row_number:null,name,raw_name:rawName,phone:phones[0]||null,phones,confidence:c,name_confidence:nc,phone_confidence:pc,pair_confidence:c};
 }).filter(x=>x.name||x.phone);
}

function prompt(recovery=false){
 return`Read the ORIGINAL photographed attendance register. Extract every real person and the phone number(s) visibly assigned to that person. Keep this task SIMPLE: do not return row numbers, relationship labels, confidence explanations, or reasoning.
For each person return:
- name: the clean human-readable name exactly corresponding to the written name.
- raw_name: the name as visibly written.
- phone: an array containing every phone number visibly assigned to that name; usually 0, 1 or 2 numbers.
Important:
- Read the actual digits. Do not invent, repair, autocomplete, or substitute digits.
- Preserve the original number exactly as written, including a leading 0 or +234 where visible.
- A phone belongs to a name only when the page visually supports that assignment. Use the same row and any obvious arrow/line/continuation mark to understand the assignment, but do not describe the connection.
- Do not take a number merely because it is somewhere nearby.
- If a digit is genuinely unreadable, return that phone as null rather than guessing it.
- Ignore headers, totals, dates, notes and signatures.
Return ONLY JSON in this shape:
{"people":[{"name":"Sandra Isichei","raw_name":"Sandra Isichei","phone":["08039579788"]}]}
Do not add markdown or prose.
${recovery?'Re-read the original image independently and return the same simple structure. Focus especially on exact phone digits. Do not guess any digit.':''}`;
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
  const usage=data?.usage||{},headers=response.headers,common={organization_id:options.organization_id,job_id:options.job_id,request_id:requestId,provider:'groq',model:MODEL.model,model_key:MODEL_KEY,purpose:options.purpose||'scan',prompt_version:PIPELINE_VERSION,attempt,input_tokens:Number(usage.prompt_tokens||0),output_tokens:Number(usage.completion_tokens||0),latency_ms:latency,rate_limit_remaining_tokens:headers.get('x-ratelimit-remaining-tokens'),rate_limit_remaining_requests:headers.get('x-ratelimit-remaining-requests'),rate_limit_reset_tokens:headers.get('x-ratelimit-reset-tokens'),rate_limit_reset_requests:headers.get('x-ratelimit-reset-requests'),retry_after:headers.get('retry-after')};
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

function normalizeResult(result,mode){
 const people=compactPeople(parseJSON(result?.data?.choices?.[0]?.message?.content||''));
 const extractionQuality=people.length?Math.round(people.reduce((sum,p)=>sum+Math.min(p.name_confidence||0,p.phone_confidence||0),0)/people.length):0;
 return{...result,data:{...result.data,choices:[{...(result.data?.choices?.[0]||{}),message:{...(result.data?.choices?.[0]?.message||{}),content:JSON.stringify({people})}}]},verification:{passes:mode==='recovery'?2:1,extracted:people.length,extraction_quality:extractionQuality},tokenPlan:{primary:OUTPUT_MAX,recovery:RECOVERY_MAX},vision:'groq-simple-name-phone',pipeline_version:PIPELINE_VERSION};
}

export function getScanAdmission(){
 if(!GROQ_API_KEY)return{allowed:false,code:'AI_NOT_CONFIGURED',message:'ARIA scan is not configured.'};
 return{allowed:true};
}

export async function callVisionWithRetry(imageBase64,_unused,onProgress=null,options={}){
 if(!GROQ_API_KEY)throw Object.assign(new Error('GROQ_API_KEY is missing'),{code:'AI_NOT_CONFIGURED',retryable:false});
 if(typeof imageBase64!=='string'||imageBase64.length<1000)throw Object.assign(new Error('Invalid scan image'),{code:'INVALID_IMAGE',retryable:false});
 let lastError=null;
 for(let attempt=1;attempt<=MAX_RETRIES;attempt++)try{
  onProgress?.('reading_page');
  let vision=await request(imageBase64,prompt(false),OUTPUT_MAX,options,attempt);
  let people=compactPeople(parseJSON(vision.data?.choices?.[0]?.message?.content||''));
  if(people.length){onProgress?.('finalizing_scan');return normalizeResult(vision,'primary')}
  onProgress?.('rereading_original');
  vision=await request(imageBase64,prompt(true),RECOVERY_MAX,{...options,purpose:'scan_recovery'},attempt+1);
  people=compactPeople(parseJSON(vision.data?.choices?.[0]?.message?.content||''));
  if(people.length){onProgress?.('finalizing_scan');return normalizeResult(vision,'recovery')}
  throw Object.assign(new Error('No people could be extracted from the register image'),{code:'NO_PEOPLE_EXTRACTED',retryable:true});
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
 throw lastError||new Error('Vision scan failed');
  }

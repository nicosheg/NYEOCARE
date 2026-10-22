// lib/hybridScanProvider.js
import sharp from 'sharp';
import {makeScanRegions} from './scanImageViews.js';
import crypto from 'crypto';
import {getModelConfig} from './modelRegistry';
import {logAIUsage,updateExtractionMetrics} from './aiObserver';
import pool from './db';
import {getAIProvider,isAIProviderConfigured} from './aiProviders';
import {getRateLimitRetrySeconds} from './scanRateLimit';
import {mergeScanRegions} from './scanRegionMerge';
import {classifyScanRegions} from './scanCompleteness';
import {formatScanLearningHints} from './scanLearningHints.js';
import {resolveScanReasoningEffort,getScanPipelineVersion,SCAN_VISUAL_VERIFICATION_INSTRUCTION} from './scanReasoning.js';
import {isInputTokenBudgetError,makeFullPageBudgetFallback} from './scanRequestBudget.js';

const PRIMARY_KEY='groq-qwen3.8-27b';
const PRIMARY=getModelConfig(PRIMARY_KEY);

export const SCAN_REASONING_EFFORT=resolveScanReasoningEffort();
export const SCAN_PIPELINE_VERSION=getScanPipelineVersion(SCAN_REASONING_EFFORT);
const MIN_RATE_LIMIT_COOLDOWN_SECONDS=8;
const MAX=50,TIMEOUT=55000;
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const PROMPT=`Transcribe this handwritten register as source evidence, not as a summary, rewrite, spell-check, or identity-matching task. The images are views of ONE physical page, not separate pages. Use their stated original-page vertical bounds and overlap to reconstruct the page top-to-bottom. Count physical rows; return each person/record once and never create two people from one row or silently collapse two different rows.

LANGUAGE AND NAMES:
The register may contain Nigerian names, English names, English/Nigerian-English wording, or mixed/compound names from any Nigerian language. Nigerian personal names may be unfamiliar, long, repeated, hyphenated, apostrophized, abbreviated, or combined with an English given name. Do not replace an unfamiliar spelling with a more common name, translate it, autocomplete it from cultural expectations, title-case it, remove initials, or silently correct its spelling. Copy the complete visible name exactly as written, including punctuation, capitalization, initials, repeated words, and every title/honorific (Sis, Sister, Bro, Brother, Mr, Mrs, Pastor, Rev, Dr, Elder, Mummy, Mama, etc.). A title is part of the visible name and must not be dropped or moved. Handwritten SIS is S-I-S, not SB unless B is genuinely visible. Compare repeated title tokens down the left column and across the page; do not read SIS as SB unless the actual strokes support B. Examples of Nigerian name shapes are reading guidance only, never text to insert: Nnabuife, Onyebuchi, Okonkwo, Adebayo, Eghosa, Ihuoma. The image always outranks these examples and prior observations.

EXTRACT EACH FIELD INDEPENDENTLY:
For each physical record, independently transcribe name, phone number(s), and date of birth if visible. One field may be absent while another is readable. Return a record whenever at least one of name, phone, or DOB is visibly present. A row containing only a name, only a phone number, or only a DOB is valid evidence and MUST NOT be omitted or cause the whole response to fail. Use an empty string for a genuinely absent name or DOB and an empty p array when no phone is written. Do not invent a value for an absent field. Omit only a row where all three fields are genuinely blank / no person data is visible; if no person is visibly written anywhere on the page, return an empty people array; do not invent entries. Ignore page titles, column headings, totals, and unrelated notes.

PHONE DIGITS ARE A REQUIRED EXTRACTION FIELD. PHONE NUMBERS — LITERAL DIGITS, NOT GUESSES:
Nigerian numbers are common. A local Nigerian mobile number often looks like 08012345678 (11 digits beginning with 0); international notation may look like +2348012345678 or 2348012345678. English/international numbers and other legitimate lengths may also occur. These patterns are validation clues only: copy every visible digit in its written order and preserve the written prefix, including a leading 0 or +234. Do not add/remove digits, change 1 to 7, 7 to 1, O to 0, or otherwise “correct” the image to fit an expected phone format. Remove no visible digits. Spaces/dashes may be retained; downstream code normalizes formatting. Inspect the entire row and phone column. A person can have two numbers only when each is visibly assigned to that person. If digits are unclear, preserve the best literal visual reading and flag digit_uncertain rather than inventing a more plausible number. Never borrow a number from a nearby row.

DATES OF BIRTH:
Read only a date visibly assigned to that person. Handwritten formats can include D/M/YYYY, DD-MM-YYYY, D.M.YYYY, YYYY-MM-DD, or other clearly written formats. Preserve exact visible characters in d; do not normalize, complete a missing year, infer a century, or mistake a registration/service date for a birthday. Use an empty string only when no DOB is visible. If a DOB is partly visible or ambiguous, retain the visible text and flag dob_uncertain.

PHYSICAL ROW OWNERSHIP:
Use physical row alignment/spacing to associate fields, not name-frequency or language guesses. Set c=true ONLY when a blank-name continuation line is clearly an additional field for the immediately preceding person (usually a second phone) and its physical placement supports that ownership. Set c=false for ordinary named rows and for any blank-name line whose ownership is not certain. If ownership is ambiguous, keep the visible phone/DOB as its own partial record and flag row_ownership_uncertain or continuation_uncertain; do not silently attach it to the previous person. Never merge people merely because names look similar. Preserve the order of rows.

UNCERTAINTY AND OUTPUT:
Inspect difficult letters/digits once more before returning. Compare repeated handwriting shapes on this same image, especially complete names and title tokens, but never let a pattern override visible ink. Add name_uncertain, digit_uncertain, dob_uncertain, continuation_uncertain, or row_ownership_uncertain only as applicable. Do not include private chain-of-thought, analysis, markdown, or prose. Return only the compact object required by the JSON schema: {"people":[{"y":500,"n":"exact visible name or empty string","p":["exact visible phone text"],"d":"exact visible DOB text or empty string","c":false,"f":[]}]}.
For y, use the approximate vertical centre on the ORIGINAL FULL PAGE (0 at top, 1000 at bottom), even when viewing crops. Keep extraction literal and concise. Maximum ${MAX} records.`;

const SCHEMA={type:'json_schema',json_schema:{name:'nyeocare_register_page',strict:true,schema:{type:'object',additionalProperties:false,properties:{people:{type:'array',maxItems:MAX,items:{type:'object',additionalProperties:false,properties:{y:{type:'integer',minimum:0,maximum:1000},n:{type:'string'},p:{type:'array',maxItems:2,items:{type:'string'}},d:{type:'string'},c:{type:'boolean'},f:{type:'array',items:{type:'string',enum:['digit_uncertain','continuation_uncertain','row_ownership_uncertain','name_uncertain','dob_uncertain']}}},required:['y','n','p','d','c','f']}}},required:['people']}}};

function decode(v){
 let s=String(v||'').trim(),m=s.match(/^data:([^;,]+);base64,(.*)$/is);
 if(m)s=m[2];
 s=s.replace(/\s/g,'').replace(/-/g,'+').replace(/_/g,'/');
 const b=Buffer.from(s,'base64');
 if(!b.length||b.length>4000000)throw Object.assign(Error('Invalid image.'),{code:'INVALID_IMAGE'});
 if(!(b[0]===255&&b[1]===216&&b[2]===255)&&!(b[0]===137&&b[1]===80&&b[2]===78&&b[3]===71)&&!(b.slice(0,4).toString('ascii')==='RIFF'&&b.slice(8,12).toString('ascii')==='WEBP'))throw Object.assign(Error('Unsupported image format.'),{code:'INVALID_IMAGE'});
 return{buffer:b,base64:b.toString('base64')}
}

async function prepare(buf){
 const s=sharp(buf).rotate(),m=await s.metadata();
 if(!m.width||!m.height)throw Object.assign(Error('Image dimensions are unreadable.'),{code:'INVALID_IMAGE'});
 const base=await s.resize({width:Math.min(2600,m.width),withoutEnlargement:true}).normalize().sharpen({sigma:1.1}).jpeg({quality:92,mozjpeg:true}).toBuffer();
 const z=await sharp(base).metadata(),W=z.width,H=z.height;
 if(!W||!H)throw Object.assign(Error('Prepared image dimensions are unreadable.'),{code:'INVALID_IMAGE'});
 return{base64:base.toString('base64'),width:W,height:H,buffer:base};
}



const SAFE_ROW_FLAGS=new Set(['digit_uncertain','continuation_uncertain','row_ownership_uncertain','name_uncertain','dob_uncertain']);
function parse(s){
 try{
  const cleaned=String(s||'').replace(/<think>[\s\S]*?<\/think>/gi,'').replace(new RegExp('\u0060\u0060\u0060json|\u0060\u0060\u0060','gi'),'').trim();
  const x=JSON.parse(cleaned);
  if(!x||!Array.isArray(x.people)||x.people.length>MAX)return null;
  const rows=[];
  for(const p of x.people){
   if(!p||typeof p!=='object'||Array.isArray(p)||!Number.isInteger(p.y)||p.y<0||p.y>1000||typeof p.n!=='string'||!Array.isArray(p.p)||p.p.length>2||p.p.some(v=>typeof v!=='string')||typeof p.d!=='string'||typeof p.c!=='boolean'||!Array.isArray(p.f)||p.f.some(v=>!SAFE_ROW_FLAGS.has(v)))return null;
   const name=p.n.replace(/\s+/g,' ').trim();
   const phones=p.p.map(v=>String(v).trim()).filter(Boolean);
   const dob=String(p.d).trim();
   if(!name&&!phones.length&&!dob)continue;
   const flags=[...p.f];
   // A named row cannot simultaneously be a continuation. Preserve the row,
   // reject the unsafe linkage, and send it to Review rather than merging it.
   const continuation=p.c===true&&!name;
   if(p.c===true&&name)flags.push('continuation_uncertain');
   rows.push({r:rows.length+1,y:p.y,n:name,p:phones,dob,c:continuation,f:[...new Set(flags)],e:'visible row on full-page image'});
  }
  return rows;
 }catch{return null}
}

function rateInfo(h){
 const n=v=>{const s=String(v||'').trim().toLowerCase();if(!s)return 0;if(/^\d+(?:\.\d+)?$/.test(s))return Number(s);const m=s.match(/([\d.]+)\s*(ms|s|m|h)/);return m?Number(m[1])*({ms:.001,s:1,m:60,h:3600}[m[2]]):0};
 return{retryAfter:n(h.get('retry-after')),resetTokens:n(h.get('x-ratelimit-reset-tokens')),resetRequests:n(h.get('x-ratelimit-reset-requests')),remainingTokens:h.get('x-ratelimit-remaining-tokens')==null?null:Number(h.get('x-ratelimit-remaining-tokens')),remainingRequests:h.get('x-ratelimit-remaining-requests')==null?null:Number(h.get('x-ratelimit-remaining-requests'))};
}

function cooldownSeconds(rate,message=''){return getRateLimitRetrySeconds({message,retryAfter:rate?.retryAfter,remainingTokens:rate?.remainingTokens,remainingRequests:rate?.remainingRequests,resetTokens:rate?.resetTokens,resetRequests:rate?.resetRequests})}

async function requestRegion(region,model,opt,attempt,jsonObjectFallback=false){
 const provider=getAIProvider(model.provider),id=crypto.randomUUID(),started=Date.now(),reasoningEffort=resolveScanReasoningEffort(opt?.scanReasoningEffort??SCAN_REASONING_EFFORT);
 const images=Array.isArray(region.images)&&region.images.length?region.images:[{label:'full_page',data:region.data,y0:region.y0,y1:region.y1}];
 const onlyFullPage=images.length===1&&String(images[0].label||'').includes('full_page');
 const detailNote=onlyFullPage?'Only the full-page image is available; use it as the source of truth.':`These ${images.length} images are overlapping crops from ONE register page, not separate pages. ${images.map((x,i)=>`Image ${i+1}: ${x.label} (original-page vertical bounds ${x.y0}-${x.y1}).`).join(' ')} Use the crop bounds and overlap to preserve row order, avoid duplicate rows, and estimate each y coordinate relative to the ORIGINAL full page.`;
 const body={model:model.model,messages:[{role:'user',content:[
  {type:'text',text:`${PROMPT}${formatScanLearningHints(opt?.scanLearning)}\n${SCAN_VISUAL_VERIFICATION_INSTRUCTION}\n${detailNote} Read all visible rows exactly once. Use y coordinates relative to the full original page.`},
  ...images.map(view=>({type:'image_url',image_url:{url:`data:image/jpeg;base64,${view.data}`}}))
 ]}],temperature:0,top_p:.9,reasoning_effort:reasoningEffort,reasoning_format:'hidden',max_completion_tokens:model.max_completion_tokens,response_format:jsonObjectFallback?{type:'json_object'}:SCHEMA};
 let telemetryLogged=false;
 const logAttempt=async(r,d,{extractionValid,failureClass,retryReason=null}={})=>{
  const usage=d?.usage||{},headers=r?.response?.headers,rate=headers?rateInfo(headers):{};
  await logAIUsage({
   organization_id:opt?.organization_id,job_id:opt?.job_id,request_id:id,
   model_key:PRIMARY_KEY,provider:model.provider,model:model.model,
   purpose:`scan_region_${region.id}`,prompt_version:getScanPipelineVersion(reasoningEffort),attempt,
   latency_ms:Date.now()-started,input_tokens:Number(usage.prompt_tokens||0),
   output_tokens:Number(usage.completion_tokens||0),
   reasoning_tokens:Number(usage.completion_tokens_details?.reasoning_tokens||0),
   total_tokens:Number(usage.total_tokens||0),http_status:r?.response?.status??null,
   success:Boolean(r?.response?.ok),http_ok:typeof r?.response?.ok==='boolean'?r.response.ok:null,
   extraction_valid:extractionValid,failure_class:failureClass||null,
   retry_reason:retryReason,
   finish_reason:d?.choices?.[0]?.finish_reason||null,
   rate_limit_remaining_tokens:headers?.get('x-ratelimit-remaining-tokens')??null,
   rate_limit_remaining_requests:headers?.get('x-ratelimit-remaining-requests')??null,
   rate_limit_reset_tokens:headers?.get('x-ratelimit-reset-tokens')??null,
   rate_limit_reset_requests:headers?.get('x-ratelimit-reset-requests')??null,
   retry_after:headers?.get('retry-after')??null
  }).catch(()=>{});
  telemetryLogged=true;
 };
 try{
  const r=await provider.request('/chat/completions',{headers:{'Content-Type':'application/json'},body:JSON.stringify(body),timeoutMs:TIMEOUT});
  const d=r.data||{},rate=rateInfo(r.response.headers),finishReason=d?.choices?.[0]?.finish_reason||null;
  if(!r.response.ok){
   const providerMessage=String(d?.error?.message||d?.error?.code||`Vision provider failed (${r.response.status})`);
   const inputBudgetError=isInputTokenBudgetError(r.response.status,providerMessage);
   const failureClass=inputBudgetError?'input_token_budget':r.response.status===429?'rate_limit':r.response.status===404?'model_unavailable':r.response.status===400?'provider_rejection':'provider_error';
   await logAttempt(r,d,{extractionValid:false,failureClass,retryReason:`HTTP ${r.response.status}: ${providerMessage.slice(0,240)}`});
   const retryDelaySeconds=r.response.status===429?cooldownSeconds(rate,providerMessage):0;
   throw Object.assign(Error(providerMessage),{code:inputBudgetError?'AI_INPUT_TOKEN_BUDGET':r.response.status===429?'AI_RATE_LIMIT':r.response.status===404?'AI_MODEL_UNAVAILABLE':'AI_PROVIDER_ERROR',status:r.response.status,provider:model.provider,providerModel:model.model,requestId:id,...rate,retryDelaySeconds,cooldownSeconds:retryDelaySeconds});
  }
  if(finishReason==='length'){
   await logAttempt(r,d,{extractionValid:false,failureClass:'output_truncated',retryReason:'HTTP 200 response ended with finish_reason=length'});
   throw Object.assign(Error('Vision output was truncated.'),{code:'AI_OUTPUT_TRUNCATED',provider:model.provider,providerModel:model.model,requestId:id,finish_reason:finishReason});
  }
  if(finishReason!=='stop'){
   await logAttempt(r,d,{extractionValid:false,failureClass:'invalid_finish_reason',retryReason:`HTTP 200 response ended with unacceptable finish_reason=${String(finishReason)}`});
   throw Object.assign(Error('Vision response did not finish cleanly.'),{code:'AI_INVALID_RESPONSE',provider:model.provider,providerModel:model.model,requestId:id,finish_reason:finishReason});
  }
  const people=parse(d?.choices?.[0]?.message?.content);
  if(!people){
   await logAttempt(r,d,{extractionValid:false,failureClass:'invalid_response',retryReason:'HTTP 200 response did not satisfy the scan row schema'});
   throw Object.assign(Error('Vision returned invalid JSON.'),{code:'AI_INVALID_RESPONSE',provider:model.provider,providerModel:model.model,requestId:id,finish_reason:finishReason});
  }
  if(people.length===0){
   await logAttempt(r,d,{extractionValid:false,failureClass:'empty_region',retryReason:'HTTP 200 response parsed, but this region returned no rows'});
   return{region,people,model:model.model,provider:model.provider,requestId:id,rate,finishReason};
  }
  await logAttempt(r,d,{extractionValid:true,failureClass:null});
  const withNames=people.filter(person=>String(person.n||'').trim()).length;
  const withPhones=people.filter(person=>Array.isArray(person.p)&&person.p.some(phone=>String(phone||'').trim())).length;
  const withDates=people.filter(person=>String(person.dob||'').trim()).length;
  const rowsNeedingFieldReview=people.filter(person=>!String(person.n||'').trim()||!Array.isArray(person.p)||!person.p.some(phone=>String(phone||'').trim())||(Array.isArray(person.f)&&person.f.length>0)).length;
  const rowsWithFlags=people.filter(person=>Array.isArray(person.f)&&person.f.length>0).length;
  await updateExtractionMetrics(id,people.length,people.length,rowsNeedingFieldReview,{rows_with_names:withNames,rows_without_names:people.length-withNames,name_coverage_rate:Number((withNames/people.length).toFixed(4)),rows_with_phones:withPhones,rows_without_phones:people.length-withPhones,phone_coverage_rate:Number((withPhones/people.length).toFixed(4)),rows_with_dates:withDates,rows_without_dates:people.length-withDates,rows_partial_or_uncertain:rowsNeedingFieldReview,rows_with_uncertainty_flags:rowsWithFlags,image_views:images.length});
  return{region,people,model:model.model,provider:model.provider,requestId:id,rate,finishReason};
 }catch(e){
  if(!telemetryLogged){
   const code=e?.name==='AbortError'||e?.status===504||e?.code==='AI_PROVIDER_TIMEOUT'?'timeout':'transport_error';
   await logAIUsage({
    organization_id:opt?.organization_id,job_id:opt?.job_id,request_id:id,
    model_key:PRIMARY_KEY,provider:model.provider,model:model.model,
    purpose:`scan_region_${region.id}`,prompt_version:getScanPipelineVersion(reasoningEffort),attempt,
    latency_ms:Date.now()-started,http_status:null,success:false,http_ok:false,
    extraction_valid:false,failure_class:code,
    retry_reason:`Provider request did not return an HTTP response: ${String(e?.message||e||code).slice(0,240)}`
   }).catch(()=>{});
   telemetryLogged=true;
  }
  if(e?.name==='AbortError'||e?.code==='AI_PROVIDER_TIMEOUT'||e?.status===504)throw Object.assign(Error(`Vision timed out on crop ${region.id}.`),{code:'AI_TIMEOUT',provider:model.provider,providerModel:model.model,requestId:id});
  throw e;
 }
}
async function callOne(region,model,opt,attempt,jsonObjectFallback=false){return requestRegion(region,model,opt,attempt,jsonObjectFallback)}
const JSON_RECOVERY_ERROR=/(?:failed to generate json|generated json does not match(?: the expected)? schema|expected schema|jsonschema|failed_generation|missing properties[^.]{0,80}people|does not validate with \/required)/i;
async function readRegion(region,opt){
 let attempt=1,rateLimitRetries=0,jsonFallbackUsed=false,budgetFallbackUsed=false,requestRegion=region;
 for(;;){
  try{
   const part=await callOne(requestRegion,PRIMARY,opt,attempt,jsonFallbackUsed);
   // A syntactically valid but empty people array is not evidence that the
   // handwritten region was read. Give it one constrained-output recovery pass.
   if(!jsonFallbackUsed&&part.people.length===0){
    jsonFallbackUsed=true;
    attempt++;
    continue;
   }
   return {...part,completenessStatus:part.people.length?'valid':'empty_unconfirmed',empty_reason:part.people.length?null:'empty_people_array',attempt_count:attempt};
  }catch(err){
   if(err?.code==='AI_INPUT_TOKEN_BUDGET'&&!budgetFallbackUsed&&Array.isArray(requestRegion.images)&&requestRegion.images.length>1){
    const fallback=makeFullPageBudgetFallback(requestRegion);
    if(fallback){budgetFallbackUsed=true;requestRegion=fallback;attempt++;continue;}
   }
   const wait=Number(err?.retryDelaySeconds??err?.cooldownSeconds);
   // Quota retries are bounded and always use the same Qwen 3.8 model.
   if(err?.code==='AI_RATE_LIMIT'){
    if(rateLimitRetries<2&&Number.isFinite(wait)&&wait>=0&&wait<=30){
     rateLimitRetries++;
     await new Promise(resolve=>setTimeout(resolve,Math.max(1000,Math.ceil(wait*1000)+250)));
     attempt++;
     continue;
    }
    // A short final Retry-After was misleading after repeated shared-OTPM
    // failures. Hold a conservative cooldown so the next scan does not
    // immediately repeat the same exhausted-capacity request.
    const safeCooldown=Math.max(MIN_RATE_LIMIT_COOLDOWN_SECONDS,Number.isFinite(wait)?wait:0);
    err.cooldownSeconds=safeCooldown;
    err.retryDelaySeconds=safeCooldown;
    throw err;
   }
   // Groq can reject strict structured output even when the image request was
   // accepted. Retry once on the same model in JSON-object mode, then enforce
   // the complete row contract locally; no malformed row reaches persistence.
   if(!jsonFallbackUsed&&(err?.code==='AI_INVALID_RESPONSE'||(err?.status===400&&JSON_RECOVERY_ERROR.test(String(err?.message||''))))){
    jsonFallbackUsed=true;
    attempt++;
    continue;
   }
   throw err;
  }
 }
}

function enrichForCurrentValidator(rows){return rows.map(row=>({r:row.r,y:row.y,x:500,n:row.n,name:row.n,p:row.p,phones:row.p,dob:row.dob||'',date_of_birth_raw:row.dob||null,c:row.c===true,f:row.f,flags:row.f,e:row.e,name_evidence:row.f?.includes('name_uncertain')?'ambiguous':'clear',phone_evidence:row.f?.includes('digit_uncertain')?'ambiguous':'clear',date_of_birth_evidence:row.f?.includes('dob_uncertain')?'ambiguous':row.dob?'clear':null,row_evidence:row.f?.some(x=>x==='continuation_uncertain'||x==='row_ownership_uncertain')?'ambiguous':'clear',name_alternatives:[],evidence_note:row.e}));}
export function getScanAdmission(){
 const configured=isAIProviderConfigured(PRIMARY.provider);
 return configured
  ?{allowed:true,max_people_per_page:MAX,pipeline_version:SCAN_PIPELINE_VERSION,model:PRIMARY.model,provider:PRIMARY.provider,regions:1,reasoning:SCAN_REASONING_EFFORT}
  :{allowed:false,code:'AI_NOT_CONFIGURED',message:'Groq Qwen vision is not configured.'};
}
function durationSeconds(value){const s=String(value??'').trim().toLowerCase();if(!s)return 0;if(/^\d+(?:\.\d+)?$/.test(s))return Number(s);let total=0,m,re=/(\d+(?:\.\d+)?)\s*(ms|s|m|h)/g;while((m=re.exec(s)))total+=Number(m[1])*({ms:.001,s:1,m:60,h:3600}[m[2]]);return total}
function cooldownLabel(seconds){const n=Math.max(1,Math.ceil(seconds));return n<60?String(n)+' sec':String(Math.ceil(n/60))+' min'}
export async function getScanAdmissionStatus(){
 const admission=getScanAdmission();
 if(!admission.allowed)return admission;
 try{
  const q=await pool.query(`SELECT created_at,retry_reason,rate_limit_remaining_tokens,rate_limit_reset_tokens,rate_limit_reset_requests,rate_limit_remaining_requests,retry_after FROM ai_usage_events WHERE provider=$1 AND http_status=429 AND created_at>NOW()-INTERVAL '10 minutes' ORDER BY created_at DESC LIMIT 1`,[PRIMARY.provider]);
  const row=q.rows[0];if(!row)return admission;
  const providerDelay=getRateLimitRetrySeconds({message:row.retry_reason,retryAfter:row.retry_after,remainingTokens:row.rate_limit_remaining_tokens,remainingRequests:row.rate_limit_remaining_requests,resetTokens:row.rate_limit_reset_tokens,resetRequests:row.rate_limit_reset_requests}),
   delay=Math.max(MIN_RATE_LIMIT_COOLDOWN_SECONDS,providerDelay),
   age=Math.max(0,(Date.now()-new Date(row.created_at).getTime())/1000),remaining=Math.max(0,delay-age);
  if(remaining<=0.05)return admission;
  return{...admission,allowed:false,code:'AI_RATE_LIMIT',retry_after_seconds:Number(remaining.toFixed(2)),message:`The shared ${PRIMARY.provider} vision service is briefly rate-limited. ARIA has not started this scan, so nothing was changed. Try again in about ${cooldownLabel(remaining)}.`};
 }catch(err){console.warn('[SCAN ADMISSION] Shared cooldown check unavailable:',err?.message||err);return admission}
}
export async function callVisionWithRetry(img,_unused,onProgress=null,opt={}){
 if(!isAIProviderConfigured(PRIMARY.provider))throw Object.assign(Error('Groq Qwen vision is not configured.'),{code:'AI_NOT_CONFIGURED',provider:PRIMARY.provider});
 const image=decode(img),page=await prepare(image.buffer),regions=await makeScanRegions(page);
 let regionsCompleted=0,activeRegion=0;
 const stage=regions.length>1?'reading_overlapping_regions':'reading_page';
 const progressDetail=(extra={})=>({phase:'reading',regions_total:regions.length,regions_completed:regionsCompleted,active_region:activeRegion||null,...extra});
 const report=(name,extra={})=>{try{onProgress?.(name,progressDetail(extra))}catch(err){console.warn('[SCAN_PROGRESS] Progress callback failed:',err?.message||err)}};
 const parts=[];
 report(stage,{active_region:1});
 const heartbeat=setInterval(()=>{if(activeRegion)report(stage,{active_region:activeRegion,heartbeat:true})},4000);
 try{
  // Region requests are intentionally sequential: parallel image requests were producing
  // avoidable provider contention and could leave the whole scan waiting on one failed region.
  for(let i=0;i<regions.length;i++){
   const region=regions[i];activeRegion=i+1;
   report(stage,{active_region:activeRegion});
   let part;
   try{part=await readRegion(region,opt)}
   catch(error){
    const failed={region,people:null,completenessStatus:'failed',outcome_reason:error?.code||'AI_PROVIDER_ERROR',error_code:error?.code||'AI_PROVIDER_ERROR',attempt_count:Math.max(1,Number(error?.attempt)||1),finishReason:error?.finish_reason||null,requestId:error?.requestId||null};
    error.scan_region_states=classifyScanRegions([...parts,failed]).regions;
    throw error;
   }
   parts.push(part);
   regionsCompleted++;
   report(stage,{active_region:activeRegion,regions_completed:regionsCompleted});
  }
 }finally{clearInterval(heartbeat)}
 const completeness=classifyScanRegions(parts);
 if(completeness.requiresConfirmation){
  report('needs_confirmation',{phase:'confirm',requires_confirmation:true,reason:'empty_people_array',region_states:completeness.regions});
  return{requiresConfirmation:true,completeness:{requires_confirmation:true,reason:'empty_people_array',regions:completeness.regions},provider:PRIMARY.provider,model:PRIMARY.model,request_id:parts.map(x=>x.requestId).join(','),pipeline_version:SCAN_PIPELINE_VERSION,verification:{passes:parts.length,extracted:parts.reduce((n,x)=>n+(Array.isArray(x.people)?x.people.length:0),0),mode:'single_request_budgeted_vision_views_groq_qwen_only',reviewed:false,agreement:null,disagreements:[],dob_disagreements:[],regions:parts.length,crosscheck_model:null},diagnostic:{regions:completeness.regions}};
 }
 if(!completeness.complete)throw Object.assign(Error('One or more register regions could not be validated.'),{code:'AI_INVALID_RESPONSE',provider:PRIMARY.provider,providerModel:PRIMARY.model});
 const merged=mergeScanRegions(parts,page.height,MAX);
 if(!merged.length)throw Object.assign(Error('No readable register rows were found.'),{code:'AI_INVALID_RESPONSE',provider:PRIMARY.provider,providerModel:PRIMARY.model});
 report('validating_extraction',{phase:'validating',rows_extracted:merged.length});
 const people=enrichForCurrentValidator(merged);
 report('validating_extraction',{phase:'validating',rows_extracted:people.length,dob_rows:people.filter(x=>x.dob).length});
 return{
  data:{choices:[{message:{content:JSON.stringify({people})},finish_reason:'stop'}]},
  provider:PRIMARY.provider,
  model:PRIMARY.model,
  verification:{passes:regions.length,extracted:people.length,mode:'single_request_budgeted_vision_views_groq_qwen_only',reviewed:false,agreement:null,disagreements:[],dob_disagreements:[],regions:regions.length,crosscheck_model:null},
  tokenPlan:{regions:regions.length,crosscheck:0,recovery:'single Groq Qwen request with two overlapping detail views when available, or a full-page budget fallback; compact structured output and uncertainty preserved for Review'},
  vision:`groq-${PRIMARY.model}`,
  pipeline_version:SCAN_PIPELINE_VERSION,
  request_id:parts.map(x=>x.requestId).join(','),
  rate_limit:parts.at(-1)?.rate||null,
  diagnostic:{image_views:parts.reduce((n,x)=>n+(Array.isArray(x.region?.images)?x.region.images.length:1),0),provider_requests:parts.length,regions:parts.map(x=>({region:x.region.id,rows:x.people.length,model:x.model,provider:x.provider,image_views:Array.isArray(x.region?.images)?x.region.images.length:1}))}
 };
}

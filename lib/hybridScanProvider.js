// lib/hybridScanProvider.js
import sharp from 'sharp';
import crypto from 'crypto';
import {getModelConfig} from './modelRegistry';
import {logAIUsage} from './aiObserver';
import pool from './db';
import {getAIProvider,isAIProviderConfigured} from './aiProviders';
import {getRateLimitRetrySeconds} from './scanRateLimit';
import {mergeScanRegions} from './scanRegionMerge';
import {classifyScanRegions} from './scanCompleteness';

const PRIMARY_KEY='groq-qwen3.8-27b';
const PRIMARY=getModelConfig(PRIMARY_KEY);

export const SCAN_PIPELINE_VERSION='v72-single-full-page-otpm-safe';
const MIN_RATE_LIMIT_COOLDOWN_SECONDS=8;
const MAX=50,TIMEOUT=55000;
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const PROMPT=`Read this handwritten register page from top to bottom. Preserve every full visible name exactly as written, including titles, honorifics, initials, abbreviations, spelling, and capitalization. Never drop or normalize a title. Do not guess missing or unclear characters; transcribe only visible evidence and flag uncertainty. Handwritten SIS is the three-letter honorific S-I-S; do not transcribe it as SB unless B is genuinely visible. Preserve every visible phone digit literally; never repair digits or borrow a number from another row. A person may have two numbers; include both only when visibly written for that same person. A blank-name continuation may attach to the previous person only when physical row position proves it; otherwise flag continuation_uncertain or row_ownership_uncertain. Read a date of birth only when visibly written for that person on the same row; return exact text in d, or an empty string, and never infer or reformat it. Flag unclear names, digits, and dates with name_uncertain, digit_uncertain, and dob_uncertain. Ignore headers, totals, registration dates, and non-birthday notes. This is the full prepared page, not a crop. Return each visible person once in top-to-bottom order and set y to the vertical center from 0 to 1000 across the entire page. Return ONLY compact JSON: {"people":[{"y":500,"n":"literal full name including title","p":["visible phone"],"d":"exact DOB text or empty string","f":[]}]} . Flags may only be digit_uncertain, continuation_uncertain, row_ownership_uncertain, name_uncertain, dob_uncertain. Keep output minimal and do not add explanations. Maximum ${MAX} people.`;

const SCHEMA={type:'json_schema',json_schema:{name:'nyeocare_register_page',strict:true,schema:{type:'object',additionalProperties:false,properties:{people:{type:'array',maxItems:MAX,items:{type:'object',additionalProperties:false,properties:{y:{type:'integer',minimum:0,maximum:1000},n:{type:'string'},p:{type:'array',maxItems:2,items:{type:'string'}},d:{type:'string'},f:{type:'array',items:{type:'string',enum:['digit_uncertain','continuation_uncertain','row_ownership_uncertain','name_uncertain','dob_uncertain']}}},required:['y','n','p','d','f']}}},required:['people']}}};

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

async function makeRegions(page){
 const{width:W,height:H}=page;
 // Preserve full-page coverage while using a single provider request. Returning
 // only the top overlapping crop would silently omit the bottom of the register.
 return[{id:1,y0:0,y1:H,w:W,h:H,data:page.base64}];
}

const SAFE_ROW_FLAGS=new Set(['digit_uncertain','continuation_uncertain','row_ownership_uncertain','name_uncertain','dob_uncertain']);
function parse(s){
 try{
  const cleaned=String(s||'').replace(/<think>[\s\S]*?<\/think>/gi,'').replace(new RegExp('\u0060\u0060\u0060json|\u0060\u0060\u0060','gi'),'').trim();
  const x=JSON.parse(cleaned);
  if(!x||!Array.isArray(x.people)||x.people.length>MAX)return null;
  const rows=[];
  for(const p of x.people){
   if(!p||typeof p!=='object'||Array.isArray(p)||!Number.isInteger(p.y)||p.y<0||p.y>1000||typeof p.n!=='string'||!Array.isArray(p.p)||p.p.length>2||p.p.some(v=>typeof v!=='string')||typeof p.d!=='string'||!Array.isArray(p.f)||p.f.some(v=>!SAFE_ROW_FLAGS.has(v)))return null;
   rows.push({r:rows.length+1,y:p.y,n:p.n,p:p.p,dob:p.d,f:p.f,e:'visible row on full-page image'});
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
 const provider=getAIProvider(model.provider),id=crypto.randomUUID(),started=Date.now();
 const body={model:model.model,messages:[{role:'user',content:[
  {type:'text',text:`${PROMPT}\nRead the complete register page. Return all visible rows exactly once, from top to bottom. Use y coordinates relative to the entire image, not a crop.`},
  {type:'image_url',image_url:{url:`data:image/jpeg;base64,${region.data}`}}
 ]}],temperature:0,top_p:.9,reasoning_effort:'none',reasoning_format:'hidden',max_completion_tokens:Math.min(900,model.max_completion_tokens),response_format:jsonObjectFallback?{type:'json_object'}:SCHEMA};
 let telemetryLogged=false;
 const logAttempt=async(r,d,{extractionValid,failureClass,retryReason=null}={})=>{
  const usage=d?.usage||{},headers=r?.response?.headers,rate=headers?rateInfo(headers):{};
  await logAIUsage({
   organization_id:opt?.organization_id,job_id:opt?.job_id,request_id:id,
   model_key:PRIMARY_KEY,provider:model.provider,model:model.model,
   purpose:`scan_region_${region.id}`,prompt_version:SCAN_PIPELINE_VERSION,attempt,
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
   const failureClass=r.response.status===429?'rate_limit':r.response.status===404?'model_unavailable':r.response.status===400?'provider_rejection':'provider_error';
   await logAttempt(r,d,{extractionValid:false,failureClass,retryReason:`HTTP ${r.response.status}: ${providerMessage.slice(0,240)}`});
   const retryDelaySeconds=r.response.status===429?cooldownSeconds(rate,providerMessage):0;
   throw Object.assign(Error(providerMessage),{code:r.response.status===429?'AI_RATE_LIMIT':r.response.status===404?'AI_MODEL_UNAVAILABLE':'AI_PROVIDER_ERROR',status:r.response.status,provider:model.provider,providerModel:model.model,requestId:id,...rate,retryDelaySeconds,cooldownSeconds:retryDelaySeconds});
  }
  if(finishReason==='length'){
   await logAttempt(r,d,{extractionValid:false,failureClass:'output_truncated',retryReason:'HTTP 200 response ended with finish_reason=length'});
   throw Object.assign(Error('Vision output was truncated.'),{code:'AI_OUTPUT_TRUNCATED',provider:model.provider,providerModel:model.model,requestId:id,finish_reason:finishReason});
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
  return{region,people,model:model.model,provider:model.provider,requestId:id,rate,finishReason};
 }catch(e){
  if(!telemetryLogged){
   const code=e?.name==='AbortError'||e?.status===504||e?.code==='AI_PROVIDER_TIMEOUT'?'timeout':'transport_error';
   await logAIUsage({
    organization_id:opt?.organization_id,job_id:opt?.job_id,request_id:id,
    model_key:PRIMARY_KEY,provider:model.provider,model:model.model,
    purpose:`scan_region_${region.id}`,prompt_version:SCAN_PIPELINE_VERSION,attempt,
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
 let attempt=1,rateLimitRetries=0,jsonFallbackUsed=false;
 for(;;){
  try{
   const part=await callOne(region,PRIMARY,opt,attempt,jsonFallbackUsed);
   // A syntactically valid but empty people array is not evidence that the
   // handwritten region was read. Give it one constrained-output recovery pass.
   if(!jsonFallbackUsed&&part.people.length===0){
    jsonFallbackUsed=true;
    attempt++;
    continue;
   }
   return {...part,completenessStatus:part.people.length?'valid':'empty_unconfirmed',empty_reason:part.people.length?null:'empty_people_array',attempt_count:attempt};
  }catch(err){
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

function enrichForCurrentValidator(rows){return rows.map(row=>({r:row.r,y:row.y,x:500,n:row.n,name:row.n,p:row.p,phones:row.p,dob:row.dob||'',date_of_birth_raw:row.dob||null,f:row.f,flags:row.f,e:row.e,name_evidence:row.f?.includes('name_uncertain')?'ambiguous':'clear',phone_evidence:row.f?.includes('digit_uncertain')?'ambiguous':'clear',date_of_birth_evidence:row.f?.includes('dob_uncertain')?'ambiguous':row.dob?'clear':null,row_evidence:row.f?.some(x=>x==='continuation_uncertain'||x==='row_ownership_uncertain')?'ambiguous':'clear',name_alternatives:[],evidence_note:row.e}));}
export function getScanAdmission(){
 const configured=isAIProviderConfigured(PRIMARY.provider);
 return configured
  ?{allowed:true,max_people_per_page:MAX,pipeline_version:SCAN_PIPELINE_VERSION,model:PRIMARY.model,provider:PRIMARY.provider,regions:1,reasoning:'none'}
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
 const image=decode(img),page=await prepare(image.buffer),regions=await makeRegions(page);
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
   const part=await readRegion(region,opt);
   parts.push(part);
   regionsCompleted++;
   report(stage,{active_region:activeRegion,regions_completed:regionsCompleted});
  }
 }finally{clearInterval(heartbeat)}
 const completeness=classifyScanRegions(parts);
 if(completeness.requiresConfirmation){
  report('needs_confirmation',{phase:'confirm',requires_confirmation:true,reason:'empty_people_array',region_states:completeness.regions});
  return{requiresConfirmation:true,completeness:{requires_confirmation:true,reason:'empty_people_array',regions:completeness.regions},provider:PRIMARY.provider,model:PRIMARY.model,request_id:parts.map(x=>x.requestId).join(','),pipeline_version:SCAN_PIPELINE_VERSION,verification:{passes:parts.length,extracted:parts.reduce((n,x)=>n+(Array.isArray(x.people)?x.people.length:0),0),mode:'single_full_page_groq_qwen_only',reviewed:false,agreement:null,disagreements:[],dob_disagreements:[],regions:parts.length,crosscheck_model:null},diagnostic:{regions:completeness.regions}};
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
  verification:{passes:regions.length,extracted:people.length,mode:'single_full_page_groq_qwen_only',reviewed:false,agreement:null,disagreements:[],dob_disagreements:[],regions:regions.length,crosscheck_model:null},
  tokenPlan:{regions:regions.length,crosscheck:0,recovery:'single full-page Groq Qwen request with compact structured output; uncertain fields remain in Review'},
  vision:`groq-${PRIMARY.model}`,
  pipeline_version:SCAN_PIPELINE_VERSION,
  request_id:parts.map(x=>x.requestId).join(','),
  rate_limit:parts.at(-1)?.rate||null,
  diagnostic:{regions:parts.map(x=>({region:x.region.id,rows:x.people.length,model:x.model,provider:x.provider}))}
 };
}

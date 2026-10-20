// lib/hybridScanProvider.js
import sharp from 'sharp';
import crypto from 'crypto';
import {getModelConfig} from './modelRegistry';
import {logAIUsage} from './aiObserver';
import pool from './db';
import {getAIProvider,isAIProviderConfigured} from './aiProviders';
import {getRateLimitRetrySeconds} from './scanRateLimit';
import {mergeScanRegions} from './scanRegionMerge';

const PRIMARY_KEY='groq-qwen3.8-27b';
const PRIMARY=getModelConfig(PRIMARY_KEY);

export const SCAN_PIPELINE_VERSION='v70-overlap-row-alignment-honorific-calibration';
const MAX=50,TIMEOUT=55000;
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const PROMPT=`Read this handwritten register as a physical document. Fidelity to the visible page is the priority. Read top-to-bottom and keep each person's full visible name in n exactly as written, including any prefix, honorific, title, initials and abbreviations (for example Sis, Sister, Bro, Pastor, Reverend, Elder, Deacon, Mummy, Mother, Mr, Mrs, Dr, Rev, Engr, Barr, Prof, Alhaji, Alhaja). Never drop a title, move it out of n, expand it, replace it, or normalize spelling/capitalization. Do not guess a missing name part. Handwritten "SIS" is the three-letter honorific S-I-S. Examine all three letter shapes and compare repeated title forms on the same page: connected handwriting can make the final S resemble B. Do not transcribe SIS as SB unless B is genuinely visible; if the title is genuinely unclear, preserve the visible evidence and flag name_uncertain. If any name character or title is unclear, transcribe only visible evidence and flag name_uncertain. Preserve every visible phone digit literally; never repair digits because a number looks plausible. If a digit is unclear flag digit_uncertain. A person may have two numbers. Never borrow a phone from a nearby row. A blank-name continuation is valid only when the physical position proves it belongs to the prior person; otherwise flag continuation_uncertain or row_ownership_uncertain. Read a date of birth only if it is visibly written for that person on the same row. Put its exact visible text in dob (do not reformat it); use an empty string when no DOB is present, never infer a DOB or add a missing year. If a date is present but ambiguous, transcribe the visible text and flag dob_uncertain. Ignore headers, totals, registration dates and notes that are not a person's birth date. This is an overlapping crop of a larger page. Return only visible rows and y=vertical center 0-1000 within this crop. Return ONLY JSON: {\"people\":[{\"r\":1,\"y\":500,\"n\":\"literal full name including title\",\"p\":[\"visible phone\"],\"dob\":\"exact birth-date text or empty string\",\"f\":[],\"e\":\"same physical row\"}]}. Flags may only be digit_uncertain, continuation_uncertain, row_ownership_uncertain, name_uncertain, dob_uncertain. Maximum ${MAX}.`;

const SCHEMA={type:'json_schema',json_schema:{name:'nyeocare_register_region',strict:true,schema:{
 type:'object',additionalProperties:false,properties:{people:{type:'array',maxItems:MAX,items:{type:'object',additionalProperties:false,properties:{
 r:{type:'integer',minimum:1,maximum:MAX},y:{type:'integer',minimum:0,maximum:1000},n:{type:'string'},
 p:{type:'array',maxItems:2,items:{type:'string'}},dob:{type:'string'},
 f:{type:'array',items:{type:'string',enum:['digit_uncertain','continuation_uncertain','row_ownership_uncertain','name_uncertain','dob_uncertain']}},
 e:{type:'string'}
 },required:['r','y','n','p','dob','f','e']}}},required:['people']}}};

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
 if(H<900)return[{id:1,y0:0,y1:H,w:W,h:H,data:page.base64}];
 const h=Math.round(H*.62),bottom=Math.max(0,H-h);
 const defs=[{id:1,y0:0,y1:h},{id:2,y0:bottom,y1:H}];
 return Promise.all(defs.map(async x=>({
  id:x.id,y0:x.y0,y1:x.y1,w:W,h:x.y1-x.y0,
  data:(await sharp(page.buffer).extract({left:0,top:x.y0,width:W,height:x.y1-x.y0}).jpeg({quality:92,mozjpeg:true}).toBuffer()).toString('base64')
 })));
}

const SAFE_ROW_FLAGS=new Set(['digit_uncertain','continuation_uncertain','row_ownership_uncertain','name_uncertain','dob_uncertain']);
function parse(s){
 try{
  const x=JSON.parse(String(s||'').replace(/<think>[\s\S]*?<\/think>/gi,'').replace(/```json|```/gi,'').trim());
  if(!x||!Array.isArray(x.people)||x.people.length>MAX)return null;
  const rows=[];
  for(const p of x.people){
   if(!p||typeof p!=='object'||Array.isArray(p)||!Number.isInteger(p.r)||p.r<1||p.r>MAX||!Number.isInteger(p.y)||p.y<0||p.y>1000||typeof p.n!=='string'||!Array.isArray(p.p)||p.p.length>2||p.p.some(v=>typeof v!=='string')||typeof p.dob!=='string'||!Array.isArray(p.f)||p.f.some(v=>!SAFE_ROW_FLAGS.has(v))||typeof p.e!=='string')return null;
   rows.push({r:p.r,y:p.y,n:p.n,p:p.p,dob:p.dob,f:p.f,e:p.e});
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
  {type:'text',text:`${PROMPT}\nThis is crop ${region.id}; original page vertical bounds ${region.y0}-${region.y1}.`},
  {type:'image_url',image_url:{url:`data:image/jpeg;base64,${region.data}`}}
 ]}],temperature:0,top_p:.9,reasoning_effort:'low',reasoning_format:'hidden',max_completion_tokens:Math.min(5200,model.max_completion_tokens),response_format:jsonObjectFallback?{type:'json_object'}:SCHEMA};
 try{
  const r=await provider.request('/chat/completions',{headers:{'Content-Type':'application/json'},body:JSON.stringify(body),timeoutMs:TIMEOUT});
  const d=r.data||{},u=d?.usage||{},rate=rateInfo(r.response.headers);
  await logAIUsage({organization_id:opt?.organization_id,job_id:opt?.job_id,request_id:id,model_key:PRIMARY_KEY,provider:model.provider,model:model.model,purpose:`scan_region_${region.id}`,prompt_version:SCAN_PIPELINE_VERSION,attempt,latency_ms:Date.now()-started,input_tokens:Number(u.prompt_tokens||0),output_tokens:Number(u.completion_tokens||0),reasoning_tokens:Number(u.completion_tokens_details?.reasoning_tokens||0),total_tokens:Number(u.total_tokens||0),http_status:r.response.status,success:r.response.ok,retry_reason:r.response.ok?null:`HTTP ${r.response.status}: ${String(d?.error?.message||d?.error?.code||'Vision request rejected').slice(0,240)}`,finish_reason:d?.choices?.[0]?.finish_reason||null,rate_limit_remaining_tokens:r.response.headers.get('x-ratelimit-remaining-tokens'),rate_limit_remaining_requests:r.response.headers.get('x-ratelimit-remaining-requests'),rate_limit_reset_tokens:r.response.headers.get('x-ratelimit-reset-tokens'),rate_limit_reset_requests:r.response.headers.get('x-ratelimit-reset-requests'),retry_after:r.response.headers.get('retry-after')}).catch(()=>{});
  if(!r.response.ok){
   const providerMessage=String(d?.error?.message||d?.error?.code||`Vision provider failed (${r.response.status})`),
    retryDelaySeconds=r.response.status===429?cooldownSeconds(rate,providerMessage):0;
   throw Object.assign(Error(providerMessage),{code:r.response.status===429?'AI_RATE_LIMIT':r.response.status===404?'AI_MODEL_UNAVAILABLE':'AI_PROVIDER_ERROR',status:r.response.status,provider:model.provider,providerModel:model.model,requestId:id,...rate,retryDelaySeconds,cooldownSeconds:retryDelaySeconds});
  }
  if(d?.choices?.[0]?.finish_reason==='length')throw Object.assign(Error('Vision output was truncated.'),{code:'AI_OUTPUT_TRUNCATED',provider:model.provider,providerModel:model.model,requestId:id});
  const people=parse(d?.choices?.[0]?.message?.content);
  if(!people)throw Object.assign(Error('Vision returned invalid JSON.'),{code:'AI_INVALID_RESPONSE',provider:model.provider,providerModel:model.model,requestId:id});
  return{region,people,model:model.model,provider:model.provider,requestId:id,rate};
 }catch(e){if(e?.name==='AbortError'||e?.code==='AI_PROVIDER_TIMEOUT'||e?.status===504)throw Object.assign(Error(`Vision timed out on crop ${region.id}.`),{code:'AI_TIMEOUT',provider:model.provider,providerModel:model.model,requestId:id});throw e;}
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
   return part;
  }catch(err){
   const wait=Number(err?.retryDelaySeconds??err?.cooldownSeconds);
   // Quota retries are bounded and always use the same Qwen 3.8 model.
   if(err?.code==='AI_RATE_LIMIT'&&rateLimitRetries<2&&Number.isFinite(wait)&&wait>=0&&wait<=30){
    rateLimitRetries++;
    await new Promise(resolve=>setTimeout(resolve,Math.ceil(wait*1000)+120));
    attempt++;
    continue;
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
  ?{allowed:true,max_people_per_page:MAX,pipeline_version:SCAN_PIPELINE_VERSION,model:PRIMARY.model,provider:PRIMARY.provider,regions:2,reasoning:'low'}
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
  const delay=getRateLimitRetrySeconds({message:row.retry_reason,retryAfter:row.retry_after,remainingTokens:row.rate_limit_remaining_tokens,remainingRequests:row.rate_limit_remaining_requests,resetTokens:row.rate_limit_reset_tokens,resetRequests:row.rate_limit_reset_requests}),
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
 const merged=mergeScanRegions(parts,page.height,MAX);
 if(!merged.length)throw Object.assign(Error('No readable register rows were found.'),{code:'AI_INVALID_RESPONSE',provider:PRIMARY.provider,providerModel:PRIMARY.model});
 report('validating_extraction',{phase:'validating',rows_extracted:merged.length});
 const people=enrichForCurrentValidator(merged);
 report('validating_extraction',{phase:'validating',rows_extracted:people.length,dob_rows:people.filter(x=>x.dob).length});
 return{
  data:{choices:[{message:{content:JSON.stringify({people})},finish_reason:'stop'}]},
  provider:PRIMARY.provider,
  model:PRIMARY.model,
  verification:{passes:regions.length,extracted:people.length,mode:'overlapping_regions_groq_qwen_only',reviewed:false,agreement:null,disagreements:[],dob_disagreements:[],regions:regions.length,crosscheck_model:null},
  tokenPlan:{regions:regions.length,crosscheck:0,recovery:'overlapping Groq Qwen regions with literal name, phone, and DOB extraction; uncertainty remains in Review'},
  vision:`groq-${PRIMARY.model}`,
  pipeline_version:SCAN_PIPELINE_VERSION,
  request_id:parts.map(x=>x.requestId).join(','),
  rate_limit:parts.at(-1)?.rate||null,
  diagnostic:{regions:parts.map(x=>({region:x.region.id,rows:x.people.length,model:x.model,provider:x.provider}))}
 };
}

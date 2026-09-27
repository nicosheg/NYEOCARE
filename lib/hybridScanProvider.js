// lib/hybridScanProvider.js
import sharp from 'sharp';
import crypto from 'crypto';
import {getModelConfig} from './modelRegistry';
import {logAIUsage} from './aiObserver';
import {getAIProvider,isAIProviderConfigured} from './aiProviders';

const PRIMARY_KEY=process.env.AI_SCAN_MODEL_KEY||'groq-qwen3.8-27b';
const FALLBACK_KEY=process.env.AI_SCAN_FALLBACK_MODEL_KEY||'groq-qwen3.6-27b';
const PRIMARY=getModelConfig(PRIMARY_KEY);
const FALLBACK=getModelConfig(FALLBACK_KEY);
const GEMINI=process.env.GEMINI_API_KEY;
const GEMINI_MODEL=process.env.GEMINI_SCAN_MODEL||'gemini-2.5-flash-lite';

export const SCAN_PIPELINE_VERSION='v65-hybrid-multiregion-crosscheck-revived';
const MAX=50,TIMEOUT=55000;
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const digits=v=>String(v??'').replace(/\D/g,'');
const nk=v=>clean(v).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z\s'\-]/g,' ').replace(/\s+/g,' ').trim();

function cleanNameTitle(v){
 let s=clean(v);if(!s)return s;
 s=s.replace(/^(sus|sIs|sls|sis)\b/i,'Sis');
 return s.replace(/^(sist)\b/i,'Sister');
}

const PROMPT=`Read this handwritten register as a physical document. Accuracy of characters and phone-to-person ownership is more important than completing every row. Read top-to-bottom. Preserve names literally; never autocorrect, complete, shorten or replace unfamiliar Nigerian/African/Christian names. Preserve every visible phone digit literally; never repair a digit because a Nigerian number looks plausible. If a digit is unclear flag digit_uncertain. A person may have two numbers. A blank-name line directly below a named row is a continuation only when physical placement supports it. Never borrow a phone from a nearby row. Ignore headers, totals, dates and notes. This is an overlapping crop of a larger page. Return only visible rows and y=vertical center 0-1000 within this crop. Return ONLY JSON: {"people":[{"r":1,"y":500,"n":"visible name","p":["visible phone"],"f":[],"e":"same physical row"}]}. Flags may only be digit_uncertain, continuation_uncertain, row_ownership_uncertain, name_uncertain. Maximum ${MAX}.`;

const SCHEMA={type:'json_schema',json_schema:{name:'nyeocare_register_region',strict:true,schema:{
 type:'object',additionalProperties:false,properties:{people:{type:'array',maxItems:MAX,items:{type:'object',additionalProperties:false,properties:{
 r:{type:'integer',minimum:1,maximum:MAX},y:{type:'integer',minimum:0,maximum:1000},n:{type:'string'},
 p:{type:'array',maxItems:2,items:{type:'string'}},
 f:{type:'array',items:{type:'string',enum:['digit_uncertain','continuation_uncertain','row_ownership_uncertain','name_uncertain']}},
 e:{type:'string'}
 },required:['r','y','n','p','f','e']}}},required:['people']}}};

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

function parse(s){
 try{
  const x=JSON.parse(String(s||'').replace(/<think>[\s\S]*?<\/think>/gi,'').replace(/```json|```/gi,'').trim());
  return x&&Array.isArray(x.people)?x.people:null;
 }catch{return null}
}

function rateInfo(h){
 const n=v=>{const s=String(v||'').trim().toLowerCase();if(!s)return 0;if(/^\d+(?:\.\d+)?$/.test(s))return Number(s);const m=s.match(/([\d.]+)\s*(ms|s|m|h)/);return m?Number(m[1])*({ms:.001,s:1,m:60,h:3600}[m[2]]):0};
 return{retryAfter:n(h.get('retry-after')),resetTokens:n(h.get('x-ratelimit-reset-tokens')),resetRequests:n(h.get('x-ratelimit-reset-requests')),remainingTokens:Number(h.get('x-ratelimit-remaining-tokens')),remainingRequests:Number(h.get('x-ratelimit-remaining-requests'))};
}

function cooldownSeconds(rate){return Math.min(120,Math.max(0,Math.ceil(Math.max(rate?.retryAfter||0,rate?.resetTokens||0,rate?.resetRequests||0))));}

async function requestRegion(region,model,opt,attempt){
 const provider=getAIProvider(model.provider),id=crypto.randomUUID(),started=Date.now();
 const body={model:model.model,messages:[{role:'user',content:[
  {type:'text',text:`${PROMPT}\nThis is crop ${region.id}; original page vertical bounds ${region.y0}-${region.y1}.`},
  {type:'image_url',image_url:{url:`data:image/jpeg;base64,${region.data}`}}
 ]}],temperature:0,top_p:.9,reasoning_effort:'high',reasoning_format:'hidden',max_completion_tokens:Math.min(5200,model.max_completion_tokens),response_format:model===PRIMARY?SCHEMA:{type:'json_object'}};
 try{
  const r=await provider.request('/chat/completions',{headers:{'Content-Type':'application/json'},body:JSON.stringify(body),timeoutMs:TIMEOUT});
  const d=r.data||{},u=d?.usage||{},rate=rateInfo(r.response.headers);
  await logAIUsage({organization_id:opt?.organization_id,job_id:opt?.job_id,request_id:id,model_key:model===PRIMARY?PRIMARY_KEY:FALLBACK_KEY,provider:model.provider,model:model.model,purpose:`scan_region_${region.id}`,prompt_version:SCAN_PIPELINE_VERSION,attempt,latency_ms:Date.now()-started,input_tokens:Number(u.prompt_tokens||0),output_tokens:Number(u.completion_tokens||0),reasoning_tokens:Number(u.completion_tokens_details?.reasoning_tokens||0),total_tokens:Number(u.total_tokens||0),http_status:r.response.status,success:r.response.ok,finish_reason:d?.choices?.[0]?.finish_reason||null,rate_limit_remaining_tokens:r.response.headers.get('x-ratelimit-remaining-tokens'),rate_limit_remaining_requests:r.response.headers.get('x-ratelimit-remaining-requests'),rate_limit_reset_tokens:r.response.headers.get('x-ratelimit-reset-tokens'),rate_limit_reset_requests:r.response.headers.get('x-ratelimit-reset-requests'),retry_after:r.response.headers.get('retry-after')}).catch(()=>{});
  if(!r.response.ok)throw Object.assign(Error(d?.error?.message||`Vision provider failed (${r.response.status})`),{code:r.response.status===429?'AI_RATE_LIMIT':r.response.status===404?'AI_MODEL_UNAVAILABLE':'AI_PROVIDER_ERROR',status:r.response.status,provider:model.provider,providerModel:model.model,requestId:id,...rate,cooldownSeconds:cooldownSeconds(rate)});
  if(d?.choices?.[0]?.finish_reason==='length')throw Object.assign(Error('Vision output was truncated.'),{code:'AI_OUTPUT_TRUNCATED',provider:model.provider,providerModel:model.model,requestId:id});
  const people=parse(d?.choices?.[0]?.message?.content);
  if(!people)throw Object.assign(Error('Vision returned invalid JSON.'),{code:'AI_INVALID_RESPONSE',provider:model.provider,providerModel:model.model,requestId:id});
  return{region,people,model:model.model,provider:model.provider,requestId:id,rate};
 }catch(e){if(e?.name==='AbortError'||e?.code==='AI_PROVIDER_TIMEOUT'||e?.status===504)throw Object.assign(Error(`Vision timed out on crop ${region.id}.`),{code:'AI_TIMEOUT',provider:model.provider,providerModel:model.model,requestId:id});throw e;}
}

async function readRegion(region,opt,index){try{return await requestRegion(region,PRIMARY,opt,index)}catch(e){if(e?.code==='AI_RATE_LIMIT')throw e;if(!isAIProviderConfigured(FALLBACK.provider))throw e;return requestRegion(region,FALLBACK,opt,index+10);}}

function mergeRegions(parts,pageH){
 const all=[];for(const part of parts)for(const p of part.people||[]){const y=part.region.y0+(Math.max(0,Math.min(1000,Number(p.y)||0))/1000)*(part.region.y1-part.region.y0),phones=(Array.isArray(p.p)?p.p:[]).map(clean).filter(Boolean).slice(0,2),name=cleanNameTitle(p.n);if(!name&&!phones.length)continue;all.push({y,name,phones,flags:Array.isArray(p.f)?p.f:[],e:clean(p.e),regions:[part.region.id]});}
 all.sort((a,b)=>a.y-b.y);const groups=[];
 for(const x of all){let hit=null;for(const g of groups){const dy=Math.abs(g.y-x.y),sameName=x.name&&g.name&&nk(x.name)===nk(g.name),samePhone=x.phones.some(p=>g.phones.some(q=>digits(p)===digits(q)));if(dy<Math.max(55,pageH*.035)&&(sameName||samePhone||dy<pageH*.018)){hit=g;break;}}if(!hit)groups.push(x);else{if(x.name&&(!hit.name||x.name.length>hit.name.length))hit.name=x.name;for(const p of x.phones)if(!hit.phones.some(q=>digits(q)===digits(p)))hit.phones.push(p);hit.phones=hit.phones.slice(0,2);hit.flags.push(...x.flags);hit.e=[hit.e,x.e].filter(Boolean).join('; ');hit.regions.push(...x.regions);}}
 for(let i=1;i<groups.length;i++){const x=groups[i],prev=groups[i-1],dy=x.y-prev.y;if(!x.name&&x.phones.length&&prev.name&&dy>=0&&dy<pageH*.06&&prev.phones.length<2){for(const p of x.phones)if(!prev.phones.some(q=>digits(q)===digits(p)))prev.phones.push(p);prev.flags.push(...x.flags,'continuation_uncertain');prev.e=[prev.e,x.e,'blank-name continuation line below previous named row'].filter(Boolean).join('; ');groups.splice(i,1);i--;}}
 return groups.slice(0,MAX).map((x,i)=>({r:i+1,y:Math.round(x.y/pageH*1000),n:x.name,p:x.phones.slice(0,2),f:[...new Set(x.flags)],e:x.e}));
}

async function geminiCrosscheck(imageBase64,candidates){
 if(!GEMINI)return null;try{
  const schema={type:'object',properties:{people:{type:'array',maxItems:MAX,items:{type:'object',properties:{r:{type:'integer'},n:{type:'string'},p:{type:'array',maxItems:2,items:{type:'string'}},f:{type:'array',items:{type:'string'}},e:{type:'string'}},required:['r','n','p','f','e'],additionalProperties:false}}},required:['people'],additionalProperties:false};
  const prompt=`Independently verify this handwritten register. The image is authoritative. Compare these candidate rows character-by-character, especially every phone digit and continuation ownership. Do not silently repair. Return your literal reading. Mark uncertainty whenever the image does not clearly settle a name, digit, or row ownership. Candidate rows:\n${JSON.stringify({people:candidates})}`;
  const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt},{inlineData:{mimeType:'image/jpeg',data:imageBase64}}]}],generationConfig:{temperature:0,responseMimeType:'application/json',responseSchema:schema,maxOutputTokens:6000}})});const d=await r.json().catch(()=>({}));if(!r.ok)return null;return parse(d?.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join(''));
 }catch{return null}
}

function compare(a,b){if(!b)return{enabled:false,agreement:null,disagreements:[]};const ds=[];for(let i=0;i<Math.max(a.length,b.length);i++){const x=a[i],y=b[i];if(!x||!y){ds.push(i);continue;}const xp=(x.p||[]).map(digits),yp=(y.p||[]).map(digits);if(!(nk(x.n)===nk(y.n)&&xp.length===yp.length&&xp.every(v=>yp.includes(v))))ds.push(i);}return{enabled:true,agreement:!ds.length,disagreements:ds};}
function flagDisagreements(rows,cross){const c=compare(rows,cross);if(!cross||c.agreement)return rows;return rows.map((row,i)=>c.disagreements.includes(i)?{...row,f:[...new Set([...(row.f||[]),'row_ownership_uncertain'])],e:[row.e,'Independent vision cross-check disagreed; verify the original image.'].filter(Boolean).join(' ')}:row);}
function enrichForCurrentValidator(rows){return rows.map(row=>({r:row.r,y:row.y,x:500,n:row.n,name:row.n,p:row.p,phones:row.p,f:row.f,flags:row.f,e:row.e,name_evidence:row.f?.includes('name_uncertain')?'ambiguous':'clear',phone_evidence:row.f?.includes('digit_uncertain')?'ambiguous':'clear',row_evidence:row.f?.some(x=>x==='continuation_uncertain'||x==='row_ownership_uncertain')?'ambiguous':'clear',name_alternatives:[],evidence_note:row.e}));}
export function getScanAdmission(){const configured=isAIProviderConfigured(PRIMARY.provider);return configured?{allowed:true,max_people_per_page:MAX,pipeline_version:SCAN_PIPELINE_VERSION,model:PRIMARY.model,provider:PRIMARY.provider,regions:2,crosscheck_model:GEMINI?GEMINI_MODEL:null,reasoning:'high'}:{allowed:false,code:'AI_NOT_CONFIGURED',message:'ARIA scan is not configured.'};}
export async function callVisionWithRetry(img,_unused,onProgress=null,opt={}){if(!isAIProviderConfigured(PRIMARY.provider))throw Object.assign(Error('ARIA vision provider is not configured.'),{code:'AI_NOT_CONFIGURED',provider:PRIMARY.provider});const image=decode(img),page=await prepare(image.buffer),regions=await makeRegions(page);onProgress?.(regions.length>1?'reading_overlapping_regions':'reading_page');const parts=await Promise.all(regions.map((region,i)=>readRegion(region,opt,i+1)));const merged=mergeRegions(parts,page.height);if(!merged.length)throw Object.assign(Error('No readable register rows were found.'),{code:'AI_INVALID_RESPONSE'});onProgress?.(GEMINI?'cross_checking':'validating_extraction');const checked=await geminiCrosscheck(image.base64,merged),finalRows=flagDisagreements(merged,checked),verification=compare(merged,checked),people=enrichForCurrentValidator(finalRows);return{data:{choices:[{message:{content:JSON.stringify({people})},finish_reason:'stop'}]},provider:PRIMARY.provider,model:PRIMARY.model,verification:{passes:regions.length+(checked?1:0),extracted:people.length,mode:'overlapping_regions_plus_independent_crosscheck',reviewed:!!checked,agreement:verification.agreement,disagreements:verification.disagreements,regions:regions.length,crosscheck_model:checked?GEMINI_MODEL:null},tokenPlan:{regions:regions.length,crosscheck:checked?6000:0,recovery:'overlapping regions with independent cross-check; disagreements require human review'},vision:`hybrid-${PRIMARY.model}`,pipeline_version:SCAN_PIPELINE_VERSION,request_id:parts.map(x=>x.requestId).join(','),rate_limit:parts.at(-1)?.rate||null,diagnostic:{regions:parts.map(x=>({region:x.region.id,rows:x.people.length,model:x.model})),crosscheck:verification}};}

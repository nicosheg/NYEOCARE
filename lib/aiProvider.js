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

const schema={type:'object',properties:{people:{type:'array',items:{type:'object',properties:{
row_number:{type:['integer','null']},
name:{type:['string','null']},
phone:{type:['string','null']},
name_x:{type:['integer','null']},
name_y:{type:['integer','null']},
phone_x:{type:['integer','null']},
phone_y:{type:['integer','null']},
pair_confidence:{type:'number'},
name_confidence:{type:'number'},
phone_confidence:{type:'number'}
},required:['row_number','name','phone','name_x','name_y','phone_x','phone_y','pair_confidence','name_confidence','phone_confidence'],additionalProperties:false}}},required:['people'],additionalProperties:false};

function retryable(status){return[408,429,500,502,503,504].includes(status)}

function parsePeople(content){
try{
const parsed=JSON.parse(String(content||'').replace(/<think>[\s\S]*?<\/think>/gi,'').trim());
return Array.isArray(parsed?.people)?parsed.people:[];
}catch{return[]}
}

function cleanName(v){return String(v||'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\b(sis|sister|bro|brother|mr|mrs|miss|ms|pastor|past|pst|dr|rev|reverend|elder|deacon|deaconess|chief)\b/g,' ').replace(/\s+/g,' ').trim()}
function digits(v){return String(v||'').replace(/\D/g,'')}
function validCoord(v){return Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=1000}
function rowY(p){const a=Number(p?.name_y),b=Number(p?.phone_y);if(validCoord(a)&&validCoord(b))return(a+b)/2;const r=Number(p?.row_number);return Number.isFinite(r)?r*100:null}
function physicallyPaired(p){
const nx=Number(p?.name_x),px=Number(p?.phone_x),ny=Number(p?.name_y),py=Number(p?.phone_y);
return validCoord(nx)&&validCoord(px)&&validCoord(ny)&&validCoord(py)&&nx<px&&Math.abs(ny-py)<=65&&Number(p?.pair_confidence)>=85;
}

function nearestRows(rows,target,used){
let best=null,bestDistance=Infinity;
for(let i=0;i<rows.length;i++){
if(used.has(i))continue;
const d=Math.abs(rowY(rows[i])-rowY(target));
if(d<=65&&d<bestDistance){best=i;bestDistance=d}
}
return best;
}

function reconcile(firstContent,secondContent,thirdContent=''){
const first=parsePeople(firstContent),second=parsePeople(secondContent),third=parsePeople(thirdContent);
const usedSecond=new Set(),usedThird=new Set(),pairs=[];
for(let i=0;i<first.length;i++){
const a=first[i],j=nearestRows(second,a,usedSecond),k=j===null?null:nearestRows(third,a,usedThird);
if(j!==null)usedSecond.add(j);
if(k!==null)usedThird.add(k);
pairs.push({a,b:j===null?null:second[j],c:k===null?null:third[k]});
}
for(let j=0;j<second.length;j++)if(!usedSecond.has(j))pairs.push({a:null,b:second[j],c:null});
for(let k=0;k<third.length;k++)if(!usedThird.has(k))pairs.push({a:null,b:null,c:third[k]});

const output=[];
for(const pair of pairs){
const rows=[pair.a,pair.b,pair.c].filter(Boolean);
if(!rows.length)continue;
const values=rows.map(x=>({name:String(x.name||'').trim()||null,phone:String(x.phone||'').trim()||null}));
const nameCounts=new Map(),phoneCounts=new Map();
for(const v of values){
if(v.name){const key=cleanName(v.name);nameCounts.set(key,(nameCounts.get(key)||0)+1)}
if(v.phone){const key=digits(v.phone);phoneCounts.set(key,(phoneCounts.get(key)||0)+1)}
}
const bestName=[...nameCounts.entries()].sort((a,b)=>b[1]-a[1])[0];
const bestPhone=[...phoneCounts.entries()].sort((a,b)=>b[1]-a[1])[0];
const nameRow=rows.find(x=>bestName&&cleanName(x.name)===bestName[0])||rows[0];
const phoneRow=rows.find(x=>bestPhone&&digits(x.phone)===bestPhone[0])||rows[0];
const name=bestName&&bestName[1]>=2?nameRow.name:null;
const phone=bestPhone&&bestPhone[1]>=2?phoneRow.phone:null;
const physicallyValid=rows.every(physicallyPaired);
const sameRow=rows.length>=2&&rows.every(x=>Math.abs(rowY(x)-rowY(rows[0]))<=65);
const nameAgreement=!!bestName&&bestName[1]>=2;
const phoneAgreement=!!bestPhone&&bestPhone[1]>=2;
const reasons=[];
if(rows.length<2)reasons.push('missing_independent_pass');
if(!nameAgreement)reasons.push('name_disagreement');
if(!phoneAgreement)reasons.push('phone_disagreement');
if(!physicallyValid)reasons.push('physical_row_pairing_uncertain');
if(!sameRow)reasons.push('row_alignment_uncertain');
const verified=!!name&&!!phone&&physicallyValid&&sameRow&&nameAgreement&&phoneAgreement;
const confidence=verified?98:Math.min(...rows.map(x=>Math.max(0,Math.min(100,Number(x.pair_confidence)||0))),70);
output.push({
row_number:Number(nameRow.row_number??phoneRow.row_number)||null,
name:verified?String(name).trim():String(nameRow.name||'').trim()||null,
phone:verified?String(phone).trim():String(phoneRow.phone||'').trim()||null,
name_x:nameRow.name_x??null,
name_y:nameRow.name_y??null,
phone_x:phoneRow.phone_x??null,
phone_y:phoneRow.phone_y??null,
pair_confidence:confidence,
name_confidence:verified?98:Number(nameRow.name_confidence)||0,
phone_confidence:verified?98:Number(phoneRow.phone_confidence)||0,
verification_status:verified?'verified':'review',
verification_reasons:reasons,
verification_alternatives:{
first:{name:pair.a?.name||null,phone:pair.a?.phone||null},
second:{name:pair.b?.name||null,phone:pair.b?.phone||null},
third:{name:pair.c?.name||null,phone:pair.c?.phone||null}
}
});
}
return output.sort((a,b)=>(Number(a.row_number)||99999)-(Number(b.row_number)||99999));
}

function promptFor(mode,draft='',draft2=''){
const base=`You are ARIA, a forensic register digitisation engine. Read the ORIGINAL photographed register itself. Do not infer missing information.

The page contains physical rows. A person's name and phone must belong to the SAME physical horizontal row.

Return EVERY genuine person row visible.

For every row:
- Transcribe the name exactly as visible.
- Transcribe the phone digits exactly as visible.
- Never invent or repair a digit.
- Never borrow a phone from an adjacent row.
- Never pair two separate columns by array position.
- Ignore headers, logos, totals and notes.
- Do not split one physical row into two people.
- Do not merge two physical rows.
- Titles such as Sis, Bro, Mrs, Mr, Pastor may be present; keep them in the visual name.
- If any field is unreadable, return null for that field.
- Coordinates are NORMALIZED 0-1000 relative to the entire image.
- name_x/name_y are the approximate center of the visible name.
- phone_x/phone_y are the approximate center of the visible phone.
- row_number is physical top-to-bottom order.
- pair_confidence describes how certain you are that name and phone occupy the same physical row.
- Never fabricate coordinates. If uncertain, use null.
- JSON only.`;
if(mode==='extract')return base+`\\nPerform a complete first-pass extraction. Inspect the entire image before answering.`;
if(mode==='verify')return base+`\\nPerform an INDEPENDENT second reading from scratch. The draft may be wrong. Challenge it rather than copying it.\\nFIRST DRAFT:\\n${draft}`;
return base+`\\nPerform a final adjudication. Inspect the original image and resolve disagreements between the independent drafts. Do not choose a value merely because it appears in a draft.\\nDRAFT A:\\n${draft}\\nDRAFT B:\\n${draft2}`;
}

async function callGroq(imageBase64,options={}){
if(!GROQ_API_KEY)throw Object.assign(new Error('AI service is not configured'),{status:503,retryable:false});
if(!imageBase64||typeof imageBase64!=='string'||imageBase64.length<10)throw Object.assign(new Error('Invalid image data'),{status:400,retryable:false});
const{organization_id,job_id,purpose='scan',prompt_version='v5',attempt=1,evaluation=false,mode='extract',draft='',draft2=''}=options;
const config=getModelConfig(DEFAULT_MODEL_KEY);
let reservationId=null,settled=false;
if(!evaluation){
const budget=await reserveBudget(organization_id,purpose,DEFAULT_MODEL_KEY);
if(!budget.allowed)throw Object.assign(new Error('AI service temporarily unavailable'),{status:429,retryable:false});
reservationId=budget.reservationId;
}
const requestId=randomUUID(),started=Date.now(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
try{
const response=await fetch(GROQ_URL,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${GROQ_API_KEY}`},body:JSON.stringify({
model:config.model,
messages:[{role:'user',content:[{type:'text',text:promptFor(mode,draft,draft2)},{type:'image_url',image_url:{url:`data:image/jpeg;base64,${imageBase64}`}}]}],
temperature:.1,
top_p:.9,
max_completion_tokens:config.max_completion_tokens,
reasoning_effort:config.supports_reasoning_effort?'high':'none',
reasoning_format:'hidden',
response_format:config.supports_structured_output?{type:'json_schema',json_schema:{name:'register_people',strict:true,schema}}:{type:'json_object'}
}),signal:controller.signal});
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
const first=await callGroq(imageBase64,{...options,attempt,mode:'extract'});
const firstContent=first?.data?.choices?.[0]?.message?.content||'';
if(!parsePeople(firstContent).length)throw Object.assign(new Error('ARIA produced no readable register rows'),{status:502,retryable:true});
const second=await callGroq(imageBase64,{...options,attempt,mode:'verify',draft:firstContent});
const secondContent=second?.data?.choices?.[0]?.message?.content||'';
if(!parsePeople(secondContent).length)throw Object.assign(new Error('ARIA verification produced no readable rows'),{status:502,retryable:true});
let thirdContent='';
const preliminary=reconcile(firstContent,secondContent);
if(preliminary.some(x=>x.verification_status==='review')){
const third=await callGroq(imageBase64,{...options,attempt,mode:'adjudicate',draft:firstContent,draft2:secondContent});
thirdContent=third?.data?.choices?.[0]?.message?.content||'';
if(!parsePeople(thirdContent).length)throw Object.assign(new Error('ARIA adjudication produced no readable rows'),{status:502,retryable:true});
}
const reconciled=reconcile(firstContent,secondContent,thirdContent);
const content=JSON.stringify({people:reconciled});
return{...second,data:{...second.data,choices:[{...(second.data.choices?.[0]||{}),message:{...(second.data.choices?.[0]?.message||{}),content}}]},attempt,verification:{passes:thirdContent?3:2,verified:reconciled.filter(x=>x.verification_status==='verified').length,review:reconciled.filter(x=>x.verification_status!=='verified').length}};
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

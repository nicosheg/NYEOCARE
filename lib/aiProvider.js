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
function rowNumber(p){const n=Number(p?.row_number);return Number.isInteger(n)&&n>0?n:null}
function rowY(p){const a=Number(p?.name_y),b=Number(p?.phone_y);if(validCoord(a)&&validCoord(b))return(a+b)/2;return null}

function physicallyPaired(p){
const nx=Number(p?.name_x),px=Number(p?.phone_x),ny=Number(p?.name_y),py=Number(p?.phone_y);
return validCoord(nx)&&validCoord(px)&&validCoord(ny)&&validCoord(py)&&nx<px&&Math.abs(ny-py)<=28&&Number(p?.pair_confidence)>=90;
}

function pairKey(p){
const n=cleanName(p?.name),ph=digits(p?.phone);
return n&&ph?`${n}|${ph}`:null;
}

function samePhysicalRow(a,b){
const ar=rowNumber(a),br=rowNumber(b);
if(ar!==null&&br!==null)return ar===br;
const ay=rowY(a),by=rowY(b);
return ay!==null&&by!==null&&Math.abs(ay-by)<=28;
}

function findAligned(rows,target,used){
const rn=rowNumber(target);
if(rn!==null){
const exact=rows.findIndex((x,i)=>!used.has(i)&&rowNumber(x)===rn);
if(exact>=0)return exact;
}
const ty=rowY(target);
if(ty===null)return null;
let best=null,distance=Infinity;
for(let i=0;i<rows.length;i++){
if(used.has(i))continue;
const y=rowY(rows[i]);
if(y===null)continue;
const d=Math.abs(y-ty);
if(d<=28&&d<distance){best=i;distance=d}
}
return best;
}

function reconcile(firstContent,secondContent,thirdContent=''){
const passes=[parsePeople(firstContent),parsePeople(secondContent),parsePeople(thirdContent)];
const[first,second,third]=passes;
const used=[new Set(),new Set(),new Set()],groups=[];

for(let i=0;i<first.length;i++){
const a=first[i];
const j=findAligned(second,a,used[1]);
const k=findAligned(third,a,used[2]);
if(j!==null)used[1].add(j);
if(k!==null)used[2].add(k);
groups.push([a,j===null?null:second[j],k===null?null:third[k]]);
}
for(let j=0;j<second.length;j++)if(!used[1].has(j))groups.push([null,second[j],null]);
for(let k=0;k<third.length;k++)if(!used[2].has(k))groups.push([null,null,third[k]]);

return groups.map(rows=>{
const present=rows.filter(Boolean);
if(!present.length)return null;
const counts=new Map();
for(const row of present){
const key=pairKey(row);
if(key)counts.set(key,(counts.get(key)||0)+1);
}
const best=[...counts.entries()].sort((a,b)=>b[1]-a[1])[0]||null;
const support=best?present.filter(row=>pairKey(row)===best[0]):[];
const rowAgreement=support.length>=2&&support.every((row,i)=>i===0||samePhysicalRow(support[0],row));
const physical= support.length>=2&&support.every(physicallyPaired);
const verified=!!best&&best[1]>=2&&rowAgreement&&physical;
const source=support[0]||present[0];
const reasons=[];
if(present.length<3)reasons.push('missing_independent_pass');
if(!best||best[1]<2)reasons.push('name_phone_pair_disagreement');
if(!physical)reasons.push('physical_row_pairing_uncertain');
if(!rowAgreement)reasons.push('row_alignment_uncertain');
const confidence=verified?(best[1]===3?99:98):Math.min(89,...present.map(x=>Math.max(0,Math.min(89,Number(x.pair_confidence)||0))));
return{
row_number:rowNumber(source),
name:String(source?.name||'').trim()||null,
phone:String(source?.phone||'').trim()||null,
name_x:source?.name_x??null,
name_y:source?.name_y??null,
phone_x:source?.phone_x??null,
phone_y:source?.phone_y??null,
pair_confidence:confidence,
name_confidence:verified?98:Number(source?.name_confidence)||0,
phone_confidence:verified?98:Number(source?.phone_confidence)||0,
verification_status:verified?'verified':'review',
verification_reasons:reasons,
verification_alternatives:{
first:{name:rows[0]?.name||null,phone:rows[0]?.phone||null,row_number:rows[0]?.row_number||null},
second:{name:rows[1]?.name||null,phone:rows[1]?.phone||null,row_number:rows[1]?.row_number||null},
third:{name:rows[2]?.name||null,phone:rows[2]?.phone||null,row_number:rows[2]?.row_number||null}
}
}).filter(Boolean).sort((a,b)=>(Number(a.row_number)||99999)-(Number(b.row_number)||99999));
}

function promptFor(mode,draft='',draft2=''){
const base=`You are ARIA, a forensic register digitisation engine. Read the ORIGINAL photographed register itself.

CRITICAL: NAME AND PHONE ARE ONE PHYSICAL ROW. NEVER borrow a phone from the row above or below.

Read the register row-by-row from top to bottom before producing JSON.

For every genuine person row:
- Transcribe the visible name exactly.
- Transcribe every visible phone digit exactly.
- Never invent, repair, complete or normalize a digit that you cannot actually see.
- Never pair by array position.
- Never move a phone between rows.
- Never merge rows.
- Never split rows.
- Ignore headers, logos, totals and decorative text.
- Keep titles such as Sis, Bro, Mrs, Mr and Pastor in the visual name.
- If either field is not safely readable, return null for that field.
- row_number is physical top-to-bottom order.
- Coordinates are normalized 0-1000 against the entire image.
- name_x/name_y identify the center of the visible name.
- phone_x/phone_y identify the center of the visible phone.
- pair_confidence means confidence that THIS name and THIS phone occupy the SAME physical row.
- Before finalizing each row, verify that name_y and phone_y are on the same horizontal line.
- Never fabricate coordinates.
- JSON only.`;

if(mode==='extract')return `${base}\nPerform the first independent extraction from scratch.`;
if(mode==='verify')return `${base}\nPerform a completely independent second reading. The draft below is untrusted. Re-read the image and challenge every name, digit and row pairing.\nDRAFT A:\n${draft}`;
return `${base}\nPerform a final forensic adjudication from the ORIGINAL IMAGE. Do not assume either draft is correct. Resolve only what you can visually verify. If two drafts disagree and the image does not prove the answer, return the row for human review instead of guessing.\nDRAFT A:\n${draft}\nDRAFT B:\n${draft2}`;
}

async function callGroq(imageBase64,options={}){
if(!GROQ_API_KEY)throw Object.assign(new Error('AI service is not configured'),{status:503,retryable:false});
if(!imageBase64||typeof imageBase64!=='string'||imageBase64.length<10)throw Object.assign(new Error('Invalid image data'),{status:400,retryable:false});
const{organization_id,job_id,purpose='scan',prompt_version='v6',attempt=1,evaluation=false,mode='extract',draft='',draft2=''}=options;
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
const third=await callGroq(imageBase64,{...options,attempt,mode:'adjudicate',draft:firstContent,draft2:secondContent});
const thirdContent=third?.data?.choices?.[0]?.message?.content||'';
if(!parsePeople(thirdContent).length)throw Object.assign(new Error('ARIA adjudication produced no readable rows'),{status:502,retryable:true});
const reconciled=reconcile(firstContent,secondContent,thirdContent);
const content=JSON.stringify({people:reconciled});
return{...third,data:{...third.data,choices:[{...(third.data.choices?.[0]||{}),message:{...(third.data.choices?.[0]?.message||{}),content}}]},attempt,verification:{passes:3,verified:reconciled.filter(x=>x.verification_status==='verified').length,review:reconciled.filter(x=>x.verification_status!=='verified').length}};
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

// lib/aiGateway.js
import{randomUUID}from'crypto';
import{getModelConfig}from'./modelRegistry';
import{logAIUsage}from'./aiObserver';
import{reserveBudget,confirmReservation,cancelReservation}from'./budgetGuard';
import{groqRequest}from'./aiProviders/groq';

const DEFAULT_MODEL_KEY=process.env.GROQ_TEXT_MODEL_KEY||process.env.GROQ_VISION_MODEL_KEY||'groq-qwen3.6-27b';
const STT_MODEL_KEY=process.env.GROQ_STT_MODEL_KEY||'groq-whisper-large-v3-turbo';
const TTS_MODEL_KEY=process.env.GROQ_TTS_MODEL_KEY||'groq-orpheus-v1-english';

const clean=(v,max=12000)=>String(v??'').trim().slice(0,max);
const retryable=s=>[408,429,500,502,503,504].includes(s);

export async function generateText({system='',messages=[],user='',modelKey=DEFAULT_MODEL_KEY,organizationId=null,jobId=null,purpose='aria',maxTokens=500,temperature=.4,json=false}={}){
 const config=getModelConfig(modelKey);
 const safeMessages=Array.isArray(messages)?messages.map(m=>({
  role:m.role==='assistant'?'assistant':'user',
  content:clean(m.content,16000)
 })):[];

 if(system)safeMessages.unshift({role:'system',content:clean(system,16000)});
 if(user)safeMessages.push({role:'user',content:clean(user,16000)});

 const payload={
  model:config.model,
  messages:safeMessages,
  temperature:Math.max(0,Math.min(1,Number(temperature)||0)),
  max_completion_tokens:Math.min(Math.max(Number(maxTokens)||500,1),config.max_completion_tokens)
 };

 if(json&&config.supports_json_object)payload.response_format={type:'json_object'};
 if(config.supports_reasoning_effort)payload.reasoning_effort='none';

 let reservationId=null;
 let settled=false;
 const requestId=randomUUID();
 const started=Date.now();

 try{
  if(organizationId){
   const budget=await reserveBudget(organizationId,purpose,modelKey);
   if(!budget.allowed)throw Object.assign(new Error('AI service temporarily unavailable'),{status:429,retryable:false,budgetExceeded:true});
   reservationId=budget.reservationId;
  }

  const result=await groqRequest('/chat/completions',{
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify(payload)
  });

  const latency=Date.now()-started;

  if(!result.response.ok){
   if(reservationId){await cancelReservation(reservationId);settled=true}
   if(organizationId)await logAIUsage({
    organization_id:organizationId,
    job_id:jobId,
    request_id:requestId,
    model_key:modelKey,
    provider:config.provider,
    model:config.model,
    purpose,
    prompt_version:'v1',
    attempt:1,
    latency_ms:latency,
    finish_reason:'error',
    http_status:result.response.status,
    success:false,
    retry_reason:result.data?.error?.message||`HTTP ${result.response.status}`
   });
   throw Object.assign(new Error('AI service temporarily unavailable'),{
    status:result.response.status,
    retryable:retryable(result.response.status),
    retryAfter:result.response.headers.get('retry-after')
   });
  }

  const usage=result.data?.usage||{};
  const inputTokens=Number.isFinite(Number(usage.prompt_tokens))?Number(usage.prompt_tokens):null;
  const outputTokens=Number.isFinite(Number(usage.completion_tokens))?Number(usage.completion_tokens):null;

  if(reservationId){
   if(inputTokens===null||outputTokens===null){
    await cancelReservation(reservationId);
    settled=true;
    throw Object.assign(new Error('AI response accounting error'),{status:500,retryable:false});
   }
   const actualCost=inputTokens/1000*config.input_cost_per_1k+outputTokens/1000*config.output_cost_per_1k;
   if(!await confirmReservation(reservationId,actualCost))throw Object.assign(new Error('AI accounting confirmation failed'),ilable:true
 };
  }

// lib/aiGateway.js
import{randomUUID}from'crypto';
import pool from'./db';
import{getModelConfig}from'./modelRegistry';
import{logAIUsage}from'./aiObserver';
import{reserveBudget,confirmReservation,cancelReservation}from'./budgetGuard';
import{getAIProvider,listAIProviders}from'./aiProviders';

const DEFAULT_MODEL_KEY=process.env.AI_TEXT_MODEL_KEY||process.env.GROQ_TEXT_MODEL_KEY||'groq-qwen3.8-27b';
const STT_MODEL_KEY=process.env.AI_STT_MODEL_KEY||process.env.GROQ_STT_MODEL_KEY||'groq-whisper-large-v3-turbo';
const TTS_MODEL_KEY=process.env.AI_TTS_MODEL_KEY||process.env.GROQ_TTS_MODEL_KEY||'groq-orpheus-v1-english';
const clean=(v,max=12000)=>String(v??'').trim().slice(0,max);
const retryable=s=>[408,429,500,502,503,504].includes(Number(s));

async function readCachedText(organizationId,idempotencyKey){
 if(!organizationId||!idempotencyKey)return null;
 const r=await pool.query(
  `SELECT response
   FROM ai_request_cache
   WHERE organization_id=$1
     AND idempotency_key=$2
     AND expires_at>NOW()
   LIMIT 1`,
  [organizationId,String(idempotencyKey).slice(0,500)]
 );
 return r.rows[0]?.response||null;
}

async function writeCachedText(organizationId,idempotencyKey,modelKey,provider,response){
 if(!organizationId||!idempotencyKey)return;
 await pool.query(
  `INSERT INTO ai_request_cache(organization_id,idempotency_key,model_key,provider,response,expires_at)
   VALUES($1,$2,$3,$4,$5::jsonb,NOW()+INTERVAL '1 hour')
   ON CONFLICT(organization_id,idempotency_key) DO UPDATE
   SET model_key=EXCLUDED.model_key,provider=EXCLUDED.provider,response=EXCLUDED.response,created_at=NOW(),expires_at=EXCLUDED.expires_at`,
  [organizationId,String(idempotencyKey).slice(0,500),modelKey,provider,JSON.stringify(response)]
 );
}

export async function generateText({
 system='',messages=[],user='',modelKey=DEFAULT_MODEL_KEY,organizationId=null,jobId=null,
 purpose='aria',maxTokens=500,temperature=.4,json=false,idempotencyKey=null
}={}){
 const config=getModelConfig(modelKey);
 const adapter=getAIProvider(config.provider);
 const cacheKey=idempotencyKey?String(idempotencyKey).trim().slice(0,500):null;
 const cached=cacheKey?await readCachedText(organizationId,cacheKey):null;
 if(cached&&typeof cached.text==='string'){
  return{...cached,cached:true};
 }

 const safeMessages=Array.isArray(messages)
  ?messages.map(m=>({role:m.role==='assistant'?'assistant':'user',content:clean(m.content,16000)}))
  :[];
 if(system)safeMessages.unshift({role:'system',content:clean(system,16000)});
 if(user)safeMessages.push({role:'user',content:clean(user,16000)});

 let reservationId=null,settled=false;
 const requestId=randomUUID(),started=Date.now();

 try{
  if(organizationId){
   const budget=await reserveBudget(organizationId,purpose,modelKey,{idempotencyKey:cacheKey});
   if(!budget.allowed)throw Object.assign(new Error('AI service temporarily unavailable'),{status:429,retryable:false,budgetExceeded:true});
   reservationId=budget.reservationId;
  }

  const payload={
   model:config.model,
   messages:safeMessages,
   temperature:Math.max(0,Math.min(1,Number(temperature)||0)),
   max_completion_tokens:Math.min(Math.max(Number(maxTokens)||500,1),config.max_completion_tokens),
   reasoning_effort:config.supports_reasoning_effort?'none':undefined
  };
  if(json&&config.supports_json_object)payload.response_format={type:'json_object'};

  const result=await adapter.request('/chat/completions',{
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify(payload)
  });
  const latency=Date.now()-started;

  if(!result.response.ok){
   if(reservationId){await cancelReservation(reservationId);settled=true}
   if(organizationId)await logAIUsage({
    organization_id:organizationId,job_id:jobId,request_id:requestId,model_key:modelKey,
    provider:config.provider,model:config.model,purpose,prompt_version:'v5-provider-agnostic',
    attempt:1,latency_ms:latency,finish_reason:'error',http_status:result.response.status,
    success:false,retry_reason:result.data?.error?.message||`HTTP ${result.response.status}`
   });
   throw Object.assign(new Error('AI service temporarily unavailable'),{
    status:result.response.status,retryable:retryable(result.response.status),
    retryAfter:result.response.headers.get('retry-after'),provider:config.provider
   });
  }

  const usage=result.data?.usage||{};
  const inputTokens=Number.isFinite(Number(usage.total_input_tokens??usage.prompt_tokens))
   ?Number(usage.total_input_tokens??usage.prompt_tokens):null;
  const outputTokens=Number.isFinite(Number(usage.total_output_tokens??usage.completion_tokens))
   ?Number(usage.total_output_tokens??usage.completion_tokens):null;

  if(reservationId){
   if(inputTokens===null||outputTokens===null){
    await cancelReservation(reservationId);settled=true;
    throw Object.assign(new Error('AI response accounting error'),{status:500,retryable:false});
   }
   const actualCost=inputTokens/1000*config.input_cost_per_1k+outputTokens/1000*config.output_cost_per_1k;
   if(!await confirmReservation(reservationId,actualCost))
    throw Object.assign(new Error('AI accounting confirmation failed'),{status:500,retryable:false});
   settled=true;
  }

  const choice=result.data?.choices?.[0];
  const text=choice?.message?.content;
  const finishReason=choice?.finish_reason||'stop';
  if(typeof text!=='string'||!text.trim())
   throw Object.assign(new Error('AI returned an empty response'),{status:502,retryable:true});

  if(organizationId)await logAIUsage({
   organization_id:organizationId,job_id:jobId,request_id:requestId,model_key:modelKey,
   provider:config.provider,model:config.model,purpose,prompt_version:'v5-provider-agnostic',
   attempt:1,input_tokens:inputTokens,output_tokens:outputTokens,latency_ms:latency,
   finish_reason:finishReason,http_status:result.response.status,success:true
  });

  const response={text:text.trim(),requestId,finishReason,usage:{inputTokens,outputTokens}};
  if(cacheKey)await writeCachedText(organizationId,cacheKey,modelKey,config.provider,response);
  return response;
 }catch(err){
  if(reservationId&&!settled)try{await cancelReservation(reservationId)}catch{}
  throw err;
 }
}

export async function transcribeAudio({
 buffer,mimeType='audio/webm',filename='aria.webm',language='en',prompt='',
 organizationId=null,purpose='aria_voice_transcription',idempotencyKey=null
}={}){
 if(!Buffer.isBuffer(buffer)||!buffer.length)throw Object.assign(new Error('Audio data required'),{status:400});
 const maxBytes=Number(process.env.ARIA_MAX_AUDIO_BYTES)||25*1024*1024;
 if(buffer.length>maxBytes)throw Object.assign(new Error('Audio file is too large'),{status:413});

 const config=getModelConfig(STT_MODEL_KEY),adapter=getAIProvider(config.provider);
 const form=new FormData();
 form.append('file',new Blob([buffer],{type:mimeType}),filename);
 form.append('model',config.model);
 form.append('response_format','json');
 if(language)form.append('language',language);
 if(prompt)form.append('prompt',clean(prompt,900));

 const requestId=randomUUID(),started=Date.now();
 let reservationId=null,reservationCost=null;
 try{
  if(organizationId){
   const budget=await reserveBudget(organizationId,purpose,STT_MODEL_KEY,{idempotencyKey});
   if(!budget.allowed)throw Object.assign(new Error('AI service temporarily unavailable'),{status:429,retryable:false,budgetExceeded:true});
   reservationId=budget.reservationId;
   reservationCost=budget.estimatedCost;
  }

  const result=await adapter.request('/audio/transcriptions',{headers:{},body:form,timeoutMs:60000});
  if(!result.response.ok){
   if(reservationId)await cancelReservation(reservationId);
   if(organizationId)await logAIUsage({
    organization_id:organizationId,request_id:requestId,model_key:STT_MODEL_KEY,provider:config.provider,model:config.model,
    purpose,prompt_version:'v2-provider-agnostic',attempt:1,latency_ms:Date.now()-started,
    http_status:result.response.status,success:false,retry_reason:result.data?.error?.message||null
   });
   throw Object.assign(new Error('Speech transcription is temporarily unavailable'),{status:result.response.status,retryable:retryable(result.response.status)});
  }

  if(reservationId&&!await confirmReservation(reservationId,reservationCost)){
   await cancelReservation(reservationId);
   throw Object.assign(new Error('AI accounting confirmation failed'),{status:500,retryable:false});
  }
  if(organizationId)await logAIUsage({
   organization_id:organizationId,request_id:requestId,model_key:STT_MODEL_KEY,provider:config.provider,model:config.model,
   purpose,prompt_version:'v2-provider-agnostic',attempt:1,latency_ms:Date.now()-started,
   http_status:result.response.status,success:true
  });
  return{text:clean(result.data?.text,12000),requestId};
 }catch(err){if(reservationId)try{await cancelReservation(reservationId)}catch{}throw err}
}
\n
export async function synthesizeSpeech({
 text,voice=process.env.ARIA_VOICE||'hannah',organizationId=null,purpose='aria_voice_speech',idempotencyKey=null
}={}){
 const input=clean(text,200);
 if(!input)throw Object.assign(new Error('Speech text required'),{status:400});
 const config=getModelConfig(TTS_MODEL_KEY),adapter=getAIProvider(config.provider);
 const requestId=randomUUID(),started=Date.now();
 let reservationId=null,reservationCost=null;
 try{
  if(organizationId){
   const budget=await reserveBudget(organizationId,purpose,TTS_MODEL_KEY,{idempotencyKey});
   if(!budget.allowed)throw Object.assign(new Error('AI service temporarily unavailable'),{status:429,retryable:false,budgetExceeded:true});
   reservationId=budget.reservationId;
   reservationCost=budget.estimatedCost;
  }

  const result=await adapter.request('/audio/speech',{
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({model:config.model,voice,input,response_format:'wav'}),
   timeoutMs:60000,responseType:'arrayBuffer'
  });

  if(!result.response.ok){
   if(reservationId)await cancelReservation(reservationId);
   const detail=Buffer.from(result.arrayBuffer||'').toString('utf8').slice(0,500);
   if(organizationId)await logAIUsage({
    organization_id:organizationId,request_id:requestId,model_key:TTS_MODEL_KEY,provider:config.provider,model:config.model,
    purpose,prompt_version:'v2-provider-agnostic',attempt:1,latency_ms:Date.now()-started,
    http_status:result.response.status,success:false,retry_reason:detail||null
   });
   throw Object.assign(new Error(detail||'Speech generation is temporarily unavailable'),{status:result.response.status,retryable:retryable(result.response.status)});
  }

  const buffer=Buffer.from(result.arrayBuffer||'');
  if(!buffer.length){
   if(reservationId)await cancelReservation(reservationId);
   throw Object.assign(new Error('Speech generation returned no audio'),{status:502,retryable:true});
  }

  if(reservationId&&!await confirmReservation(reservationId,reservationCost)){
   await cancelReservation(reservationId);
   throw Object.assign(new Error('AI accounting confirmation failed'),{status:500,retryable:false});
  }
  if(organizationId)await logAIUsage({
   organization_id:organizationId,request_id:requestId,model_key:TTS_MODEL_KEY,provider:config.provider,model:config.model,
   purpose,prompt_version:'v2-provider-agnostic',attempt:1,latency_ms:Date.now()-started,
   http_status:result.response.status,success:true
  });
  return{buffer,mimeType:result.response.headers.get('content-type')||'audio/wav'};
 }catch(err){if(reservationId)try{await cancelReservation(reservationId)}catch{}throw err}
}

export async function aiHealth(){
 const providers=listAIProviders();
 const text=getModelConfig(DEFAULT_MODEL_KEY),stt=getModelConfig(STT_MODEL_KEY),tts=getModelConfig(TTS_MODEL_KEY);
 return{
  available:providers.some(p=>p.configured),
  configured:Boolean(providers.find(p=>p.name===text.provider)?.configured),
  providers,
  textModel:DEFAULT_MODEL_KEY,
  sttModel:STT_MODEL_KEY,
  ttsModel:TTS_MODEL_KEY,
  textProvider:text.provider,
  sttProvider:stt.provider,
  ttsProvider:tts.provider
 };
}

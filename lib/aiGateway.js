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
 const safeMessages=Array.isArray(messages)?messages.map(m=>({role:m.role==='assistant'?'assistant':'user',content:clean(m.content,16000)})):[];
 if(system)safeMessages.unshift({role:'system',content:clean(system,16000)});
 if(user)safeMessages.push({role:'user',content:clean(user,16000)});
 const payload={model:config.model,messages:safeMessages,temperature:Math.max(0,Math.min(1,Number(temperature)||0)),max_completion_tokens:Math.min(Math.max(Number(maxTokens)||500,1),config.max_completion_tokens)};
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

  const result=await groqRequest('/chat/completions',{headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const latency=Date.now()-started;

  if(!result.response.ok){
   if(reservationId){await cancelReservation(reservationId);settled=true}
   if(organizationId)await logAIUsage({organization_id:organizationId,job_id:jobId,request_id:requestId,model_key:modelKey,provider:config.provider,model:config.model,purpose,prompt_version:'v1',attempt:1,latency_ms:latency,finish_reason:'error',http_status:result.response.status,success:false,retry_reason:result.data?.error?.message||`HTTP ${result.response.status}`});
   throw Object.assign(new Error('AI service temporarily unavailable'),{status:result.response.status,retryable:retryable(result.response.status),retryAfter:result.response.headers.get('retry-after')});
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
   if(!await confirmReservation(reservationId,actualCost))throw Object.assign(new Error('AI accounting confirmation failed'),{status:500,retryable:false});
   settled=true;
  }

  if(organizationId)await logAIUsage({organization_id:organizationId,job_id:jobId,request_id:requestId,model_key:modelKey,provider:config.provider,model:config.model,purpose,prompt_version:'v1',attempt:1,input_tokens:inputTokens,output_tokens:outputTokens,latency_ms:latency,finish_reason:result.data?.choices?.[0]?.finish_reason||'stop',http_status:result.response.status,success:true});

  const text=result.data?.choices?.[0]?.message?.content;
  if(typeof text!=='string'||!text.trim())throw Object.assign(new Error('AI returned an empty response'),{status:502,retryable:true});

  return{text:text.trim(),requestId,usage:{inputTokens,outputTokens}};
 }catch(err){
  if(reservationId&&!settled)try{await cancelReservation(reservationId)}catch{}
  throw err;
 }
}

export async function transcribeAudio({buffer,mimeType='audio/webm',filename='aria.webm',language='en',prompt='',organizationId=null,purpose='aria_voice_transcription'}={}){
 if(!Buffer.isBuffer(buffer)||!buffer.length)throw Object.assign(new Error('Audio data required'),{status:400});
 const maxBytes=Number(process.env.ARIA_MAX_AUDIO_BYTES)||25*1024*1024;
 if(buffer.length>maxBytes)throw Object.assign(new Error('Audio file is too large'),{status:413});

 const model=getModelConfig(STT_MODEL_KEY).model;
 const form=new FormData();
 form.append('file',new Blob([buffer],{type:mimeType}),filename);
 form.append('model',model);
 form.append('response_format','json');
 if(language)form.append('language',language);
 if(prompt)form.append('prompt',clean(prompt,900));

 const requestId=randomUUID();
 const started=Date.now();
 const result=await groqRequest('/audio/transcriptions',{headers:{},body:form,timeoutMs:60000});

 if(!result.response.ok)throw Object.assign(new Error('Speech transcription is temporarily unavailable'),{status:result.response.status,retryable:retryable(result.response.status)});

 if(organizationId)await logAIUsage({organization_id:organizationId,request_id:requestId,model_key:STT_MODEL_KEY,provider:'groq',model,purpose,prompt_version:'v1',attempt:1,latency_ms:Date.now()-started,http_status:result.response.status,success:true});

 return{text:clean(result.data?.text,12000),requestId};
}

export async function synthesizeSpeech({text,voice=process.env.ARIA_VOICE||'hannah',organizationId=null,purpose='aria_voice_speech'}={}){
 const input=clean(text,200);
 if(!input)throw Object.assign(new Error('Speech text required'),{status:400});

 const model=getModelConfig(TTS_MODEL_KEY).model;
 const requestId=randomUUID();
 const started=Date.now();

 const result=await groqRequest('/audio/speech',{
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({model,voice,input,response_format:'wav'}),
  timeoutMs:60000,
  responseType:'arrayBuffer'
 });

 if(!result.response.ok){
  const detail=Buffer.from(result.arrayBuffer||'').toString('utf8').slice(0,500);
  throw Object.assign(new Error(detail||'Speech generation is temporarily unavailable'),{status:result.response.status,retryable:retryable(result.response.status)});
 }

 const buffer=Buffer.from(result.arrayBuffer||'');
 if(!buffer.length)throw Object.assign(new Error('Speech generation returned no audio'),{status:502,retryable:true});

 if(organizationId)await logAIUsage({organization_id:organizationId,request_id:requestId,model_key:TTS_MODEL_KEY,provider:'groq',model,purpose,prompt_version:'v1',attempt:1,latency_ms:Date.now()-started,http_status:result.response.status,success:true});

 return{buffer,mimeType:result.response.headers.get('content-type')||'audio/wav'};
}

export async function aiHealth(){
 return{configured:Boolean(process.env.GROQ_API_KEY),available:true};
             }

// lib/aiProviders/index.js
import{groqRequest}from'./groq';

const PROVIDERS=Object.freeze({
 groq:Object.freeze({
  name:'groq',
  request:groqRequest,
  configured:()=>Boolean(process.env.GROQ_API_KEY)
 })
});

export function getAIProvider(provider){
 const key=String(provider||'').trim().toLowerCase();
 const adapter=PROVIDERS[key];
 if(!adapter)throw Object.assign(new Error('AI provider is not configured for this model.'),{status:503,retryable:false,code:'AI_PROVIDER_UNAVAILABLE',provider:key||null});
 if(!adapter.configured())throw Object.assign(new Error('AI provider is temporarily unavailable.'),{status:503,retryable:false,code:'AI_PROVIDER_UNAVAILABLE',provider:key});
 return adapter;
}

export function listAIProviders(){
 return Object.values(PROVIDERS).map(p=>({name:p.name,configured:p.configured()}));
}

export function isAIProviderConfigured(provider){
 try{return getAIProvider(provider).configured()}catch{return false}
}

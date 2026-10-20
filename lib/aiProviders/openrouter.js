// lib/aiProviders/openrouter.js
const BASE='https://openrouter.ai/api/v1';

function key(){const value=process.env.OPENROUTER_API_KEY;if(!value)throw Object.assign(new Error('OpenRouter is not configured'),{status:503,retryable:false,code:'AI_PROVIDER_UNAVAILABLE',provider:'openrouter'});return value}
function timeout(ms){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),ms);return{controller,timer}}

export async function openRouterRequest(path,options={}){
 const{method='POST',body,headers={},timeoutMs=45000,responseType='json'}=options;
 const{controller,timer}=timeout(timeoutMs);
 try{
  const response=await fetch(`${BASE}${path}`,{
   method,
   headers:{Authorization:`Bearer ${key()}`,'Content-Type':'application/json','HTTP-Referer':'https://nyeocare.vercel.app','X-Title':'NYEOCARE',...headers},
   body,
   signal:controller.signal
  });
  if(responseType==='arrayBuffer')return{response,data:null,headers:response.headers,arrayBuffer:await response.arrayBuffer()};
  let data={};try{data=await response.json()}catch{}
  return{response,data,headers:response.headers};
 }catch(err){
  if(err?.name==='AbortError')throw Object.assign(new Error('OpenRouter vision request timed out'),{status:504,retryable:true,code:'AI_TIMEOUT',provider:'openrouter'});
  throw err;
 }finally{clearTimeout(timer)}
}

// lib/aiProviders/groq.js
const BASE='https://api.groq.com/openai/v1';

function key(){const value=process.env.GROQ_API_KEY;if(!value)throw Object.assign(new Error('AI service is not configured'),{status:503,retryable:false});return value}
function timeout(ms){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),ms);return{controller,timer}}

export async function groqRequest(path,options={}){
 const{method='POST',body,headers={},timeoutMs=45000,responseType='json'}=options;
 const{controller,timer}=timeout(timeoutMs);
 try{
  const response=await fetch(`${BASE}${path}`,{
   method,
   headers:{Authorization:`Bearer ${key()}`,...headers},
   body,
   signal:controller.signal
  });
  if(responseType==='arrayBuffer')return{response,data:null,headers:response.headers,arrayBuffer:await response.arrayBuffer()};
  let data={};
  try{data=await response.json()}catch{}
  return{response,data,headers:response.headers};
 }catch(err){
  if(err.name==='AbortError')throw Object.assign(new Error('AI request timed out'),{status:504,retryable:true});
  throw err;
 }finally{clearTimeout(timer)}
}

export function groqJsonBody(payload){return{'Content-Type':'application/json',body:JSON.stringify(payload)}}

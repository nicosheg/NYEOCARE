// lib/clientSession.js
import{supabase}from'./supabaseClient';

let cachedSession=null;
let cachedExpiresAt=0;
let inFlight=null;
let refreshInFlight=null;
let listenerReady=false;
let storageListenerReady=false;

const SKEW_MS=30000;
const READ_RETRY_MS=180;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function remember(session){
 cachedSession=session||null;
 cachedExpiresAt=session?.expires_at?Number(session.expires_at)*1000:0;
 return cachedSession;
}
function clearRemembered(){
 cachedSession=null;
 cachedExpiresAt=0;
}
function ensureListener(){
 if(typeof window==='undefined'||listenerReady)return;
 listenerReady=true;
 supabase.auth.onAuthStateChange((event,session)=>{
  if(event==='SIGNED_OUT')clearRemembered();
  else if(session)remember(session);
 });
}
function ensureStorageListener(){
 if(typeof window==='undefined'||storageListenerReady)return;
 storageListenerReady=true;
 window.addEventListener('storage',event=>{
  if(typeof event.key==='string'||event.key===null){
   if(event.key===null||event.key.includes('auth-token'))clearRemembered();
  }
 });
}
async function readStoredSession(){
 let lastError=null;
 for(let attempt=0;attempt<2;attempt++){
  const{data,error}=await supabase.auth.getSession();
  if(!error)return remember(data?.session||null);
  lastError=error;
  if(attempt===0)await sleep(READ_RETRY_MS);
 }
 throw lastError||new Error('Unable to read the current session.');
}
export function getClientSession({forceRefresh=false}={}){
 if(typeof window==='undefined')return Promise.resolve(cachedSession);
 ensureListener();ensureStorageListener();
 if(forceRefresh)return refreshClientSession();
 const now=Date.now();
 if(cachedSession&&cachedExpiresAt>now+SKEW_MS)return Promise.resolve(cachedSession);
 if(inFlight)return inFlight;
 inFlight=(async()=>{
  try{
   const session=await readStoredSession();
   if(session)return session;
   await sleep(READ_RETRY_MS);
   const second=await readStoredSession();
   if(second)return second;
   try{
    const{data,error}=await supabase.auth.refreshSession();
    if(!error&&data?.session)return remember(data.session);
   }catch{}
   return null;
  }catch(firstError){
   try{
    const{data,error}=await supabase.auth.refreshSession();
    if(!error&&data?.session)return remember(data.session);
   }catch{}
   throw firstError;
  }
 })().finally(()=>{inFlight=null});
 return inFlight;
}
export function refreshClientSession(){
 if(typeof window==='undefined')return Promise.resolve(cachedSession);
 ensureListener();ensureStorageListener();
 if(refreshInFlight)return refreshInFlight;
 refreshInFlight=supabase.auth.refreshSession().then(({data,error})=>{
  if(error)throw error;
  return remember(data?.session||null);
 }).finally(()=>{refreshInFlight=null});
 return refreshInFlight;
}
export function clearClientSession(){clearRemembered()}
export const authHeaders=session=>session?.access_token?{Authorization:'Bearer '+session.access_token}:{};

// lib/clientSession.js
import{supabase}from'./supabaseClient';

let cachedSession=null;
let cachedExpiresAt=0;
let readInFlight=null;
let refreshInFlight=null;
let listenerReady=false;

const SKEW_MS=30000;
const READ_RETRY_MS=180;

function remember(session){
 cachedSession=session||null;
 cachedExpiresAt=session?.expires_at?Number(session.expires_at)*1000:0;
 return cachedSession;
}

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function ensureListener(){
 if(listenerReady||typeof window==='undefined')return;
 listenerReady=true;
 supabase.auth.onAuthStateChange((event,session)=>{
  if(event==='SIGNED_OUT')remember(null);
  else if(session)remember(session);
 });
 window.addEventListener('storage',event=>{
  if(event.key&&event.key.includes('auth-token')){
   cachedSession=null;
   cachedExpiresAt=0;
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
 ensureListener();
 if(forceRefresh)return refreshClientSession();
 const now=Date.now();
 if(cachedSession&&cachedExpiresAt>now+SKEW_MS)return Promise.resolve(cachedSession);
 if(readInFlight)return readInFlight;
 readInFlight=(async()=>{
  try{
   const session=await readStoredSession();
   if(session)return session;
   await sleep(READ_RETRY_MS);
   return await readStoredSession();
  }finally{
   readInFlight=null;
  }
 })();
 return readInFlight;
}

export function refreshClientSession(){
 if(typeof window==='undefined')return Promise.resolve(cachedSession);
 ensureListener();
 if(refreshInFlight)return refreshInFlight;
 refreshInFlight=(async()=>{
  if(readInFlight)await readInFlight.catch(()=>{});
  const{data,error}=await supabase.auth.refreshSession();
  if(error)throw error;
  return remember(data?.session||null);
 })().finally(()=>{refreshInFlight=null});
 return refreshInFlight;
}

export function clearClientSession(){
 cachedSession=null;
 cachedExpiresAt=0;
}

export const authHeaders=session=>session?.access_token?{Authorization:'Bearer '+session.access_token}:{};

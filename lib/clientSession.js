// lib/clientSession.js
import{supabase}from'./supabaseClient';

let cachedSession=null;
let cachedExpiresAt=0;
let inFlight=null;
let refreshInFlight=null;
let listenerReady=false;
let initPromise=null;

const SKEW_MS=30000;
const READ_RETRIES=3;
const READ_RETRY_MS=220;

function remember(session){
 cachedSession=session||null;
 cachedExpiresAt=session?.expires_at?Number(session.expires_at)*1000:0;
 return cachedSession;
}

function ensureListener(){
 if(listenerReady||typeof window==='undefined')return;
 listenerReady=true;
 supabase.auth.onAuthStateChange((_event,session)=>remember(session));
}

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function readSession(){
 let lastError=null;
 for(let attempt=0;attempt<READ_RETRIES;attempt++){
  try{
   const{data,error}=await supabase.auth.getSession();
   if(!error){
    if(data?.session)return remember(data.session);
    if(attempt<READ_RETRIES-1){await sleep(READ_RETRY_MS);continue}
    return remember(null);
   }
   lastError=error;
  }catch(error){lastError=error}
  if(attempt<READ_RETRIES-1)await sleep(READ_RETRY_MS);
 }
 if(lastError)throw lastError;
 return remember(null);
}

export function getClientSession({forceRefresh=false}={}){
 if(typeof window==='undefined')return Promise.resolve(cachedSession);
 ensureListener();
 if(forceRefresh)return refreshClientSession();
 const now=Date.now();
 if(cachedSession&&cachedExpiresAt>now+SKEW_MS)return Promise.resolve(cachedSession);
 if(initPromise)return initPromise;
 if(inFlight)return inFlight;
 inFlight=(async()=>{
  try{
   const session=await readSession();
   if(session)return session;
   try{
    const refreshed=await refreshClientSession();
    if(refreshed)return refreshed;
   }catch{}
   return null;
  }finally{inFlight=null}
 })();
 initPromise=inFlight.finally(()=>{initPromise=null});
 return initPromise;
}

export function refreshClientSession(){
 if(typeof window==='undefined')return Promise.resolve(cachedSession);
 ensureListener();
 if(refreshInFlight)return refreshInFlight;
 refreshInFlight=supabase.auth.refreshSession().then(({data,error})=>{
  if(error)throw error;
  return remember(data?.session||null);
 }).finally(()=>{refreshInFlight=null});
 return refreshInFlight;
}

export function clearClientSession(){
 cachedSession=null;
 cachedExpiresAt=0;
}

export const authHeaders=session=>session?.access_token?{Authorization:`Bearer ${session.access_token}`}:{};

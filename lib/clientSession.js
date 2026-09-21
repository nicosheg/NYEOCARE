// lib/clientSession.js
import{supabase}from'./supabaseClient';

let cachedSession=null;
let cachedExpiresAt=0;
let inFlight=null;
let refreshInFlight=null;
let listenerReady=false;

const SKEW_MS=30000;

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

export function getClientSession({forceRefresh=false}={}){
 if(typeof window==='undefined')return Promise.resolve(cachedSession);
 ensureListener();
 const now=Date.now();
 if(!forceRefresh&&cachedSession&&cachedExpiresAt>now+SKEW_MS)return Promise.resolve(cachedSession);
 if(inFlight)return inFlight;
 inFlight=(async()=>{
  const{data,error}=await supabase.auth.getSession();
  if(!error)return remember(data?.session||null);
  try{
   const{data:refreshed,error:refreshError}=await supabase.auth.refreshSession();
   if(!refreshError&&refreshed?.session)return remember(refreshed.session);
  }catch{}
  throw error;
 })().finally(()=>{inFlight=null});
 return inFlight;
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

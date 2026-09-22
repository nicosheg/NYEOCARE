// lib/clientSession.js
import { supabase } from './supabaseClient';

let cachedSession=null;
let cachedExpiresAt=0;
let inFlight=null;
let refreshInFlight=null;
let listenerReady=false;
let initialResolved=false;
let initialSession=null;
let initialResolve=null;
let initialPromise=null;

const SKEW_MS=30000;
const INITIAL_WAIT_MS=3500;
const READ_RETRY_MS=250;

function remember(session){
  cachedSession=session||null;
  cachedExpiresAt=session?.expires_at?Number(session.expires_at)*1000:0;
  return cachedSession;
}

function ensureListener(){
  if(listenerReady||typeof window==='undefined')return;
  listenerReady=true;
  initialPromise=new Promise(resolve=>{initialResolve=resolve});
  supabase.auth.onAuthStateChange((event,session)=>{
    if(event==='INITIAL_SESSION'||event==='SIGNED_IN'||event==='TOKEN_REFRESHED'||event==='USER_UPDATED')remember(session);
    else if(event==='SIGNED_OUT')remember(null);
    if(!initialResolved&&event==='INITIAL_SESSION'){
      initialResolved=true;
      initialSession=session||null;
      initialResolve?.(initialSession);
      initialResolve=null;
    }
  });
}

function waitForInitialSession(){
  ensureListener();
  if(initialResolved)return Promise.resolve(initialSession);
  const timer=new Promise(resolve=>setTimeout(()=>resolve(undefined),INITIAL_WAIT_MS));
  return Promise.race([initialPromise,timer]);
}

async function readSession(){
  let lastError=null;
  for(let attempt=0;attempt<2;attempt++){
    try{
      const{data,error}=await supabase.auth.getSession();
      if(!error)return remember(data?.session||null);
      lastError=error;
    }catch(error){lastError=error}
    if(attempt===0)await new Promise(resolve=>setTimeout(resolve,READ_RETRY_MS));
  }
  throw lastError||new Error('Unable to read the current session.');
}

export function getClientSession({forceRefresh=false}={}){
  if(typeof window==='undefined')return Promise.resolve(cachedSession);
  ensureListener();
  const now=Date.now();
  if(!forceRefresh&&cachedSession&&cachedExpiresAt>now+SKEW_MS)return Promise.resolve(cachedSession);
  if(inFlight)return inFlight;
  inFlight=(async()=>{
    const boot=await waitForInitialSession();
    if(boot)return remember(boot);
    if(initialResolved)return remember(initialSession);
    return readSession();
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
  initialSession=null;
}

export const authHeaders=session=>session?.access_token?{Authorization:`Bearer ${session.access_token}`}:{};

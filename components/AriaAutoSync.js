// components/AriaAutoSync.js
import{useEffect,useRef}from'react';import{getClientSession,refreshClientSession}from'../lib/clientSession';
const COOLDOWN=15000,IDLE_DELAY=2500;
export default function AriaAutoSync(){
 const lastRun=useRef(0);
 useEffect(()=>{
  let cancelled=false,timer=null,idleId=null;
  const run=async()=>{
   if(cancelled||document.visibilityState!=='visible')return;
   const now=Date.now();if(now-lastRun.current<COOLDOWN)return;
   lastRun.current=now;
   try{
    let session=await getClientSession();if(!session)return;
    let r=await fetch('/api/aria/process-events',{method:'POST',headers:{Authorization:'Bearer '+session.access_token}});
    if(r.status===401){
     session=await refreshClientSession().catch(()=>null);
     if(session)r=await fetch('/api/aria/process-events',{method:'POST',headers:{Authorization:'Bearer '+session.access_token}});
    }
    if(!r.ok)console.warn('[ARIA] event worker unavailable',r.status);
    else if(!cancelled)window.dispatchEvent(new CustomEvent('aria:events-processed',{detail:{at:new Date().toISOString()}}));
   }catch(e){console.warn('[ARIA] event worker unavailable',e?.message||e)}
  };
  const schedule=()=>{
   if(timer)clearTimeout(timer);
   if(idleId&&window.cancelIdleCallback)window.cancelIdleCallback(idleId);
   if(typeof window.requestIdleCallback==='function')idleId=window.requestIdleCallback(run,{timeout:IDLE_DELAY});
   else timer=setTimeout(run,IDLE_DELAY);
  };
  const onFocus=run;
  const onVisible=()=>{if(document.visibilityState==='visible')schedule()};
  schedule();window.addEventListener('focus',onFocus);document.addEventListener('visibilitychange',onVisible);
  const interval=setInterval(schedule,COOLDOWN);
  return()=>{cancelled=true;if(timer)clearTimeout(timer);if(idleId&&window.cancelIdleCallback)window.cancelIdleCallback(idleId);clearInterval(interval);window.removeEventListener('focus',onFocus);document.removeEventListener('visibilitychange',onVisible)};
 },[]);
 return null;
}

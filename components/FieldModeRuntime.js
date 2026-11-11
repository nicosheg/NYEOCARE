// components/FieldModeRuntime.js
import{useEffect}from'react';
import{syncFieldMode}from'../lib/attendanceFieldMode';import{getClientSession}from'../lib/clientSession';
function registerServiceWorker(){
 if(typeof window==='undefined'||!('serviceWorker'in navigator)||!window.isSecureContext)return;
 navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(error=>console.warn('[FIELD MODE] Service worker unavailable:',error?.message||error));
}
export default function FieldModeRuntime(){
 useEffect(()=>{
  let timer=null,alive=true,runPromise=null;
  const refreshApp=async reason=>{
   if(!alive||document.visibilityState!=='visible')return;
   try{
    const session=await getClientSession();
    if(!session||!alive||document.visibilityState!=='visible')return;
    window.dispatchEvent(new CustomEvent('nyeocare:app-refresh',{detail:{reason,at:Date.now()}}));
   }catch{}
  };
  const run=(reason='field-runtime')=>{
   if(!alive||document.visibilityState!=='visible')return Promise.resolve();
   if(runPromise)return runPromise;
   runPromise=(async()=>{
    try{await syncFieldMode()}catch(error){console.warn('[FIELD MODE] Background sync deferred:',error?.message||error)}
    if(alive)await refreshApp(reason);
   })().finally(()=>{runPromise=null});
   return runPromise;
  };
  const schedule=()=>{if(timer)window.clearTimeout(timer);timer=window.setTimeout(()=>{void run('resume')},1000)};
  const onOnline=()=>{void run('online')};
  const onVisible=()=>{if(document.visibilityState==='visible')schedule()};
  const onFocus=()=>{void run('focus')};
  const onPageShow=()=>{void run('pageshow')};
  schedule();
  window.addEventListener('online',onOnline);
  document.addEventListener('visibilitychange',onVisible);
  window.addEventListener('focus',onFocus);
  window.addEventListener('pageshow',onPageShow);
  const interval=window.setInterval(run,60000);
  return()=>{
   alive=false;
   if(timer)window.clearTimeout(timer);
   window.clearInterval(interval);
   window.removeEventListener('online',onOnline);
   document.removeEventListener('visibilitychange',onVisible);
   window.removeEventListener('focus',onFocus);
   window.removeEventListener('pageshow',onPageShow);
  };
 },[]);
 return null;
}

// components/FieldModeRuntime.js
import{useEffect}from'react';
import{syncFieldMode}from'../lib/attendanceFieldMode';import{getClientSession}from'../lib/clientSession';
function registerServiceWorker(){
 if(typeof window==='undefined'||!('serviceWorker'in navigator)||!window.isSecureContext)return;
 navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(error=>console.warn('[FIELD MODE] Service worker unavailable:',error?.message||error));
}
export default function FieldModeRuntime(){
 useEffect(()=>{
  let timer=null,alive=true;
  const refreshApp=async reason=>{if(!alive||document.visibilityState!=='visible')return;try{const session=await getClientSession();if(!session||!alive)return;window.dispatchEvent(new CustomEvent('nyeocare:app-refresh',{detail:{reason,at:Date.now()}}))}catch{}};
  const run=()=>{if(document.visibilityState!=='visible')return;syncFieldMode().catch(()=>{});refreshApp('field-runtime')};
  const schedule=()=>{if(timer)window.clearTimeout(timer);timer=window.setTimeout(run,1000)};
  const onOnline=()=>run(),onVisible=()=>{if(document.visibilityState==='visible')schedule()},onFocus=()=>refreshApp('focus'),onPageShow=()=>refreshApp('pageshow');
  schedule();window.addEventListener('online',onOnline);document.addEventListener('visibilitychange',onVisible);window.addEventListener('focus',onFocus);window.addEventListener('pageshow',onPageShow);
  const interval=window.setInterval(run,60000);
  return()=>{alive=false;if(timer)window.clearTimeout(timer);window.clearInterval(interval);window.removeEventListener('online',onOnline);document.removeEventListener('visibilitychange',onVisible);window.removeEventListener('focus',onFocus);window.removeEventListener('pageshow',onPageShow);}
 },[]);
 return null;
}
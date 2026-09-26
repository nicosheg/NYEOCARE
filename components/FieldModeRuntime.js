// components/FieldModeRuntime.js
import{useEffect}from'react';
import{syncFieldMode}from'../lib/attendanceFieldMode';
function registerServiceWorker(){
 if(typeof window==='undefined'||!('serviceWorker'in navigator)||!window.isSecureContext)return;
 navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(error=>console.warn('[FIELD MODE] Service worker unavailable:',error?.message||error));
}
export default function FieldModeRuntime(){
 useEffect(()=>{
  registerServiceWorker();let timer=null;
  const run=()=>{if(document.visibilityState==='visible')syncFieldMode().catch(()=>{})};
  const schedule=()=>{if(timer)window.clearTimeout(timer);timer=window.setTimeout(run,1000)};
  const onOnline=()=>run(),onVisible=()=>{if(document.visibilityState==='visible')schedule()};
  schedule();window.addEventListener('online',onOnline);document.addEventListener('visibilitychange',onVisible);
  const interval=window.setInterval(run,60000);
  return()=>{if(timer)window.clearTimeout(timer);window.clearInterval(interval);window.removeEventListener('online',onOnline);document.removeEventListener('visibilitychange',onVisible);}
 },[]);
 return null;
}
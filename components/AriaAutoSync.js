// components/AriaAutoSync.js
import{useEffect,useRef}from'react';

const COOLDOWN=60000;

export default function AriaAutoSync(){
const lastRun=useRef(0);
useEffect(()=>{
let cancelled=false;
const run=async(force=false)=>{
if(cancelled)return;
const now=Date.now();
if(!force&&now-lastRun.current<COOLDOWN)return;
lastRun.current=now;
try{
const r=await fetch('/api/aria/cycle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({force}),credentials:'include'});
if(!r.ok){console.warn('[ARIA] auto-sync failed',r.status);return}
if(!cancelled)window.dispatchEvent(new CustomEvent('aria:cycle-complete',{detail:{at:new Date().toISOString()}}));
}catch(e){console.warn('[ARIA] auto-sync unavailable',e.message)}
};
const start=()=>run();
const delayed=setTimeout(start,1000);
const onFocus=()=>run();
const onVisible=()=>{if(document.visibilityState==='visible')run()};
window.addEventListener('focus',onFocus);
document.addEventListener('visibilitychange',onVisible);
const timer=setInterval(()=>run(),5*60000);
return()=>{cancelled=true;clearTimeout(delayed);clearInterval(timer);window.removeEventListener('focus',onFocus);document.removeEventListener('visibilitychange',onVisible)};
},[]);
return null;
}

// components/AuthSessionKeeper.js
import{useEffect}from'react';
import{getClientSession}from'../lib/clientSession';

export default function AuthSessionKeeper(){
 useEffect(()=>{
  let active=true;
  const warm=async()=>{
   if(!active||typeof document==='undefined'||document.visibilityState==='hidden')return;
   try{
    const session=await getClientSession();
    if(session&&active)window.dispatchEvent(new CustomEvent('nyeocare:session-ready'));
   }catch(error){
    if(active)console.warn('[AUTH] Session warm failed:',error?.message||error);
   }
  };
  warm();
  const onVisible=()=>{if(document.visibilityState==='visible')warm()};
  const onFocus=()=>warm();
  const onPageShow=()=>warm();
  const onOnline=()=>warm();
  document.addEventListener('visibilitychange',onVisible);
  window.addEventListener('focus',onFocus);
  window.addEventListener('pageshow',onPageShow);
  window.addEventListener('online',onOnline);
  return()=>{
   active=false;
   document.removeEventListener('visibilitychange',onVisible);
   window.removeEventListener('focus',onFocus);
   window.removeEventListener('pageshow',onPageShow);
   window.removeEventListener('online',onOnline);
  };
 },[]);
 return null;
}

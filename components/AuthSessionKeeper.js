// components/AuthSessionKeeper.js
import{useEffect}from'react';
import{supabase}from'../lib/supabaseClient';
import{getClientSession,refreshClientSession}from'../lib/clientSession';

export default function AuthSessionKeeper(){
 useEffect(()=>{
  let active=true;
  const warm=async({force=false}={})=>{
   if(!active||typeof document==='undefined'||document.visibilityState==='hidden')return;
   try{
    const session=force?await refreshClientSession():await getClientSession();
    if(session&&active)window.dispatchEvent(new CustomEvent('nyeocare:session-ready'));
   }catch(error){
    if(active)console.warn('[AUTH] Session warm failed:',error?.message||error);
   }
  };
  warm();
  const onVisible=()=>{if(document.visibilityState==='visible')warm()};
  const onPageShow=()=>warm();
  const onOnline=()=>warm({force:true});
  const{data:{subscription}}=supabase.auth.onAuthStateChange((event,session)=>{
   if(!active)return;
   if(session)window.dispatchEvent(new CustomEvent('nyeocare:session-ready'));
   if(event==='TOKEN_REFRESHED')window.dispatchEvent(new CustomEvent('nyeocare:session-refreshed'));
  });
  document.addEventListener('visibilitychange',onVisible);
  window.addEventListener('pageshow',onPageShow);
  window.addEventListener('online',onOnline);
  return()=>{
   active=false;
   subscription.unsubscribe();
   document.removeEventListener('visibilitychange',onVisible);
   window.removeEventListener('pageshow',onPageShow);
   window.removeEventListener('online',onOnline);
  };
 },[]);
 return null;
}

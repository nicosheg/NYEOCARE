// components/AuthSessionKeeper.js
import{useEffect}from'react';
import{getClientSession}from'../lib/clientSession';

export default function AuthSessionKeeper(){
 useEffect(()=>{
  let active=true,lastWarm=0;
  const warm=async()=>{
   if(!active||document.visibilityState==='hidden')return;
   if(Date.now()-lastWarm<10000)return;
   lastWarm=Date.now();
   try{await getClientSession()}catch{}
  };
  warm();
  const onFocus=()=>warm();
  const onPageShow=()=>warm();
  const onOnline=()=>warm();
  const onVisible=()=>{if(document.visibilityState==='visible')warm()};
  window.addEventListener('focus',onFocus);
  window.addEventListener('pageshow',onPageShow);
  window.addEventListener('online',onOnline);
  document.addEventListener('visibilitychange',onVisible);
  return()=>{
   active=false;
   window.removeEventListener('focus',onFocus);
   window.removeEventListener('pageshow',onPageShow);
   window.removeEventListener('online',onOnline);
   document.removeEventListener('visibilitychange',onVisible);
  };
 },[]);
 return null;
}

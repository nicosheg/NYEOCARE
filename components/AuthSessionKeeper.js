// components/AuthSessionKeeper.js
import{useEffect}from'react';
import{getClientSession}from'../lib/clientSession';

export default function AuthSessionKeeper(){
 useEffect(()=>{
  let active=true;
  const warm=()=>{if(!active||document.visibilityState==='hidden')return;getClientSession().catch(()=>{})};
  warm();
  const onVisible=()=>warm();
  const onPageShow=()=>warm();
  const onOnline=()=>warm();
  document.addEventListener('visibilitychange',onVisible);
  window.addEventListener('pageshow',onPageShow);
  window.addEventListener('online',onOnline);
  return()=>{active=false;document.removeEventListener('visibilitychange',onVisible);window.removeEventListener('pageshow',onPageShow);window.removeEventListener('online',onOnline)};
 },[]);
 return null;
}

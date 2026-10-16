import{useCallback,useEffect,useRef}from'react';
import{useRouter}from'next/router';

const HISTORY_KEY='nyeocare:navigation-history:v1';
const SCROLL_KEY='nyeocare:route-scroll:v1';
const RESTORE_KEY='nyeocare:pending-scroll-restore:v1';
const AUTH_ROUTES=new Set(['/login','/signup','/join','/reset-password','/profile/password-reset']);

const validPath=value=>typeof value==='string'&&value.startsWith('/')&&!value.startsWith('//')&&!value.includes('\\')&&!value.includes('\0');
const isAuthPath=value=>{const p=String(value||'').split('?')[0];return AUTH_ROUTES.has(p)||p.startsWith('/join/')};
const samePath=(a,b)=>String(a||'').split('#')[0]===String(b||'').split('#')[0];
function restorePageScroll(value){
 if(typeof window==='undefined')return;
 const target=Math.max(0,Number(value)||0);let attempts=0;
 const apply=()=>{
  const max=Math.max(0,document.documentElement.scrollHeight-window.innerHeight);
  if(max>=target||attempts>=15){window.scrollTo({top:Math.min(target,max),left:0,behavior:'auto'});return}
  attempts++;window.setTimeout(apply,80);
 };
 requestAnimationFrame(()=>requestAnimationFrame(apply));
}
function parseStored(key,fallback){try{const value=JSON.parse(sessionStorage.getItem(key)||'null');return value&&typeof value==='object'?value:fallback}catch{return fallback}}

export default function NavigationBack(){
 const router=useRouter();
 const historyRef=useRef([]);
 const scrollRef=useRef({});
 const currentRef=useRef(router.asPath||router.pathname);
 const skipPushRef=useRef(false);
 const popStateRef=useRef(false);
 const restoreRef=useRef(null);

 const persistHistory=useCallback(()=>{try{sessionStorage.setItem(HISTORY_KEY,JSON.stringify(historyRef.current.slice(-40)))}catch{}},[]);
 const persistScroll=useCallback(()=>{try{sessionStorage.setItem(SCROLL_KEY,JSON.stringify(scrollRef.current))}catch{}},[]);
 const fallbackFor=useCallback(path=>{
  const p=String(path||'/').split('?')[0];
  if(p.startsWith('/person/'))return'/people';
  if(p.startsWith('/review'))return'/people';
  if(p.startsWith('/people')||p.startsWith('/profile'))return'/';
  if(p.startsWith('/join/'))return'/login';
  return'/';
 },[]);

 useEffect(()=>{
  if(!router.isReady||typeof window==='undefined')return;
  historyRef.current=parseStored(HISTORY_KEY,[]).filter(x=>x&&validPath(x.url)&&!isAuthPath(x.url)).slice(-40);
  scrollRef.current=parseStored(SCROLL_KEY,{});
  currentRef.current=router.asPath||router.pathname;
  const onStart=url=>{
   const current=currentRef.current||router.asPath||router.pathname;
   scrollRef.current={...scrollRef.current,[current]:Math.max(0,Number(window.scrollY)||0)};
   persistScroll();
   if(popStateRef.current)return;
   if(skipPushRef.current){skipPushRef.current=false;return;}
   const stack=historyRef.current;
   const entry={url:current,scrollY:Math.max(0,Number(window.scrollY)||0)};
   if(stack.length&&samePath(stack[stack.length-1].url,current))stack[stack.length-1]=entry;
   else if(validPath(current)&&!isAuthPath(current))stack.push(entry);
   historyRef.current=stack.slice(-40);persistHistory();
  };
  const onComplete=url=>{
   const next=validPath(url)?url:(router.asPath||router.pathname);
   popStateRef.current=false;
   currentRef.current=next;
   const destination=restoreRef.current;
   if(destination&&samePath(destination.url,next)){
    restoreRef.current=null;
    try{sessionStorage.removeItem(RESTORE_KEY)}catch{}
    const y=Math.max(0,Number(destination.scrollY??scrollRef.current[next])||0);
    restorePageScroll(y);
   }
  };
  const onError=()=>{skipPushRef.current=false;popStateRef.current=false;restoreRef.current=null};
  const onPopState=()=>{
   popStateRef.current=true;
   const target=window.location.pathname+window.location.search+window.location.hash;
   const stack=historyRef.current;
   if(stack.length&&samePath(stack[stack.length-1].url,target))stack.pop();
   historyRef.current=stack;persistHistory();
  };
  router.events.on('routeChangeStart',onStart);
  router.events.on('routeChangeComplete',onComplete);
  router.events.on('routeChangeError',onError);
  window.addEventListener('popstate',onPopState,true);
  try{
   const pending=parseStored(RESTORE_KEY,null);
   if(pending&&validPath(pending.url)&&samePath(pending.url,currentRef.current)){
    sessionStorage.removeItem(RESTORE_KEY);
    const y=Math.max(0,Number(pending.scrollY??scrollRef.current[pending.url])||0);
    requestAnimationFrame(()=>requestAnimationFrame(()=>window.scrollTo({top:y,left:0,behavior:'auto'})));
   }
  }catch{}
  return()=>{
   router.events.off('routeChangeStart',onStart);
   router.events.off('routeChangeComplete',onComplete);
   router.events.off('routeChangeError',onError);
   window.removeEventListener('popstate',onPopState,true);
  };
 },[router.isReady,router.events,persistHistory,persistScroll]);

 const goBack=useCallback(()=>{
  const current=currentRef.current||router.asPath||router.pathname;
  const stack=[...historyRef.current];
  let destination=null;
  while(stack.length&&!destination){
   const candidate=stack.pop();
   if(candidate&&validPath(candidate.url)&&!isAuthPath(candidate.url)&&!samePath(candidate.url,current))destination=candidate;
  }
  if(!destination){
   const url=fallbackFor(current);
   destination={url,scrollY:Math.max(0,Number(scrollRef.current[url])||0)};
  }
  historyRef.current=stack;persistHistory();
  restoreRef.current=destination;
  try{sessionStorage.setItem(RESTORE_KEY,JSON.stringify(destination))}catch{}
  skipPushRef.current=true;
  router.push(destination.url,undefined,{scroll:false}).catch(()=>{skipPushRef.current=false;restoreRef.current=null;try{sessionStorage.removeItem(RESTORE_KEY)}catch{}});
 },[fallbackFor,persistHistory,router]);

 const path=router.pathname||'';
 const hidden=path==='/'||AUTH_ROUTES.has(path)||path.startsWith('/join/');
 if(hidden)return null;
 return <button type="button" onClick={goBack} aria-label="Go back to the previous screen" title="Back to the previous screen" style={{position:'fixed',top:'calc(18px + env(safe-area-inset-top, 0px))',left:'max(8px, env(safe-area-inset-left, 0px))',zIndex:1001,width:34,minWidth:34,height:36,padding:0,display:'inline-flex',alignItems:'center',justifyContent:'center',border:'1px solid rgba(255,255,255,.13)',borderRadius:999,background:'rgba(7,13,29,.86)',backdropFilter:'blur(16px)',WebkitBackdropFilter:'blur(16px)',color:'#F5F7FA',fontSize:13,fontWeight:600,cursor:'pointer',boxShadow:'0 8px 24px rgba(0,0,0,.2)'}}><span aria-hidden="true" style={{fontSize:24,lineHeight:1,marginTop:-2}}>‹</span></button>;
}

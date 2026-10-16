import{useCallback,useEffect,useRef}from'react';
import{useRouter}from'next/router';

const HISTORY_KEY='nyeocare:navigation-history:v1';
const SCROLL_KEY='nyeocare:route-scroll:v1';
const AUTH_ROUTES=new Set(['/login','/signup','/join','/reset-password','/profile/password-reset']);

const validPath=value=>typeof value==='string'&&value.startsWith('/')&&!value.startsWith('//')&&!value.includes('\\')&&!value.includes('\0');
const samePath=(a,b)=>String(a||'').split('#')[0]===String(b||'').split('#')[0];
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
  historyRef.current=parseStored(HISTORY_KEY,[]).filter(x=>x&&validPath(x.url)).slice(-40);
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
   else if(validPath(current))stack.push(entry);
   historyRef.current=stack.slice(-40);persistHistory();
  };
  const onComplete=url=>{
   const next=validPath(url)?url:(router.asPath||router.pathname);
   if(popStateRef.current){
    popStateRef.current=false;
    const stack=historyRef.current;
    if(stack.length&&samePath(stack[stack.length-1].url,next))stack.pop();
    historyRef.current=stack;persistHistory();
   }
   currentRef.current=next;
   const destination=restoreRef.current;
   if(destination&&samePath(destination.url,next)){
    restoreRef.current=null;
    const y=Math.max(0,Number(destination.scrollY??scrollRef.current[next])||0);
    requestAnimationFrame(()=>requestAnimationFrame(()=>window.scrollTo({top:y,left:0,behavior:'auto'})));
   }
  };
  const onError=()=>{skipPushRef.current=false;popStateRef.current=false;restoreRef.current=null};
  const onPopState=()=>{popStateRef.current=true};
  router.events.on('routeChangeStart',onStart);
  router.events.on('routeChangeComplete',onComplete);
  router.events.on('routeChangeError',onError);
  window.addEventListener('popstate',onPopState,true);
  return()=>{
   router.events.off('routeChangeStart',onStart);
   router.events.off('routeChangeComplete',onComplete);
   router.events.off('routeChangeError',onError);
   window.removeEventListener('popstate',onPopState,true);
  };
 },[router.isReady,router.asPath,router.pathname,router.events,persistHistory,persistScroll]);

 const goBack=useCallback(()=>{
  const current=currentRef.current||router.asPath||router.pathname;
  const stack=[...historyRef.current];
  let destination=null;
  while(stack.length&&!destination){
   const candidate=stack.pop();
   if(candidate&&validPath(candidate.url)&&!samePath(candidate.url,current))destination=candidate;
  }
  if(!destination){
   const url=fallbackFor(current);
   destination={url,scrollY:Math.max(0,Number(scrollRef.current[url])||0)};
  }
  historyRef.current=stack;persistHistory();
  restoreRef.current=destination;
  skipPushRef.current=true;
  router.push(destination.url,undefined,{scroll:false}).catch(()=>{skipPushRef.current=false;restoreRef.current=null});
 },[fallbackFor,persistHistory,router]);

 const path=router.pathname||'';
 const hidden=path==='/'||path==='/person/[id]'||AUTH_ROUTES.has(path)||path.startsWith('/join/');
 if(hidden)return null;
 return <button type="button" onClick={goBack} aria-label="Go back to the previous screen" title="Back to the previous screen" style={{position:'fixed',top:'calc(18px + env(safe-area-inset-top, 0px))',left:'max(14px, env(safe-area-inset-left, 0px))',zIndex:1001,minWidth:68,height:36,padding:'0 12px',display:'inline-flex',alignItems:'center',justifyContent:'center',gap:5,border:'1px solid rgba(255,255,255,.13)',borderRadius:999,background:'rgba(7,13,29,.86)',backdropFilter:'blur(16px)',WebkitBackdropFilter:'blur(16px)',color:'#F5F7FA',fontSize:13,fontWeight:600,cursor:'pointer',boxShadow:'0 8px 24px rgba(0,0,0,.2)'}}><span aria-hidden="true" style={{fontSize:19,lineHeight:1}}>‹</span><span>Back</span></button>;
}

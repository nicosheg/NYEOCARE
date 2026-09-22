// components/OnboardingProvider.js
import{createContext,useContext,useEffect,useState,useCallback,useRef}from'react';
import{getClientSession}from'../lib/clientSession';import{supabase}from'../lib/supabaseClient';

const OnboardingContext=createContext(null);
const INITIAL_STATE={loaded:false,enabled:false,experienced:{},ariaInstructions:''};
const CACHE_TTL=300000;
const cache=new Map();
const inflight=new Map();

export function OnboardingProvider({children}){
 const[state,setState]=useState(INITIAL_STATE),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
 const reset=useCallback(()=>{if(mounted.current)setState({...INITIAL_STATE,loaded:true})},[]);
 const load=useCallback(async(sessionOverride=null)=>{
  try{
   const session=sessionOverride||await getClientSession();
   if(!session){reset();return}
   const key=String(session.user?.id||'');
   const cached=cache.get(key);
   if(cached&&Date.now()-cached.at<CACHE_TTL){if(mounted.current)setState(cached.state);return}
   if(inflight.has(key)){await inflight.get(key);return}
   const task=(async()=>{
    const response=await fetch('/api/onboarding',{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});
    if(!response.ok)throw new Error('Onboarding request failed: '+response.status);
    const data=await response.json();
    const next={loaded:true,enabled:data.onboarding?.enabled===true,experienced:data.onboarding?.experienced||{},ariaInstructions:data.ariaInstructions||''};
    cache.set(key,{state:next,at:Date.now()});if(mounted.current)setState(next);
   })();
   inflight.set(key,task);
   try{await task}finally{inflight.delete(key)}
  }catch(error){console.error('[ONBOARDING] Load error:',error);if(mounted.current)setState(prev=>({...prev,loaded:true}))}
 },[reset]);
 useEffect(()=>{
  let active=true;
  load();
  const{data:{subscription}}=supabase.auth.onAuthStateChange((event,session)=>{
   if(!active)return;
   if(event==='SIGNED_OUT'){reset();return}
   if(event==='SIGNED_IN'||event==='USER_UPDATED')load(session);
  });
  return()=>{active=false;subscription.unsubscribe()};
 },[load,reset]);
 const completeExperience=useCallback(async experience=>{if(!experience)return false;setState(prev=>{const experienced={...prev.experienced,[experience]:true};const next={...prev,experienced};if(mounted.current){try{const sessionPromise=getClientSession();sessionPromise.then(session=>{if(!session)return;fetch('/api/onboarding',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify({action:'experience_completed',experience})}).then(r=>r.ok?r.json():null).then(data=>{if(data?.onboarding?.experienced){cache.set(String(session.user.id),{state:{...next,experienced:data.onboarding.experienced},at:Date.now()})}}).catch(()=>{})}).catch(()=>{})}catch{}}return next});return true},[]);
 const isExperienced=useCallback(experience=>state.experienced?.[experience]===true,[state.experienced]);
 return <OnboardingContext.Provider value={{...state,isExperienced,completeExperience,reload:load}}>{children}</OnboardingContext.Provider>;
}
export function useOnboarding(){return useContext(OnboardingContext);}

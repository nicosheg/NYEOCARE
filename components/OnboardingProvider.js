// components/OnboardingProvider.js
import{createContext,useContext,useEffect,useState,useCallback,useRef}from'react';
import{supabase}from'../lib/supabaseClient';

const OnboardingContext=createContext(null);
const INITIAL_STATE={loaded:false,enabled:false,experienced:{},ariaInstructions:''};

export function OnboardingProvider({children}){
const[state,setState]=useState(INITIAL_STATE);
const mounted=useRef(true);

useEffect(()=>{
mounted.current=true;
return()=>{mounted.current=false};
},[]);

const reset=useCallback(()=>{
if(mounted.current)setState({...INITIAL_STATE,loaded:true});
},[]);

const load=useCallback(async(sessionOverride=null)=>{
try{
const{data:{session}}=sessionOverride?{data:{session:sessionOverride}}:await supabase.auth.getSession();
if(!session){reset();return}
const response=await fetch('/api/onboarding',{headers:{Authorization:`Bearer ${session.access_token}`}});
if(!response.ok)throw new Error(`Onboarding request failed: ${response.status}`);
const data=await response.json();
if(!mounted.current)return;
setState({
loaded:true,
enabled:data.onboarding?.enabled===true,
experienced:data.onboarding?.experienced||{},
ariaInstructions:data.ariaInstructions||''
});
}catch(error){
console.error('[ONBOARDING] Load error:',error);
if(mounted.current)setState(prev=>({...prev,loaded:true}));
}
},[reset]);

useEffect(()=>{
let active=true;
const initialize=async()=>{
if(active)await load();
};
initialize();
const{data:{subscription}}=supabase.auth.onAuthStateChange((event,session)=>{
if(!active)return;
if(event==='SIGNED_OUT'||!session){reset();return}
if(event==='SIGNED_IN'||event==='INITIAL_SESSION'||event==='USER_UPDATED'){
setTimeout(()=>{if(active)load(session)},0);
}
});
return()=>{
active=false;
subscription.unsubscribe();
};
},[load,reset]);

const completeExperience=useCallback(async experience=>{
if(!experience)return false;
setState(prev=>({...prev,experienced:{...prev.experienced,[experience]:true}}));
return true;
},[]);

const isExperienced=useCallback(experience=>state.experienced?.[experience]===true,[state.experienced]);

return <OnboardingContext.Provider value={{...state,isExperienced,completeExperience,reload:load}}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(){
return useContext(OnboardingContext);
                                     }

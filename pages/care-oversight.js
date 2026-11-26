// pages/care-oversight.js
import{useEffect}from'react';
import{useRouter}from'next/router';
import Layout from'../components/Layout';

export default function CareOversight(){
 const router=useRouter();
 useEffect(()=>{
  if(!router.isReady)return;
  router.replace('/?briefing=team').catch(()=>{});
 },[router.isReady,router]);
 return <Layout><main style={{minHeight:'45vh',display:'grid',placeItems:'center',color:'var(--ny-text-muted)',fontSize:12}}>Opening ARIA Today…</main></Layout>;
}

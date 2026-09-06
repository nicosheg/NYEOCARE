// pages/join.js
import{useEffect}from'react';
import{useRouter}from'next/router';

export default function JoinRedirect(){
const router=useRouter();
useEffect(()=>{
if(!router.isReady)return;
const token=typeof router.query.token==='string'?router.query.token:'';
router.replace(token?`/join/${encodeURIComponent(token)}`:'/login');
},[router.isReady,router.query.token]);
return <div style={{minHeight:'100vh',display:'grid',placeItems:'center',background:'#050a14',color:'rgba(255,255,255,.5)',fontFamily:'system-ui'}}>Opening invitation…</div>
  }

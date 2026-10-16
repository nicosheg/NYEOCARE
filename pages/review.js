// pages/review.js
import{useRouter}from'next/router';
import Layout from'../components/Layout';
import ReviewCenterTab from'../components/ReviewCenterTab';
export default function ReviewPage(){const router=useRouter();const goBack=()=>{if(typeof window!=='undefined'&&window.history.length>1){router.back();return}router.push('/people')};return <Layout><main style={{minHeight:'100vh',background:'#07101f'}}><button aria-label="Go back to the previous screen" onClick={goBack} style={{position:'fixed',zIndex:1001,left:16,top:16,minWidth:64,height:36,padding:'0 12px',border:'1px solid rgba(255,255,255,.12)',borderRadius:999,background:'rgba(7,13,29,.86)',backdropFilter:'blur(16px)',color:'#F5F7FA',fontSize:13,cursor:'pointer'}}>‹ Back</button><ReviewCenterTab/></main></Layout>}

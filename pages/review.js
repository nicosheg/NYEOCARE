// pages/review.js
import{useRouter}from'next/router';
import Layout from'../components/Layout';
import ReviewCenterTab from'../components/ReviewCenterTab';
export default function ReviewPage(){const router=useRouter();return <Layout><main style={{minHeight:'100vh',background:'#07101f'}}><button onClick={()=>router.back()} style={{position:'fixed',zIndex:20,left:16,top:16,width:38,height:38,border:0,borderRadius:'50%',background:'rgba(255,255,255,.07)',color:'#fff',fontSize:26,cursor:'pointer'}}>‹</button><ReviewCenterTab/></main></Layout>}

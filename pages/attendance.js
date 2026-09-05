// pages/attendance.js
import{useEffect}from'react';
import{useRouter}from'next/router';
export default function AttendancePage(){
const router=useRouter();
useEffect(()=>{if(router.isReady)router.replace('/session')},[router.isReady,router]);
return null;
}

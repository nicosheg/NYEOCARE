// pages/forgot-password.js
import{useEffect,useState}from'react';
import{useRouter}from'next/router';
import{supabase}from'../lib/supabaseClient';
import{getAuthRedirectUrl}from'../lib/authRedirectUrl';
import{markPendingRecoveryRequest,clearPendingRecoveryRequest}from'../lib/authRecoveryState';

const COOLDOWN_KEY='nyeocare:password-recovery-requested-at';
const COOLDOWN_MS=60000;

export default function ForgotPassword(){
const router=useRouter();
const[email,setEmail]=useState('');
const[loading,setLoading]=useState(false);
const[cooldown,setCooldown]=useState(0);
const[message,setMessage]=useState('');
const[error,setError]=useState('');

useEffect(()=>{
let timer;
const refresh=()=>{
const requestedAt=Number(window.localStorage.getItem(COOLDOWN_KEY)||0);
setCooldown(Math.max(0,Math.ceil((requestedAt+COOLDOWN_MS-Date.now())/1000)));
};
refresh();
timer=window.setInterval(refresh,1000);
return()=>window.clearInterval(timer);
},[]);

const submit=async event=>{
event.preventDefault();
if(loading)return;
setMessage('');
setError('');
const cleanEmail=email.trim().toLowerCase();
const at=cleanEmail.indexOf('@');
if(at<1||!cleanEmail.slice(at+1).includes('.')){
setError('Enter a valid email address.');
return;
}
if(cooldown>0){
setError('Please wait '+cooldown+' seconds before requesting another link.');
return;
}
setLoading(true);
try{
const redirectTo=getAuthRedirectUrl('/auth/verify?next='+encodeURIComponent('/reset-password'));
// Keep a short-lived marker in localStorage because the email may open in a
// new tab. The PKCE session itself still comes only from Supabase.
markPendingRecoveryRequest();
const result=await supabase.auth.resetPasswordForEmail(cleanEmail,{redirectTo});
if(result.error){
clearPendingRecoveryRequest();
const status=Number(result.error.status||0);
const detail=String(result.error.message||'').toLowerCase();
if(status===429||detail.includes('rate limit')||detail.includes('too many')){
window.localStorage.setItem(COOLDOWN_KEY,String(Date.now()));
setCooldown(60);
setError('Too many requests. Wait one minute before trying again.');
}else{
setError('We could not process the request right now. Please try again later.');
}
return;
}
window.localStorage.setItem(COOLDOWN_KEY,String(Date.now()));
setCooldown(60);
setMessage('If an NYEOCARE account matches that email address, a secure password reset link has been sent. Check your inbox and spam folder.');
}catch(requestError){
clearPendingRecoveryRequest();
console.error('[AUTH] Password recovery request failed:',requestError?.message||requestError);
setError('We could not process the request right now. Please try again later.');
}finally{
setLoading(false);
}
};

return <main style={styles.page}>
<div style={styles.glow}/>
<section style={styles.card}>
<div style={styles.brand}>NYEOCARE<div style={styles.goldLine}/></div>
<p style={styles.eyebrow}>ACCOUNT ACCESS</p>
<h1 style={styles.title}>Forgot your password?</h1>
<p style={styles.intro}>Enter the email address connected to your NYEOCARE account. We’ll send a secure link to choose a new password.</p>
<form onSubmit={submit}>
<label style={styles.label} htmlFor="recovery-email">Email address</label>
<input id="recovery-email" style={styles.input} type="email" value={email} onChange={event=>setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" autoCapitalize="none" spellCheck="false" required disabled={loading}/>
<button style={styles.primary} type="submit" disabled={loading||cooldown>0}>{loading?'Sending secure link…':cooldown>0?'Request again in '+cooldown+'s':'Send password reset link'}</button>
</form>
{message&&<p style={styles.success} role="status">{message}</p>}
{error&&<p style={styles.error} role="alert">{error}</p>}
<p style={styles.privacy}>For account privacy, this page does not reveal whether an email address is registered.</p>
<button style={styles.back} type="button" onClick={()=>router.push('/login')}>Back to sign in</button>
</section>
</main>;
}

const styles={
page:{minHeight:'100vh',minHeight:'100dvh',display:'grid',placeItems:'center',padding:20,boxSizing:'border-box',background:'#080d18',color:'#f3f4f6',position:'relative',overflow:'hidden',fontFamily:'Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'},
glow:{position:'fixed',inset:'-30%',pointerEvents:'none',background:'radial-gradient(ellipse at 50% 48%,rgba(230,185,63,.075),transparent 48%),radial-gradient(ellipse at 75% 20%,rgba(58,85,130,.12),transparent 45%)'},
card:{position:'relative',width:'100%',maxWidth:440,boxSizing:'border-box',padding:'40px 34px',borderRadius:28,border:'1px solid rgba(255,255,255,.07)',background:'rgba(16,23,39,.94)',boxShadow:'0 28px 90px rgba(0,0,0,.38)'},
brand:{textAlign:'center',fontSize:20,fontWeight:700,letterSpacing:3,marginBottom:36,color:'#fff'},
goldLine:{width:42,height:2,background:'#e6b93f',margin:'10px auto 0'},
eyebrow:{textAlign:'center',fontSize:10,letterSpacing:2,color:'rgba(255,255,255,.38)',margin:'0 0 12px'},
title:{textAlign:'center',fontSize:25,lineHeight:1.3,margin:'0 0 12px',color:'#fff'},
intro:{textAlign:'center',fontSize:14,lineHeight:1.7,color:'rgba(255,255,255,.58)',margin:'0 0 28px'},
label:{display:'block',fontSize:12,color:'rgba(255,255,255,.62)',margin:'0 0 8px'},
input:{width:'100%',boxSizing:'border-box',padding:'14px 15px',borderRadius:11,border:'1px solid rgba(255,255,255,.09)',background:'rgba(255,255,255,.035)',color:'#fff',fontSize:15,outline:'none'},
primary:{width:'100%',marginTop:14,padding:14,border:0,borderRadius:11,background:'#e6b93f',color:'#080d18',fontSize:14,fontWeight:700,cursor:'pointer'},
success:{padding:12,borderRadius:10,fontSize:13,lineHeight:1.6,margin:'17px 0 0',color:'#8be0b8',background:'rgba(52,211,153,.07)',border:'1px solid rgba(52,211,153,.16)'},
error:{padding:12,borderRadius:10,fontSize:13,lineHeight:1.6,margin:'17px 0 0',color:'#f29a9a',background:'rgba(239,68,68,.07)',border:'1px solid rgba(239,68,68,.16)'},
privacy:{textAlign:'center',color:'rgba(255,255,255,.32)',fontSize:11,lineHeight:1.6,margin:'19px 0 0'},
back:{display:'block',margin:'22px auto 0',border:0,background:'transparent',color:'#e6c96f',fontSize:13,cursor:'pointer'}
};

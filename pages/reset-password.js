// pages/reset-password.js
import{useEffect,useState}from'react';
import{useRouter}from'next/router';
import{supabase}from'../lib/supabaseClient';
import{getPasswordChecks,PASSWORD_POLICY_DESCRIPTION}from'../lib/authPasswordPolicy';
import{hasPendingRecoveryRequest,hasVerifiedRecoverySession,hasRecoveryCallbackBeenSeen,markVerifiedRecoverySession,clearPendingRecoveryRequest,clearVerifiedRecoverySession,clearRecoveryCallbackSeen}from'../lib/authRecoveryState';

export default function ResetPassword(){
const router=useRouter();
const[ready,setReady]=useState(false);
const[recovery,setRecovery]=useState(false);
const[password,setPassword]=useState('');
const[confirm,setConfirm]=useState('');
const[showPassword,setShowPassword]=useState(false);
const[showConfirm,setShowConfirm]=useState(false);
const[loading,setLoading]=useState(false);
const[message,setMessage]=useState('');
const[error,setError]=useState('');
const checks=getPasswordChecks(password);
const passwordReady=Object.values(checks).every(Boolean);

useEffect(()=>{
let mounted=true;
const{data:subscription}=supabase.auth.onAuthStateChange((event,session)=>{
if(mounted&&event==='PASSWORD_RECOVERY'&&session){
markVerifiedRecoverySession();
setRecovery(true);
}
});
const prepare=async()=>{
try{
// Supabase's singleton handles a PKCE URL during initialization. getSession()
// waits for that process, including callbacks that land directly on this page.
const{data,error:sessionError}=await supabase.auth.getSession();
if(sessionError)throw sessionError;
const recoveryContext=hasVerifiedRecoverySession()||(hasPendingRecoveryRequest()&&hasRecoveryCallbackBeenSeen());
if(mounted&&data?.session&&recoveryContext){
markVerifiedRecoverySession();
clearPendingRecoveryRequest();
clearRecoveryCallbackSeen();
setRecovery(true);
}
}catch(prepareError){
console.warn('[AUTH] Could not restore recovery state:',prepareError?.message||prepareError);
}
if(mounted)setReady(true);
};
if(router.isReady)prepare();
return()=>{mounted=false;subscription.subscription.unsubscribe()};
},[router.isReady,router.query.code]);

const submit=async event=>{
event.preventDefault();
if(loading)return;
setError('');
setMessage('');
if(!recovery)return setError('This recovery session is no longer valid. Request a fresh reset link.');
if(!passwordReady)return setError('Choose a stronger password. '+PASSWORD_POLICY_DESCRIPTION);
if(password!==confirm)return setError('The passwords do not match.');
setLoading(true);
try{
const{error:updateError}=await supabase.auth.updateUser({password});
if(updateError)throw updateError;
setMessage('Your password has been updated. Securing your account…');
try{await supabase.auth.signOut({scope:'global'});}
catch(signOutError){
console.warn('[AUTH] Global sign-out after password change failed:',signOutError?.message||signOutError);
await supabase.auth.signOut({scope:'local'});
}
clearPendingRecoveryRequest();
clearRecoveryCallbackSeen();
clearVerifiedRecoverySession();
window.setTimeout(()=>router.replace('/login?reset=success'),900);
}catch(updateError){
console.error('[AUTH] Password update failed:',updateError?.message||updateError);
const detail=String(updateError?.message||'').toLowerCase();
setError(detail.includes('password')||detail.includes('weak')?'Choose a stronger password that meets the requirements below.':'We could not update your password. Request a fresh reset link and try again.');
}finally{
setLoading(false);
}
};

if(!ready)return <main style={styles.page}><section style={styles.card}><div style={styles.brand}>NYEOCARE</div><p style={styles.muted}>Preparing your secure password reset…</p></section></main>;
if(!recovery)return <main style={styles.page}><section style={styles.card}>
<div style={styles.brand}>NYEOCARE</div><p style={styles.eyebrow}>ACCOUNT SECURITY</p><h1 style={styles.title}>Reset link unavailable</h1>
<p style={styles.muted}>This link has expired, was already used, or was not opened through the secure recovery flow.</p>
<button style={styles.primary} onClick={()=>router.replace('/forgot-password')}>Request a new reset link</button>
<button style={styles.back} onClick={()=>router.replace('/login')}>Back to sign in</button>
</section></main>;

return <main style={styles.page}><section style={styles.card}>
<div style={styles.brand}>NYEOCARE<div style={styles.goldLine}/></div><p style={styles.eyebrow}>ACCOUNT SECURITY</p>
<h1 style={styles.title}>Choose a new password</h1>
<p style={styles.muted}>Create a strong password for your NYEOCARE account.</p>
<form onSubmit={submit}>
<label style={styles.label} htmlFor="new-password">New password</label>
<div style={styles.inputWrap}><input id="new-password" style={styles.input} type={showPassword?'text':'password'} value={password} onChange={event=>setPassword(event.target.value)} autoComplete="new-password" minLength={12} required/><button style={styles.show} type="button" onClick={()=>setShowPassword(value=>!value)}>{showPassword?'Hide':'Show'}</button></div>
<div style={styles.requirements} aria-live="polite">
<span style={checks.length?styles.met:styles.requirement}>12+ characters</span>
<span style={checks.lowercase?styles.met:styles.requirement}>Lowercase letter</span>
<span style={checks.uppercase?styles.met:styles.requirement}>Uppercase letter</span>
<span style={checks.number?styles.met:styles.requirement}>Number</span>
<span style={checks.symbol?styles.met:styles.requirement}>Symbol</span>
</div>
<label style={styles.label} htmlFor="confirm-password">Confirm new password</label>
<div style={styles.inputWrap}><input id="confirm-password" style={styles.input} type={showConfirm?'text':'password'} value={confirm} onChange={event=>setConfirm(event.target.value)} autoComplete="new-password" minLength={12} required/><button style={styles.show} type="button" onClick={()=>setShowConfirm(value=>!value)}>{showConfirm?'Hide':'Show'}</button></div>
{error&&<p style={styles.error} role="alert">{error}</p>}
{message&&<p style={styles.success} role="status">{message}</p>}
<button style={styles.primary} disabled={loading||!passwordReady||password!==confirm}>{loading?'Updating password…':'Update password'}</button>
</form>
</section></main>;
}

const styles={
page:{minHeight:'100vh',minHeight:'100dvh',display:'grid',placeItems:'center',padding:20,boxSizing:'border-box',background:'#080d18',color:'#f3f4f6',fontFamily:'Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif'},
card:{width:'100%',maxWidth:460,padding:'38px 34px',boxSizing:'border-box',border:'1px solid rgba(255,255,255,.07)',borderRadius:26,background:'#101727',boxShadow:'0 25px 80px rgba(0,0,0,.38)'},
brand:{textAlign:'center',fontSize:20,fontWeight:700,letterSpacing:3,color:'#fff',marginBottom:34},
goldLine:{width:42,height:2,background:'#e6b93f',margin:'10px auto 0'},
eyebrow:{textAlign:'center',fontSize:10,letterSpacing:2,color:'rgba(255,255,255,.38)',margin:'0 0 12px'},
title:{textAlign:'center',fontSize:24,lineHeight:1.35,margin:'0 0 10px',color:'#fff'},
muted:{textAlign:'center',fontSize:14,lineHeight:1.7,color:'rgba(255,255,255,.55)',margin:'0 0 25px'},
label:{display:'block',margin:'18px 0 8px',fontSize:12,color:'rgba(255,255,255,.67)'},
inputWrap:{display:'flex',alignItems:'center',border:'1px solid rgba(255,255,255,.09)',borderRadius:11,background:'rgba(255,255,255,.035)',overflow:'hidden'},
input:{flex:1,minWidth:0,border:0,outline:0,background:'transparent',color:'#fff',padding:14,fontSize:15},
show:{border:0,background:'transparent',color:'#e6c96f',padding:'10px 13px',cursor:'pointer',fontSize:12},
requirements:{display:'flex',flexWrap:'wrap',gap:7,margin:'12px 0 20px'},
requirement:{fontSize:10,padding:'5px 8px',borderRadius:20,color:'rgba(255,255,255,.42)',background:'rgba(255,255,255,.035)'},
met:{fontSize:10,padding:'5px 8px',borderRadius:20,color:'#8be0b8',background:'rgba(52,211,153,.08)'},
primary:{width:'100%',border:0,borderRadius:11,background:'#e6b93f',color:'#080d18',fontSize:14,fontWeight:700,padding:14,marginTop:20,cursor:'pointer'},
back:{display:'block',margin:'20px auto 0',background:'transparent',border:0,color:'#e6c96f',cursor:'pointer'},
error:{fontSize:13,lineHeight:1.55,padding:11,borderRadius:9,margin:'14px 0 0',color:'#f29a9a',background:'rgba(239,68,68,.07)'},
success:{fontSize:13,lineHeight:1.55,padding:11,borderRadius:9,margin:'14px 0 0',color:'#8be0b8',background:'rgba(52,211,153,.07)'}
};

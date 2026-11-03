// pages/login.js
import{useEffect,useRef,useState}from'react';
import{useRouter}from'next/router';
import{supabase}from'../lib/supabaseClient';import{getClientSession,refreshClientSession}from'../lib/clientSession';
import{getPasswordChecks,PASSWORD_POLICY_DESCRIPTION}from'../lib/authPasswordPolicy';

function PasswordRequirement({ok,text}){return <span className={`password-requirement ${ok?'ok':''}`}><span className="requirement-dot" aria-hidden="true">{ok?'✓':''}</span>{text}</span>}

function getErrorMessage(error){
if(typeof error==='string')return error;
if(error?.message)return error.message;
if(error?.error_description)return error.error_description;
return'Something went wrong. Please try again.';
}

export default function Login(){
const router=useRouter();
const mountedRef=useRef(true);
const[email,setEmail]=useState('');
const[password,setPassword]=useState('');
const[name,setName]=useState('');
const[loading,setLoading]=useState(false);
const[unassigned,setUnassigned]=useState(false);
const[message,setMessage]=useState('');
const[pendingVerification,setPendingVerification]=useState(false);
const[verificationNext,setVerificationNext]=useState('/login?verified=1');
const[isLogin,setIsLogin]=useState(true);
const[showPassword,setShowPassword]=useState(false);const[passwordFocused,setPasswordFocused]=useState(false);
const passwordChecks=getPasswordChecks(password);
const passwordReady=Object.values(passwordChecks).every(Boolean);

useEffect(()=>{
mountedRef.current=true;
return()=>{mountedRef.current=false};
},[]);

useEffect(()=>{
if(!router.isReady)return;
let active=true;
if(router.query.mode==='signup')setIsLogin(false);
else if(router.query.mode==='login')setIsLogin(true);
const checkSession=async()=>{
 try{
  const session=await getClientSession();
  if(!active||!mountedRef.current||!session)return;
  const response=await fetch('/api/users/me',{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});
  if(!active||!mountedRef.current)return;
  if(response.ok){setUnassigned(false);await router.replace('/');return;}
  if(response.status===401){
   setUnassigned(true);
   setMessage('You are signed in, but this account is not connected to an organization. To join Havilah, reopen the invitation link. Do not create a separate organization for an existing invitation.');
  }else{
   setMessage('You are signed in, but NYEOCARE could not verify your organization access. Please try again.');
  }
 }catch(error){
  if(active&&mountedRef.current)console.warn('[AUTH] Existing session check delayed:',error?.message||error);
 }
};checkSession();
return()=>{active=false};
},[router.isReady,router.query.mode,router]);

const showMessage=text=>{
if(mountedRef.current)setMessage(text);
};

const handleLogin=async e=>{
e.preventDefault();
if(loading)return;
const cleanEmail=email.trim().toLowerCase();
if(!cleanEmail||!password){
showMessage('Please enter your email and password.');
return;
}
setLoading(true);
setMessage('');
try{
const{data,error}=await supabase.auth.signInWithPassword({email:cleanEmail,password});
if(error){
console.error('[AUTH] Password sign-in failed:',{code:error?.code||null,status:error?.status||null});
const code=String(error?.code||'').toLowerCase();
const errorText=String(error?.message||'').toLowerCase();
if(error?.status===429||code.includes('rate')||errorText.includes('rate limit')){
 showMessage('Too many sign-in attempts right now. Please wait a little and try again.');
}else if(code==='email_not_confirmed'||errorText.includes('email not confirmed')){
 setPendingVerification(true);
 setVerificationNext('/login?verified=1');
 showMessage('Your email still needs verification. Request a fresh NYEOCARE verification link below.');
}else{
 showMessage('We could not sign you in with those details. Check your email and password, or reset your password.');
}
return;
}
if(data?.session){
 const membership=await fetch('/api/users/me',{headers:{Authorization:'Bearer '+data.session.access_token},cache:'no-store'});
 if(membership.ok){setUnassigned(false);await router.replace('/');return}
 if(membership.status===401){
  setUnassigned(true);
  showMessage('You are signed in, but this account is not connected to an organization. To join Havilah, reopen the invitation link. Do not create a separate organization for an existing invitation.');
  return;
 }
 throw new Error('Sign-in worked, but NYEOCARE could not verify organization access. Please try again.');
}else showMessage('Sign in completed, but no session was created. Please try again.');
}catch(error){
console.error('Login error:',error);
showMessage(getErrorMessage(error));
}finally{
if(mountedRef.current)setLoading(false);
}
};

const handleSignup=async e=>{
e.preventDefault();
if(loading)return;
const cleanName=name.trim();
const cleanEmail=email.trim().toLowerCase();
if(!cleanName){showMessage('Please enter your display name.');return}
if(cleanName.length>120){showMessage('Your display name is too long.');return}
if(!cleanEmail){showMessage('Please enter your email.');return}
if(!passwordReady){
showMessage('Your password must meet this policy: '+PASSWORD_POLICY_DESCRIPTION);
return;
}
setLoading(true);
setMessage('');
try{
const{data,error}=await supabase.auth.signUp({
email:cleanEmail,
password,
options:{
data:{name:cleanName,display_name:cleanName},
emailRedirectTo:`${window.location.origin}/auth/verify?next=${encodeURIComponent('/auth/complete-signup')}`
}
});
if(error){
const text=error.message?.toLowerCase()||'';
if(text.includes('already registered')||text.includes('already exists')||error.code==='user_already_exists'){
showMessage('We could not create the account with those details. Try signing in or use password recovery if you already registered.');
}else if(text.includes('rate limit')||text.includes('rate_limited')){
showMessage('You’ve been temporarily rate-limited. Please wait a moment and try again.');
}else{
showMessage(getErrorMessage(error));
}
return;
}
if(data?.session){
 const response=await fetch('/api/auth/create-organization',{
  method:'POST',
  headers:{'Content-Type':'application/json',Authorization:'Bearer '+data.session.access_token},
  body:JSON.stringify({intent:'create_organization'})
 });
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(result.error||'Your account was created, but the new organization could not be set up. Please try again.');
 await router.replace('/');
 return;
}
setPendingVerification(true);
setVerificationNext('/auth/complete-signup');
showMessage('Your account is ready. We sent a verification link from NYEOCARE. Open it to verify your email and finish setting up your space.');
}catch(error){
console.error('Signup error:',error);
showMessage(getErrorMessage(error));
}finally{
if(mountedRef.current)setLoading(false);
}
};

const handleResendVerification=async()=>{
 if(loading)return;
 const cleanEmail=email.trim().toLowerCase();
 if(!cleanEmail){showMessage('Enter your email address first.');return;}
 setLoading(true);
 setMessage('');
 try{
  const{error}=await supabase.auth.resend({
   type:'signup',
   email:cleanEmail,
   options:{emailRedirectTo:`${window.location.origin}/auth/verify?next=${encodeURIComponent(verificationNext)}`}
  });
  if(error)throw error;
  showMessage('A fresh verification link has been sent. Check your inbox and spam folder.');
 }catch(error){
  const text=String(error?.message||'').toLowerCase();
  if(error?.status===429||text.includes('rate limit'))showMessage('Too many verification requests. Wait a little before requesting another link.');
  else showMessage('We could not send a new verification link right now. Please try again shortly.');
 }finally{
  if(mountedRef.current)setLoading(false);
 }
};

const handleCreateOrganization=async()=>{
 if(loading)return;
 setLoading(true);
 setMessage('');
 try{
  const session=await getClientSession();
  if(!session?.access_token)throw new Error('Please sign in again before creating an organization.');
  const response=await fetch('/api/auth/create-organization',{
   method:'POST',
   headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},
   body:JSON.stringify({intent:'create_organization'})
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'Unable to create your organization.');
  setUnassigned(false);
  await router.replace('/');
 }catch(error){
  showMessage(getErrorMessage(error));
 }finally{
  if(mountedRef.current)setLoading(false);
 }
};

const handleMagicLink=async()=>{
if(loading)return;
const cleanEmail=email.trim().toLowerCase();
if(!cleanEmail){showMessage('Please enter your email first.');return}
setLoading(true);
setMessage('');
try{
const{error}=await supabase.auth.signInWithOtp({
email:cleanEmail,
options:{emailRedirectTo:`${window.location.origin}/auth/verify?next=${encodeURIComponent('/login?magic=1')}`}
});
if(error){
const text=error.message?.toLowerCase()||'';
if(text.includes('rate limit')||text.includes('rate_limited')){
showMessage('Rate limit exceeded. Please wait a moment before requesting another magic link.');
}else showMessage(getErrorMessage(error));
return;
}
showMessage('📨 Check your email — I’ve sent you a way in.');
}catch(error){
console.error('Magic link error:',error);
showMessage(getErrorMessage(error));
}finally{
if(mountedRef.current)setLoading(false);
}
};

const switchMode=()=>{
if(loading)return;
setMessage('');
setPassword('');
setShowPassword(false);
setUnassigned(false);
setPendingVerification(false);
setIsLogin(current=>!current);
};

const isSuccess=message.startsWith('📨')||message.startsWith('Account created')||message.startsWith('Your account is ready')||message.startsWith('A fresh verification link');

return(
<div className="auth-container">
<div className="auth-canvas"><div className="auth-ambient"/></div>
<div className="auth-panel">
<div className="auth-brand">
<span className="auth-wordmark">NYEOCARE</span>
<span className="auth-tagline">Every Person. Every Story. Remembered.</span>
</div>
<p className="auth-welcome">
{isLogin?'Welcome back. Sign in to continue.':'Welcome. Let’s build your space.'}
</p>
<form onSubmit={isLogin?handleLogin:handleSignup} className="auth-form" noValidate>
{!isLogin&&(
<>
<label className="auth-label">Display name</label>
<input type="text" placeholder="How should people see your name?" value={name} onChange={e=>setName(e.target.value)} required maxLength={120} className="auth-input" autoComplete="name" disabled={loading}/>
</>
)}
<input type="email" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required className="auth-input" autoComplete="email" disabled={loading} inputMode="email" autoCapitalize="none" spellCheck="false"/>
<div className="password-wrap">
<input type={showPassword?'text':'password'} placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} onFocus={()=>setPasswordFocused(true)} required className="auth-input password-input" autoComplete={isLogin?'current-password':'new-password'} minLength={isLogin?undefined:12} disabled={loading}/>
<button type="button" className="password-toggle" onClick={()=>setShowPassword(current=>!current)} disabled={loading}>{showPassword?'Hide':'Show'}</button>
</div>
{!isLogin&&passwordFocused&&<div className={"password-guide "+(passwordReady?"ready":"")} aria-live="polite">{passwordReady?'Password is ready.':'Password needs: 12 characters, a lowercase letter, an uppercase letter, a number, and a symbol.'}</div>}
<button type="submit" disabled={loading} className="auth-button">{loading?(isLogin?'Signing in...':'Creating your space...'):(isLogin?'Sign In':'Create Account')}</button>
</form>
{isLogin&&<button type="button" className="auth-forgot" onClick={()=>router.push('/forgot-password')} disabled={loading}>Forgot password?</button>}
{isLogin&&unassigned&&<button type="button" onClick={handleCreateOrganization} disabled={loading} className="auth-create-org">{loading?'Creating organization…':'Create a new organization instead'}</button>}
<div className="auth-divider">— or —</div>
<button type="button" onClick={handleMagicLink} disabled={loading} className="auth-magic">Send Magic Link</button>
{message&&<p className={`auth-message ${isSuccess?'success':'error'}`}>{message}</p>}
{pendingVerification&&<button type="button" onClick={handleResendVerification} disabled={loading} className="auth-magic">{loading?'Sending…':'Resend verification email'}</button>}
<p className="auth-toggle">
{isLogin?(
<>Don’t have an account?{' '}<button type="button" onClick={switchMode} className="auth-toggle-link" disabled={loading}>Create one</button></>
):(
<>Already have an account?{' '}<button type="button" onClick={switchMode} className="auth-toggle-link" disabled={loading}>Log in</button></>
)}
</p>
</div>
<style jsx>{`
.auth-container{min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box;background:#080d18;overflow-x:hidden}
.auth-canvas{position:fixed;inset:0;z-index:0;overflow:hidden;background:radial-gradient(ellipse at 50% 50%,#101827 0%,#080d18 70%);pointer-events:none}
.auth-ambient{position:absolute;width:150%;height:150%;top:-25%;left:-25%;background:radial-gradient(ellipse at 40% 50%,rgba(230,185,63,.045) 0%,transparent 60%);animation:drift 30s ease-in-out infinite}
@keyframes drift{0%,100%{transform:translate3d(0,0,0)}50%{transform:translate3d(-1%,-1%,0)}}
.auth-panel{position:relative;z-index:1;width:100%;max-width:420px;box-sizing:border-box;background:rgba(16,23,39,.88);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-radius:32px;padding:40px 32px;border:1px solid rgba(255,255,255,.04);box-shadow:0 8px 60px rgba(0,0,0,.4)}
.auth-brand{text-align:center;margin-bottom:24px}
.auth-wordmark{display:inline-block;font-size:22px;font-weight:600;color:#f0f0f0;letter-spacing:2.8px;padding-bottom:4px;border-bottom:2px solid #e6b93f;text-shadow:0 0 16px rgba(230,185,63,.18)}
.auth-tagline{display:block;font-size:13px;color:rgba(255,255,255,.3);margin-top:6px}
.auth-welcome{color:rgba(255,255,255,.6);font-size:15px;text-align:center;margin:0 0 24px;line-height:1.6}
.auth-form{display:flex;flex-direction:column;gap:12px}
.auth-label{color:rgba(255,255,255,.55);font-size:12px;margin:0 2px -5px}
.auth-input{width:100%;box-sizing:border-box;padding:14px 16px;border-radius:12px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.03);color:#f0f0f0;font-size:15px;outline:none}
.auth-input::placeholder{color:rgba(255,255,255,.35)}
.auth-input:focus{border-color:rgba(230,185,63,.38);box-shadow:0 0 0 3px rgba(230,185,63,.055)}
.auth-input:disabled{opacity:.6}
.password-wrap{position:relative;width:100%}
.password-wrap .auth-input{padding-right:72px}
.password-toggle{position:absolute;right:8px;top:50%;transform:translateY(-50%);border:0;background:transparent;color:#e6b93f;font-size:13px;font-weight:500;padding:7px 8px;border-radius:7px;cursor:pointer}
.password-toggle:disabled{opacity:.5}
.password-guide{margin:-4px 2px 0;min-height:17px;color:#ef5b63;font-size:11px;line-height:1.4;letter-spacing:.005em;transition:color .18s ease}.password-guide.ready{color:#69d6a0}
.auth-button{width:100%;padding:14px;border-radius:12px;border:0;background:#e6b93f;color:#080d18;font-weight:600;font-size:16px;cursor:pointer;box-shadow:0 0 22px rgba(230,185,63,.16)}
.auth-button:disabled{opacity:.6;cursor:not-allowed}
.auth-forgot{display:block;margin:10px 0 0 auto;padding:4px 2px;border:0;background:transparent;color:#e6c96f;font-size:13px;cursor:pointer}.auth-forgot:disabled{opacity:.5}
.auth-divider{text-align:center;color:rgba(255,255,255,.2);font-size:13px;margin:16px 0}
.auth-create-org{width:100%;margin-top:12px;padding:12px;border-radius:12px;border:1px solid rgba(230,185,63,.24);background:rgba(230,185,63,.07);color:#e6c96f;font-size:13px;cursor:pointer}.auth-create-org:disabled{opacity:.5;cursor:not-allowed}
.auth-magic{width:100%;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.08);background:transparent;color:rgba(255,255,255,.6);font-size:14px;cursor:pointer}
.auth-magic:disabled{opacity:.5}
.auth-message{margin-top:16px;text-align:center;font-size:14px;padding:10px 12px;border-radius:8px;line-height:1.5}
.auth-message.error{color:#ef4444;background:rgba(239,68,68,.05)}
.auth-message.success{color:#34d399;background:rgba(52,211,153,.05)}
.auth-toggle{text-align:center;color:rgba(255,255,255,.4);font-size:14px;margin:20px 0 0}
.auth-toggle-link{padding:0;border:0;background:none;color:#e6b93f;cursor:pointer;font:inherit;font-weight:500;text-shadow:0 0 12px rgba(230,185,63,.12)}
.auth-toggle-link:disabled{opacity:.5}
@media(max-width:480px){.auth-container{padding:14px}.auth-panel{padding:32px 22px;border-radius:26px}}
@media(prefers-reduced-motion:reduce){.auth-ambient{animation:none}}
`}</style>
</div>
);
}

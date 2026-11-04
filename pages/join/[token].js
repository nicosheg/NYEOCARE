// pages/join/[token].js
import{useEffect,useState}from'react';
import{useRouter}from'next/router';
import{supabase}from'../../lib/supabaseClient';
import{getAuthRedirectUrl}from'../../lib/authRedirectUrl';
import{clearCached,publishDataChange}from'../../lib/appData';

export default function JoinPage(){
const router=useRouter();
const token=typeof router.query.token==='string'?router.query.token:'';
const[state,setState]=useState('loading');
const[data,setData]=useState(null);
const[mode,setMode]=useState('create');
const[name,setName]=useState('');
const[email,setEmail]=useState('');
const[password,setPassword]=useState('');
const[confirm,setConfirm]=useState('');
const[showPassword,setShowPassword]=useState(false);
const[showConfirm,setShowConfirm]=useState(false);
const[working,setWorking]=useState(false);
const[error,setError]=useState('');
const[pendingVerification,setPendingVerification]=useState(false);

useEffect(()=>{
if(!router.isReady||!token)return;
let active=true;

fetch(`/api/invites/${encodeURIComponent(token)}`)
.then(async r=>{
const d=await r.json();
if(!r.ok)throw new Error(d.error||'Invitation unavailable.');
return d;
})
.then(d=>{
if(!active)return;
setData(d);
if(d.email)setEmail(String(d.email).trim().toLowerCase());
setState('ready');
})
.catch(e=>{
if(!active)return;
setError(e.message||'Invitation unavailable.');
setState('error');
});

return()=>{active=false};
},[router.isReady,token]);

const validate=()=>{
const cleanName=name.trim();
const cleanEmail=email.trim().toLowerCase();

if(!cleanEmail)return'Please enter your email address.';
if(mode==='create'&&!cleanName)return'Please enter your display name.';
if(cleanName.length>120)return'Your display name is too long.';
if(password.length<6)return'Your password must be at least 6 characters.';
if(mode==='create'&&password!==confirm)return'The passwords do not match.';
return'';
};

const resendVerification=async()=>{
if(working)return;
const cleanEmail=email.trim().toLowerCase();
if(!cleanEmail){setError('Enter your email address first.');return;}
setWorking(true);
setError('');
try{
const{error:resendError}=await supabase.auth.resend({
type:'signup',
email:cleanEmail,
options:{emailRedirectTo:getAuthRedirectUrl('/auth/verify?next='+encodeURIComponent('/join/'+token))}
});
if(resendError)throw resendError;
setError('A fresh NYEOCARE verification link has been sent. Check your inbox and spam folder.');
}catch(e){
setError('We could not send a new verification link right now. Please try again shortly.');
}finally{
setWorking(false);
}
};

const join=async()=>{
if(working)return;

setError('');
const validation=validate();
if(validation)return setError(validation);

setWorking(true);

try{
const cleanName=name.trim();
const cleanEmail=email.trim().toLowerCase();

const auth=mode==='create'
?await supabase.auth.signUp({
email:cleanEmail,
password,
options:{
data:{name:cleanName},
emailRedirectTo:getAuthRedirectUrl('/auth/verify?next='+encodeURIComponent('/join/'+token))
}
})
:await supabase.auth.signInWithPassword({
email:cleanEmail,
password
});

if(auth.error){
const msg=auth.error.message?.toLowerCase()||'';

if(mode==='login'&&(auth.error.code==='email_not_confirmed'||msg.includes('email not confirmed'))){
setPendingVerification(true);
setError('Verify this email before signing in. Request a fresh NYEOCARE verification link below.');
return;
}

if(mode==='create'&&(msg.includes('already registered')||msg.includes('already exists')||msg.includes('already been registered'))){
setError('This email already has a NYEOCARE account. Choose “I already have an account” below.');
return;
}

throw auth.error;
}

const session=auth.data?.session;

if(!session){
if(mode==='create')setPendingVerification(true);
setError(
mode==='create'
?'Your account has been created. We sent a NYEOCARE verification link. Open it to verify your email and automatically join this organization.'
:'Sign in completed, but no session was created. Please try again.'
);
return;
}

const r=await fetch('/api/users/join',{
method:'POST',
headers:{
'Content-Type':'application/json',
Authorization:`Bearer ${session.access_token}`
},
body:JSON.stringify({
token,
name:mode==='create'?cleanName:undefined
})
});

const d=await r.json();

if(!r.ok)throw new Error(d.error||'Unable to join the organization.');

// A membership transfer changes the tenant context without changing the Supabase
// session. Drop user-scoped client caches before the app reloads under Havilah.
clearCached();
publishDataChange('organization-membership-changed',{organizationId:d.organization_id||null});
window.dispatchEvent(new Event('nyeocare:organization-membership-changed'));

setData(prev=>({...prev,...d}));
setState('joined');

setTimeout(()=>router.replace('/'),900);
}catch(e){
setError(e.message||'Unable to continue.');
}finally{
setWorking(false);
}
};

const switchMode=()=>{
if(working)return;
setError('');
setPendingVerification(false);
setPassword('');
setConfirm('');
setShowPassword(false);
setShowConfirm(false);
setMode(v=>v==='create'?'login':'create');
};

return(
<div className="page">
<div className="glow"/>
<main className="card">

{state==='loading'&&<div className="center">Opening invitation…</div>}

{state==='error'&&<>
<div className="mark">×</div>
<div className="eyebrow">INVITATION</div>
<h1>Invitation unavailable</h1>
<p>{error}</p>
<button className="secondary" onClick={()=>router.replace('/login')}>Return to sign in</button>
</>}

{state==='ready'&&data&&<>
<div className="mark">N</div>
<div className="eyebrow">YOU'RE INVITED</div>
<h1>Join {data.organization_name}</h1>
<p>You've been invited to join as a <strong>{data.role==='admin'?'Admin':'User'}</strong>.</p>

{data.email&&<div className="invite-email">Invitation for <strong>{data.email}</strong></div>}

<div className="modes">
<button className={mode==='create'?'selected':''} onClick={()=>{setMode('create');setError('')}} disabled={working}>New account</button>
<button className={mode==='login'?'selected':''} onClick={()=>{setMode('login');setError('')}} disabled={working}>I have an account</button>
</div>

{mode==='create'&&<>
<label>Display name</label>
<input
value={name}
onChange={e=>setName(e.target.value)}
placeholder="How should people see your name?"
type="text"
autoComplete="name"
maxLength={120}
disabled={working}
/>
</>}

<label>Email</label>
<input
value={email}
onChange={e=>setEmail(e.target.value)}
placeholder="Your email"
type="email"
autoComplete="email"
disabled={!!data.email||working}
/>

<label>{mode==='create'?'Create password':'Password'}</label>
<div className="password">
<input
value={password}
onChange={e=>setPassword(e.target.value)}
placeholder={mode==='create'?'Create a password':'Your password'}
type={showPassword?'text':'password'}
autoComplete={mode==='create'?'new-password':'current-password'}
minLength={6}
disabled={working}
/>
<button type="button" onClick={()=>setShowPassword(v=>!v)} disabled={working}>{showPassword?'Hide':'Show'}</button>
</div>

{mode==='create'&&<>
<label>Confirm password</label>
<div className="password">
<input
value={confirm}
onChange={e=>setConfirm(e.target.value)}
placeholder="Enter your password again"
type={showConfirm?'text':'password'}
autoComplete="new-password"
minLength={6}
disabled={working}
/>
<button type="button" onClick={()=>setShowConfirm(v=>!v)} disabled={working}>{showConfirm?'Hide':'Show'}</button>
</div>
<div className="hint">At least 6 characters. This password will be used to sign in to NYEOCARE.</div>
</>}

{error&&<div className="error">{error}</div>}
{pendingVerification&&<button className="secondary" type="button" onClick={resendVerification} disabled={working}>{working?'Sending…':'Resend verification email'}</button>}

<button className="primary" onClick={join} disabled={working}>
{working
?(mode==='create'?'Creating account…':'Signing in…')
:(mode==='create'?'Create account & join':'Sign in & join')}
</button>

<button className="switch" onClick={switchMode} disabled={working}>
{mode==='create'
?'Already have a NYEOCARE account? Sign in instead'
:'New to NYEOCARE? Create your account instead'}
</button>

<small>Your account will join <strong>{data.organization_name}</strong> with the invited responsibility.</small>
</>}

{state==='joined'&&<>
<div className="success">✓</div>
<div className="eyebrow">WELCOME</div>
<h1>You're in.</h1>
<p>You've joined <strong>{data.organization_name}</strong>.</p>
</>}

</main>

<style jsx>{`
*{box-sizing:border-box}
.page{min-height:100vh;min-height:100dvh;background:#050a14;color:#eef4ff;display:flex;align-items:center;justify-content:center;padding:20px;font-family:system-ui,-apple-system,sans-serif;position:relative;overflow:hidden}
.glow{position:fixed;width:500px;height:500px;border-radius:50%;background:rgba(44,105,180,.12);filter:blur(100px);pointer-events:none}
.card{position:relative;width:100%;max-width:430px;padding:34px 26px;border:1px solid rgba(220,235,250,.14);border-radius:30px;background:rgba(17,29,47,.78);backdrop-filter:blur(24px);box-shadow:0 30px 90px rgba(0,0,0,.35)}
.mark,.success{width:58px;height:58px;margin:0 auto 22px;border-radius:50%;display:grid;place-items:center;background:rgba(212,175,55,.1);border:1px solid rgba(212,175,55,.35);color:#f3df9c;font-weight:700;font-size:22px}
.success{color:#8ff0c4;border-color:rgba(52,211,153,.3);background:rgba(52,211,153,.08)}
.eyebrow{font-size:11px;letter-spacing:.16em;color:#8fb7ff;margin-bottom:10px}
.card h1{font-size:28px;margin:0 0 12px}
.card p{color:rgba(235,241,250,.62);line-height:1.65;margin:0 0 22px}
.card strong{color:#f3df9c;font-weight:500}
.card label{display:block;color:rgba(255,255,255,.55);font-size:12px;margin:12px 2px 7px}
.card input{width:100%;height:50px;border-radius:16px;border:1px solid rgba(220,235,250,.13);background:rgba(255,255,255,.045);color:white;padding:0 15px;outline:none;margin-bottom:4px}
.card input:focus{border-color:rgba(143,183,255,.45)}
.card input:disabled{opacity:.6}
.password{position:relative}
.password input{padding-right:68px}
.password button{position:absolute;right:8px;top:7px;height:36px;padding:0 9px;border:0;background:transparent;color:#d4af37;cursor:pointer}
.password button:disabled{opacity:.5}
.invite-email{font-size:13px;color:rgba(255,255,255,.45);margin:-5px 0 16px}
.modes{display:flex;gap:7px;margin:4px 0 17px;padding:4px;border-radius:16px;background:rgba(255,255,255,.035)}
.modes button{flex:1;border:0;border-radius:12px;padding:10px 7px;background:transparent;color:rgba(255,255,255,.4);font-size:12px;cursor:pointer}
.modes button.selected{background:rgba(212,175,55,.12);color:#f3df9c}
.hint{font-size:12px;color:rgba(255,255,255,.35);line-height:1.5;margin:7px 2px 13px}
.error{font-size:13px;line-height:1.5;color:#ff9d9d;margin:12px 2px}
.primary,.secondary{width:100%;height:50px;border-radius:18px;font-size:15px;cursor:pointer}
.primary{border:1px solid rgba(212,175,55,.3);background:rgba(212,175,55,.13);color:#f3df9c}
.primary:disabled{opacity:.4;cursor:not-allowed}
.secondary{border:1px solid rgba(255,255,255,.1);background:transparent;color:rgba(255,255,255,.65);margin-top:10px}
.switch{width:100%;border:0;background:transparent;color:#8fb7ff;font-size:12px;padding:13px 5px 4px;cursor:pointer}
.switch:disabled{opacity:.5}
.card small{display:block;margin-top:15px;text-align:center;line-height:1.5;color:rgba(255,255,255,.3)}
.center{text-align:center;color:rgba(255,255,255,.5)}
@media(max-width:480px){.page{padding:14px}.card{padding:29px 20px;border-radius:25px}}
`}</style>
</div>
);
   }

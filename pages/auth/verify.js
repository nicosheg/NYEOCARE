// pages/auth/verify.js
import{useEffect,useRef,useState}from'react';
import{useRouter}from'next/router';
import{supabase}from'../../lib/supabaseClient';
import{getClientSession}from'../../lib/clientSession';
import{clearCached,publishDataChange}from'../../lib/appData';
import{hasPendingRecoveryRequest,hasVerifiedRecoverySession,hasRecoveryCallbackBeenSeen,markVerifiedRecoverySession,clearPendingRecoveryRequest,clearRecoveryCallbackSeen}from'../../lib/authRecoveryState';

function safeNext(value){
if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//')||value.includes('\\'))return'/login?verified=1';
try{
const parsed=new URL(value,window.location.origin);
if(parsed.origin!==window.location.origin)return'/login?verified=1';
if(parsed.pathname==='/auth/complete-signup')return parsed.pathname;
if(parsed.pathname==='/reset-password')return parsed.pathname;
if(parsed.pathname==='/login')return parsed.pathname+parsed.search;
const invite=parsed.pathname.match(/^\/join\/([A-Za-z0-9_-]+)$/);
if(invite)return parsed.pathname;
return'/login?verified=1';
}catch{return'/login?verified=1'}
}

export default function VerifyEmail(){
const router=useRouter();
const started=useRef(false);
const[status,setStatus]=useState('Verifying your email address…');
const[detail,setDetail]=useState('Securing your NYEOCARE account.');
const[error,setError]=useState('');
const[done,setDone]=useState(false);

useEffect(()=>{
if(!router.isReady||started.current)return;
started.current=true;
let active=true;
const run=async()=>{
try{
const next=safeNext(typeof router.query.next==='string'?router.query.next:'');
const tokenHash=typeof router.query.token_hash==='string'?router.query.token_hash:'';
const code=typeof router.query.code==='string'?router.query.code:'';
let recoveryVerified=false;
let authError=null;
let session=null;
if(tokenHash){
const type=typeof router.query.type==='string'?router.query.type:'signup';
if(!['signup','magiclink','recovery'].includes(type))throw new Error('This verification link is not supported. Request a new NYEOCARE link.');
if(type==='recovery')recoveryVerified=true;
const result=await supabase.auth.verifyOtp({token_hash:tokenHash,type});
authError=result.error;
session=result.data?.session||null;
}else if(code){
// Supabase's singleton owns URL parsing and the PKCE exchange. Calling
// exchangeCodeForSession here would compete with automatic initialization
// and loses the recovery event metadata. getSession waits for initialization.
const result=await supabase.auth.getSession();
authError=result.error;
session=result.data?.session||null;
recoveryVerified=hasVerifiedRecoverySession()||(next==='/reset-password'&&hasPendingRecoveryRequest()&&hasRecoveryCallbackBeenSeen());
}else{
session=await supabase.auth.getSession().then(result=>{
  if(result.error)throw result.error;
  return result.data?.session||null;
});
recoveryVerified=hasVerifiedRecoverySession()||(hasPendingRecoveryRequest()&&hasRecoveryCallbackBeenSeen());
}
if(authError)throw authError;
if(!session)session=await getClientSession();
if(!session?.access_token)throw new Error('The link could not establish a secure session. Request a fresh verification email and open it on this device.');
if(!active)return;

if(recoveryVerified){
// PASSWORD_RECOVERY is a Supabase-authenticated event, so it takes
// precedence over a missing/overridden next parameter and must never be
// treated as an ordinary sign-in or email-confirmation callback.
markVerifiedRecoverySession();
clearPendingRecoveryRequest();
clearRecoveryCallbackSeen();
setStatus('Recovery link verified.');
setDetail('Your account is secure. Choose a new password to continue.');
setDone(true);
window.setTimeout(()=>{if(active)router.replace('/reset-password')},650);
return;
}
if(next==='/reset-password')throw new Error('This reset link is incomplete. Request a fresh password reset email.');

const invitation=next.match(/^\/join\/([A-Za-z0-9_-]+)$/);
if(invitation){
setStatus('Email verified. Completing your invitation…');
setDetail('Connecting your account to the organization that invited you.');
const response=await fetch('/api/users/join',{
method:'POST',
headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},
body:JSON.stringify({token:invitation[1],name:String(session.user?.user_metadata?.name||session.user?.user_metadata?.full_name||'').trim()||undefined})
});
const result=await response.json().catch(()=>({}));
if(!response.ok)throw new Error(result.error||'Your email is verified, but we could not complete the invitation. Open the original invitation again or contact an organization administrator.');
clearCached();
publishDataChange('organization-membership-changed',{organizationId:result.organization_id||null});
window.dispatchEvent(new Event('nyeocare:organization-membership-changed'));
setStatus('You’re verified and connected.');
setDetail('Your NYEOCARE organization is ready.');
setDone(true);
window.setTimeout(()=>{if(active)router.replace('/')},900);
return;
}

if(next==='/auth/complete-signup'){
setStatus('Email verified. Preparing your space…');
setDetail('Finishing your NYEOCARE account setup.');
const response=await fetch('/api/auth/create-organization',{
method:'POST',
headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},
body:JSON.stringify({intent:'create_organization'})
});
const result=await response.json().catch(()=>({}));
if(!response.ok)throw new Error(result.error||'Your email is verified, but your NYEOCARE space could not be created. Sign in and try again.');
setStatus('Your email is verified.');
setDetail('Your NYEOCARE space is ready.');
setDone(true);
window.setTimeout(()=>{if(active)router.replace('/')},900);
return;
}
setStatus('Your email is verified.');
setDetail('Your NYEOCARE account is ready. Taking you back to sign in.');
setDone(true);
window.setTimeout(()=>{if(active)router.replace(next)},900);
}catch(e){
if(!active)return;
setError(e?.message||'This verification link could not be completed.');
setStatus('We couldn’t complete verification.');
setDetail('Your account has not been connected to an organization.');
}
};
run();
return()=>{active=false};
},[router.isReady,router.query]);

return(
<div className="verify-page">
<div className="ambient"/>
<main className="verify-card" aria-live="polite">
<div className="brand">NYEOCARE<span/></div>
<div className={'mark '+(error?'failed':done?'success':'')}>{error?'!':done?'✓':'N'}</div>
<p className="eyebrow">ACCOUNT SECURITY</p>
<h1>{status}</h1>
<p className="detail">{detail}</p>
{!error&&!done&&<div className="progress"><span/></div>}
{error&&<>
<p className="error">{error}</p>
<a className="action" href="/login">Return to NYEOCARE</a>
</>}
{done&&<p className="success-copy">You can safely close this page after it opens your workspace.</p>}
</main>
<style jsx>{`
.verify-page{min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:22px;box-sizing:border-box;background:#080d18;color:#f2f3f6;overflow:hidden;position:relative}
.ambient{position:fixed;inset:-35%;pointer-events:none;background:radial-gradient(ellipse at 50% 50%,rgba(230,185,63,.07),transparent 48%),radial-gradient(ellipse at 70% 30%,rgba(58,85,130,.13),transparent 45%)}
.verify-card{position:relative;width:100%;max-width:430px;padding:44px 34px;border:1px solid rgba(255,255,255,.07);border-radius:28px;background:rgba(16,23,39,.9);box-shadow:0 28px 90px rgba(0,0,0,.38);text-align:center}
.brand{font-size:20px;font-weight:700;letter-spacing:3px;color:#f4f4f4;margin-bottom:38px}
.brand span{display:block;width:42px;height:2px;background:#e6b93f;margin:10px auto 0}
.mark{width:62px;height:62px;margin:0 auto 22px;border-radius:20px;display:grid;place-items:center;background:rgba(230,185,63,.09);border:1px solid rgba(230,185,63,.23);color:#e6c56a;font-size:25px;font-weight:600}
.mark.success{background:rgba(52,211,153,.08);border-color:rgba(52,211,153,.22);color:#6ad7a9}
.mark.failed{background:rgba(239,68,68,.08);border-color:rgba(239,68,68,.22);color:#ef7777}
.eyebrow{font-size:10px;letter-spacing:2px;color:rgba(255,255,255,.38);margin:0 0 12px}
h1{font-size:22px;line-height:1.35;font-weight:600;margin:0 auto 12px;max-width:330px}
.detail{font-size:14px;color:rgba(255,255,255,.54);line-height:1.65;margin:0 auto;max-width:330px}
.progress{height:3px;background:rgba(255,255,255,.07);border-radius:10px;overflow:hidden;margin:30px 12px 0}
.progress span{display:block;width:38%;height:100%;border-radius:10px;background:#e6b93f;animation:move 1.2s ease-in-out infinite alternate}
.error{font-size:13px;color:#f08b8b;line-height:1.6;margin:20px 0 0}
.action{display:block;margin-top:22px;padding:13px 16px;border-radius:12px;background:#e6b93f;color:#080d18;text-decoration:none;font-weight:600}
.success-copy{font-size:12px;color:rgba(255,255,255,.35);margin-top:22px}
@keyframes move{from{transform:translateX(0)}to{transform:translateX(165%)}}
@media(max-width:480px){.verify-card{padding:38px 24px;border-radius:24px}}
@media(prefers-reduced-motion:reduce){.progress span{animation:none;width:100%}}
`}</style>
</div>
);
}

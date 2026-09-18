// pages/profile.js
import{useEffect,useState}from'react';
import{useRouter}from'next/router';
import Layout from'../components/Layout';
import FirstExperience from'../components/FirstExperience';
import{useOnboarding}from'../components/OnboardingProvider';
import{supabase}from'../lib/supabaseClient';

const roleLabel=r=>r==='owner'?'Owner':r==='admin'?'Admin':'User';

function ProfileSkeleton(){
return <Layout><div className="wrap skeletonWrap"><header><div className="sk avatarSk"/><div className="skHead"><div className="sk skEye"/><div className="sk skTitle"/><div className="sk skSub"/></div></header><div className="sections">{[1,2,3,4,5].map(x=><div className="sk skCard" key={x}><div className="skCardText"><div className="sk skLabel"/><div className="sk skLine"/><div className="sk skSmall"/></div><div className="sk skArrow"/></div>)}</div><style jsx>{`.skeletonWrap{animation:softIn .45s ease-out}.sk{position:relative;overflow:hidden;background:rgba(255,255,255,.055)}.sk:after{content:"";position:absolute;inset:0;transform:translateX(-120%);background:linear-gradient(105deg,transparent 20%,rgba(255,255,255,.055) 45%,rgba(255,255,255,.08) 50%,rgba(255,255,255,.055) 55%,transparent 80%);animation:shimmer 3.2s cubic-bezier(.37,0,.63,1) infinite}.avatarSk{width:58px;height:58px;border-radius:20px}.skHead{display:flex;flex-direction:column;gap:7px;flex:1}.skEye{width:58px;height:8px;border-radius:6px}.skTitle{width:145px;height:18px;border-radius:7px}.skSub{width:190px;height:10px;border-radius:6px}.skCard{height:72px;border:1px solid rgba(220,235,250,.07);border-radius:22px;background:rgba(20,33,52,.32);display:flex;align-items:center;justify-content:space-between;padding:16px 17px}.skCardText{display:flex;flex-direction:column;gap:7px}.skLabel{width:48px;height:7px;border-radius:5px}.skLine{width:120px;height:14px;border-radius:6px}.skSmall{width:175px;height:8px;border-radius:5px}.skArrow{width:8px;height:22px;border-radius:5px}.skeletonWrap header{display:flex;align-items:center;gap:12px;padding:4px 2px 16px}.skeletonWrap .sections{display:flex;flex-direction:column;gap:10px}@keyframes shimmer{0%{transform:translateX(-120%)}55%,100%{transform:translateX(120%)}}@keyframes softIn{from{opacity:.55}to{opacity:1}}@media(max-width:600px){.skCard{border-radius:15px}.skeletonWrap header{padding-left:2px}.wrap{max-width:440px;padding-left:11px;padding-right:11px}.cardHead strong{font-size:13px}}`}</style></div></Layout>
}

export default function ProfilePage(){
const onboarding=useOnboarding();
const router=useRouter();
const[profile,setProfile]=useState(null);
const[users,setUsers]=useState([]);
const[open,setOpen]=useState(null);
const[loading,setLoading]=useState(true);
const[saving,setSaving]=useState(false);
const[msg,setMsg]=useState('');
const[invite,setInvite]=useState(null);
const[inviteRole,setInviteRole]=useState('user');
const[shareOpen,setShareOpen]=useState(false);
const[name,setName]=useState('');
const[userName,setUserName]=useState('');
const[aria,setAria]=useState('');
const[passwordEmail,setPasswordEmail]=useState(false);
const[ariaMessages,setAriaMessages]=useState([]);
const[ariaInput,setAriaInput]=useState('');
const[ariaSending,setAriaSending]=useState(false);
const[ariaConversationId,setAriaConversationId]=useState(null);
const[passwordLoading,setPasswordLoading]=useState(false);

const load=async()=>{
try{
const{data:{session}}=await supabase.auth.getSession();
if(!session)return router.replace('/login');
const h={Authorization:`Bearer ${session.access_token}`};
const[a,b]=await Promise.all([fetch('/api/profile',{headers:h}),fetch('/api/users',{headers:h})]);
if(a.status===401||b.status===401)return router.replace('/login');
if(!a.ok)throw new Error('Unable to load profile.');
const d=await a.json();
setProfile(d);
setName(d.organization?.name||'');
setUserName(d.user?.name||'');
setAria(d.organization?.aria_instructions||'');
if(b.ok){
const data=await b.json();
setUsers(Array.isArray(data)?data:(data.users||[]));
}
}catch(e){
setMsg(e.message||'Unable to load profile.');
}finally{
setLoading(false);
}
};

useEffect(()=>{load()},[]);

const save=async()=>{
if(!profile)return;
setSaving(true);setMsg('');
try{
const{data:{session}}=await supabase.auth.getSession();
if(!session)return router.replace('/login');
const body={userName};
if(profile.user.role==='owner')body.name=name;
if(['owner','admin'].includes(profile.user.role))body.ariaInstructions=aria;
const r=await fetch('/api/profile',{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify(body)});
const d=await r.json();
if(!r.ok)return setMsg(d.error||'Unable to save.');
setProfile(p=>({...p,user:d.user||p.user,organization:d.organization||p.organization}));
if(d.user)setUserName(d.user.name||'');
if(d.organization){
setName(d.organization.name||'');
setAria(d.organization.aria_instructions||'');
}
setMsg('Saved');
setTimeout(()=>setMsg(''),1800);
}catch(e){
setMsg('Unable to save.');
}finally{
setSaving(false);
}
};

const createInvite=async()=>{
try{
const{data:{session}}=await supabase.auth.getSession();
if(!session)return router.replace('/login');
const r=await fetch('/api/users/invite',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({role:inviteRole})});
const d=await r.json();
if(!r.ok)return setMsg(d.error||'Unable to create invite.');
setInvite(d);setShareOpen(true);
}catch(e){setMsg('Unable to create invite.')}
};

const share=async()=>{
if(navigator.share){
try{await navigator.share({title:`Join ${profile.organization.name} on NYEOCARE`,text:`You've been invited to join ${profile.organization.name} on NYEOCARE as ${invite.role==='admin'?'an Admin':'a User'}.`,url:invite.url})}catch{}
}else{
try{await navigator.clipboard.writeText(invite.url);setMsg('Invite copied')}catch{setMsg('Unable to copy invite.')}
}
};


const askAria=async()=>{const message=ariaInput.trim();if(!message||ariaSending)return;setAriaSending(true);setAriaInput('');setAriaMessages(m=>[...m,{role:'user',content:message}]);try{const{data:{session}}=await supabase.auth.getSession();if(!session)return router.replace('/login');const r=await fetch('/api/aria/chat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({message,conversationId:ariaConversationId})});const d=await r.json();if(!r.ok)throw new Error(d.error||'ARIA could not process that.');if(d.conversationId)setAriaConversationId(d.conversationId);setAriaMessages(m=>[...m,{role:'assistant',content:d.text||'I have checked what I can safely access.'}]);}catch(e){setAriaMessages(m=>[...m,{role:'assistant',content:e.message||'I could not process that safely.'}]);}finally{setAriaSending(false)}};

const resetPassword=async()=>{
if(passwordLoading)return;
setPasswordLoading(true);setPasswordEmail(false);setMsg('');
try{
const{data:{session}}=await supabase.auth.getSession();
if(!session)return router.replace('/login');
const r=await fetch('/api/profile/password-reset',{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`}});
const d=await r.json();
if(!r.ok)return setMsg(d.error||'Unable to send the secure reset link.');
setPasswordEmail(true);
}catch(e){setMsg('Unable to send the secure reset link.')}finally{setPasswordLoading(false)}
};

const remove=async id=>{
if(!confirm('Remove this user from the organization?'))return;
try{
const{data:{session}}=await supabase.auth.getSession();
if(!session)return router.replace('/login');
const r=await fetch(`/api/users/${id}`,{method:'DELETE',headers:{Authorization:`Bearer ${session.access_token}`}});
if(r.ok)load();else setMsg((await r.json()).error||'Unable to remove user.');
}catch(e){setMsg('Unable to remove user.')}
};

const transfer=async id=>{
if(!confirm('Transfer ownership to this user? You will become an Admin.'))return;
try{
const{data:{session}}=await supabase.auth.getSession();
if(!session)return router.replace('/login');
const r=await fetch(`/api/users/${id}`,{method:'PUT',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({role:'owner'})});
if(r.ok)load();else setMsg((await r.json()).error||'Unable to transfer ownership.');
}catch(e){setMsg('Unable to transfer ownership.')}
};

if(loading)return <ProfileSkeleton/>;

if(!profile?.user||!profile?.organization)return <Layout><div className="wrap"><div className="toast">Unable to load your profile.</div></div></Layout>;

const u=profile.user,o=profile.organization;
const activeUsers=users.filter(x=>x.active);

return <Layout><div className="wrap">
{onboarding?.loaded&&onboarding.enabled&&!onboarding.isExperienced('profile')&&<FirstExperience experience="profile" onComplete={()=>onboarding.completeExperience('profile')}/>}
<header><div className="avatar">{(u.name||'U').trim().charAt(0).toUpperCase()}</div><div><div className="eyebrow">PROFILE</div><h1>{u.name}</h1><div className="sub">{roleLabel(u.role)} · {u.email}</div></div></header>

<div className="sections">
<section className={`card ${open==='organization'?'open':''}`}><button className="cardHead" onClick={()=>setOpen(open==='organization'?null:'organization')}><div><span className="label">Organization</span><strong>{o.name}</strong><small>{activeUsers.length} active users · Active</small></div><span className="arrow">›</span></button>{open==='organization'&&<div className="body"><label>Your name</label><input value={userName} onChange={e=>setUserName(e.target.value)} maxLength={120}/><label>Organization name</label><input value={name} onChange={e=>setName(e.target.value)} disabled={u.role!=='owner'} maxLength={120}/>{u.role!=='owner'&&<p className="hint">Only the owner can change the organization name.</p>}{u.role!=='user'&&<button className="action" onClick={()=>setOpen('users')}>Manage users ›</button>}{u.role!=='user'&&<button className="action" onClick={()=>setOpen('aria')}>ARIA knowledge ›</button>}<button className="save" onClick={save} disabled={saving}>{saving?'Saving…':'Save changes'}</button></div>}</section>

<section className={`card ${open==='aria'?'open':''}`}><button className="cardHead" onClick={()=>setOpen(open==='aria'?null:'aria')}><div><span className="label">ARIA</span><strong>Talk to ARIA about your organization</strong><small>{aria?'ARIA has your saved organization guidance':'Ask about people, birthdays, follow-ups or what matters here'}</small></div><span className="arrow">›</span></button>{open==='aria'&&<div className="body"><div className="ariaIntro">You can talk to ARIA directly about the organization. She can read the people, upcoming birthdays, follow-ups and other available context. She will not send messages or change records without the required human approval.</div><div className="ariaChat">{ariaMessages.length===0?<div className="ariaEmpty">Try: “Who has a birthday coming up?”<br/>“What follow-ups are due next?”<br/>“Tell me what you know about this organization.”</div>:ariaMessages.map((m,i)=><div key={i} className={`ariaMsg ${m.role}`}>{m.content}</div>)}</div><div className="ariaComposer"><input value={ariaInput} onChange={e=>setAriaInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')askAria()}} placeholder="Ask ARIA anything about the organization…" maxLength={2000}/><button onClick={askAria} disabled={ariaSending||!ariaInput.trim()}>{ariaSending?'…':'Ask'}</button></div><div className="savedGuidance"><textarea value={aria} onChange={e=>setAria(e.target.value)} disabled={!['owner','admin'].includes(u.role)} placeholder="Optional: save lasting organization guidance for ARIA."/><div className="counter">{aria.length}/2000</div>{['owner','admin'].includes(u.role)&&<button className="save" onClick={save} disabled={saving}>{saving?'Saving…':'Save lasting ARIA knowledge'}</button>}</div></div>}</section>

<section className={`card ${open==='users'?'open':''}`}><button className="cardHead" onClick={()=>setOpen(open==='users'?null:'users')}><div><span className="label">ACCESS</span><strong>Users</strong><small>{activeUsers.length} people have access</small></div><span className="arrow">›</span></button>{open==='users'&&<div className="body"><div className="userList">{activeUsers.map(x=><div className="user" key={x.id}><div className="mini">{(x.name||'U').charAt(0).toUpperCase()}</div><div className="userInfo"><strong>{x.name}</strong><small>{roleLabel(x.role)} · {x.email}</small></div>{x.id!==u.id&&<div className="userMenu">{u.role==='owner'&&x.role!=='owner'&&<button onClick={()=>transfer(x.id)}>Transfer</button>}{(u.role==='owner'||u.role==='admin')&&x.role!=='owner'&&<button onClick={()=>remove(x.id)}>Remove</button>}</div>}</div>)}</div><button className="invite" onClick={()=>{setInvite(null);setShareOpen(false);setOpen('invite')}}>＋ Add user</button></div>}</section>

<section className={`card ${open==='invite'?'open':''}`}><button className="cardHead" onClick={()=>setOpen(open==='invite'?null:'invite')}><div><span className="label">INVITE</span><strong>Add someone</strong><small>One-time access link</small></div><span className="arrow">›</span></button>{open==='invite'&&<div className="body"><p className="hint">Create a one-time link. Send it directly through WhatsApp, Messages, email or any app on your phone.</p><div className="roles"><button className={inviteRole==='user'?'selected':''} onClick={()=>setInviteRole('user')}><b>User</b><small>Everyday access</small></button><button className={inviteRole==='admin'?'selected':''} onClick={()=>setInviteRole('admin')}><b>Admin</b><small>Manage people & ARIA</small></button></div><button className="save" onClick={createInvite}>Create invite</button></div>}</section>

<section className={`card ${open==='account'?'open':''}`}><button className="cardHead" onClick={()=>setOpen(open==='account'?null:'account')}><div><span className="label">ACCOUNT</span><strong>Security & preferences</strong><small>{roleLabel(u.role)} · {u.email}</small></div><span className="arrow">›</span></button>{open==='account'&&<div className="body"><button className="action" onClick={resetPassword} disabled={passwordLoading}>{passwordLoading?'Sending secure link…':'Recreate password ›'}</button>{passwordEmail&&<p className="hint good">A secure password reset link has been sent to {u.email}.</p>}<button className="action" onClick={async()=>{await supabase.auth.signOut();router.replace('/login')}}>Sign out</button></div>}</section>
</div>

{msg&&<div className="toast">{msg}</div>}
{shareOpen&&invite&&<div className="overlay" onClick={()=>setShareOpen(false)}><div className="sheet" onClick={e=>e.stopPropagation()}><div className="sheetHandle"/><div className="eyebrow">INVITE READY</div><h2>Ready to share</h2><p>One use only · expires in 48 hours</p><div className="linkBox">{invite.url}</div><button className="save" onClick={share}>Share invite</button><button className="copy" onClick={async()=>{try{await navigator.clipboard.writeText(invite.url);setMsg('Invite copied');setShareOpen(false)}catch{setMsg('Unable to copy invite.')}}}>Copy link</button></div></div>}

<style jsx>{`
.wrap{width:100%;max-width:460px;margin:0 auto;padding:2px 12px 72px;color:#eef4ff}.loading{text-align:center;color:rgba(255,255,255,.4);padding:80px 0}header{display:flex;align-items:center;gap:12px;padding:6px 2px 16px}.avatar{width:42px;height:42px;border-radius:14px;display:grid;place-items:center;background:rgba(212,175,55,.1);border:1px solid rgba(212,175,55,.28);color:#f3df9c;font-size:17px;font-weight:650;box-shadow:0 10px 30px rgba(0,0,0,.18)}.eyebrow,.label{font-size:10px;letter-spacing:.15em;color:#8fb7ff}.card{margin-bottom:7px;border:1px solid rgba(220,235,250,.105);border-radius:14px;background:rgba(20,33,52,.45);backdrop-filter:blur(18px);overflow:hidden;transition:border-color .28s ease,background .28s ease,box-shadow .32s ease}.card.open{border-color:rgba(212,175,55,.2);background:rgba(24,37,56,.58);box-shadow:0 8px 24px rgba(0,0,0,.08)}.cardHead{width:100%;padding:11px 12px;display:flex;align-items:center;justify-content:space-between;background:none;border:0;color:white;text-align:left;cursor:pointer}.cardHead>div{display:flex;flex-direction:column;gap:3px;min-width:0}.cardHead strong{font-size:13px;font-weight:560;line-height:1.3}.cardHead small{color:rgba(235,241,250,.4);font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.arrow{font-size:20px;color:rgba(255,255,255,.3);transition:transform .34s cubic-bezier(.22,1,.36,1),color .25s ease}.open .arrow{transform:rotate(90deg);color:#d4af37}.body{max-height:0;padding:0 17px;opacity:0;transform:translateY(-7px);overflow:hidden;transition:max-height .38s cubic-bezier(.22,1,.36,1),padding .34s ease,opacity .24s ease,transform .34s cubic-bezier(.22,1,.36,1)}.card.open .body{max-height:1200px;padding:0 12px 12px;opacity:1;transform:translateY(0)}.body label{display:block;color:rgba(255,255,255,.5);font-size:11px;margin:3px 0 7px}.body input,.body textarea{width:100%;border:1px solid rgba(220,235,250,.12);background:rgba(255,255,255,.035);color:white;border-radius:11px;padding:10px;outline:none;box-sizing:border-box}.body textarea{min-height:130px;resize:vertical;line-height:1.55}.ariaIntro{color:rgba(255,255,255,.48);font-size:11px;line-height:1.55;margin-bottom:12px}.ariaChat{display:flex;flex-direction:column;gap:8px;max-height:360px;overflow:auto;margin-bottom:10px}.ariaMsg{max-width:92%;padding:11px 12px;border-radius:14px;font-size:12px;line-height:1.55;white-space:pre-wrap}.ariaMsg.user{align-self:flex-end;background:rgba(214,184,106,.12);border:1px solid rgba(214,184,106,.2);color:#f3df9c}.ariaMsg.assistant{align-self:flex-start;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.07);color:rgba(245,247,250,.82)}.ariaEmpty{padding:13px;border-radius:14px;background:rgba(143,175,214,.045);border:1px solid rgba(143,175,214,.1);color:rgba(255,255,255,.38);font-size:11px;line-height:1.7}.ariaComposer{display:flex;gap:7px}.ariaComposer input{flex:1;min-width:0}.ariaComposer button{min-width:58px;border:1px solid rgba(214,184,106,.25);border-radius:14px;background:rgba(214,184,106,.1);color:#f3df9c}.ariaComposer button:disabled{opacity:.45}.savedGuidance{margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,.06)}.body input:disabled,.body textarea:disabled{opacity:.5}.hint{color:rgba(255,255,255,.4);font-size:11px;line-height:1.55;margin:9px 0}.counter{text-align:right;color:rgba(255,255,255,.25);font-size:10px;margin:5px 2px}.save,.invite,.action,.copy{width:100%;min-height:38px;border-radius:12px;border:1px solid rgba(212,175,55,.22);background:rgba(212,175,55,.1);color:#f3df9c;cursor:pointer;margin-top:8px}.save:disabled,.action:disabled{opacity:.55;cursor:not-allowed}.action,.copy{background:rgba(255,255,255,.035);border-color:rgba(220,235,250,.1);color:rgba(235,241,250,.7);text-align:left;padding:0 14px}.user{display:flex;align-items:center;gap:10px;padding:11px 0;border-bottom:1px solid rgba(255,255,255,.055)}.mini{width:34px;height:34px;border-radius:12px;display:grid;place-items:center;background:rgba(143,183,255,.08);color:#a9cef7}.userInfo{min-width:0;flex:1}.userInfo strong{display:block;font-size:13px}.userInfo small{display:block;color:rgba(255,255,255,.35);font-size:10px;margin-top:2px;overflow:hidden;text-overflow:ellipsis}.userMenu{display:flex;gap:5px}.userMenu button{border:0;background:none;color:#d4af37;font-size:10px}.roles{display:flex;gap:8px}.roles button{flex:1;text-align:left;padding:13px;border-radius:14px;border:1px solid rgba(220,235,250,.1);background:rgba(255,255,255,.025);color:white}.roles button.selected{border-color:rgba(212,175,55,.4);background:rgba(212,175,55,.08)}.roles b,.roles small{display:block}.roles small{color:rgba(255,255,255,.35);font-size:10px;margin-top:4px}.toast{position:fixed;bottom:25px;left:50%;transform:translateX(-50%);padding:10px 15px;border-radius:15px;background:#17253a;border:1px solid rgba(255,255,255,.1);color:#eee;font-size:12px;z-index:1000}.overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1001;display:flex;align-items:flex-end;justify-content:center;padding:14px}.sheet{width:100%;max-width:560px;border:1px solid rgba(220,235,250,.14);border-radius:28px 28px 20px 20px;background:#101c2d;padding:12px 20px 20px;box-shadow:0 -20px 80px rgba(0,0,0,.4)}.sheetHandle{width:38px;height:4px;border-radius:9px;background:rgba(255,255,255,.18);margin:2px auto 22px}.sheet h2{margin:8px 0 5px}.sheet p{color:rgba(255,255,255,.4);font-size:12px}.linkBox{padding:12px;border-radius:13px;background:rgba(255,255,255,.04);color:#a9cef7;font-size:11px;word-break:break-all;margin:14px 0}.good{color:#7fe0b1}.sub{color:rgba(255,255,255,.4);font-size:12px;margin-top:3px}h1{margin:2px 0 0;font-size:24px;font-weight:600}@media(max-width:600px){.wrap{padding-top:0}.card{border-radius:19px}.cardHead{padding:16px}.body{padding:0 16px}.card.open .body{padding:0 16px 16px}header{padding-left:2px}}
`}</style>
</div></Layout>
  }

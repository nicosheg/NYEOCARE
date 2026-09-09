// pages/review.js
import{useEffect,useState}from'react';
import{useRouter}from'next/router';
import{supabase}from'../lib/supabaseClient';

export default function ReviewPage(){
 const router=useRouter();
 const[items,setItems]=useState([]);
 const[loading,setLoading]=useState(true);
 const[active,setActive]=useState(null);
 const[busy,setBusy]=useState(false);
 const[error,setError]=useState('');
 const[editName,setEditName]=useState('');
 const[editPhone,setEditPhone]=useState('');

 async function load(){
  setLoading(true);setError('');
  try{
   const{data:{session}}=await supabase.auth.getSession();
   if(!session)throw new Error('You must be logged in.');
   const r=await fetch('/api/review',{headers:{Authorization:`Bearer ${session.access_token}`}});
   const d=await r.json();
   if(!r.ok)throw new Error(d.error||'Could not load Review Center.');
   setItems(d.items||[]);
  }catch(e){setError(e.message||'Review Center could not load.')}finally{setLoading(false)}
 }
 useEffect(()=>{load()},[]);
 function open(item){setActive(item);setEditName(item.name||'');setEditPhone(item.phone||'')}
 async function act(action){
  if(!active)return;
  setBusy(true);setError('');
  try{
   const{data:{session}}=await supabase.auth.getSession();
   const r=await fetch('/api/review/resolve',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({id:active.id,action,name:editName,phone:editPhone})});
   const d=await r.json();
   if(!r.ok)throw new Error(d.error||'Review action failed.');
   setActive(null);await load();
  }catch(e){setError(e.message||'Review action failed.')}finally{setBusy(false)}
 }
 return <main style={s.page}>
  <section style={s.shell}>
   <button style={s.back} onClick={()=>router.back()}>‹</button>
   <div style={s.eyebrow}>ARIA · REVIEW CENTER</div>
   <h1 style={s.title}>{items.length?`${items.length} need your attention.`:'Everything looks good.'}</h1>
   <p style={s.sub}>{items.length?'ARIA preserved the uncertain records and explains exactly what needs checking.':'There are no unresolved scan records waiting for you.'}</p>
   {loading&&<div style={s.empty}>Loading review center…</div>}
   {!loading&&!items.length&&!error&&<div style={s.empty}>Nothing is waiting for review.</div>}
   {error&&<div style={s.error}>{error}</div>}
   <div style={s.stack}>{items.map((item,i)=><button key={item.id} style={{...s.card,animation:`reviewIn .35s ease ${i*.035}s both`}} onClick={()=>open(item)}>
    <div style={s.avatar}>{(item.name||'?').charAt(0).toUpperCase()}</div>
    <div style={s.cardBody}><div style={s.cardTop}><strong>{item.name||'Unnamed person'}</strong><span style={s.dot}>●</span></div><div style={s.reason}>{item.reason}</div><div style={s.suggestion}>{item.suggestion}</div></div><span style={s.chevron}>›</span>
   </button>)}</div>
  </section>
  {active&&<div style={s.overlay} onMouseDown={e=>e.target===e.currentTarget&&!busy&&setActive(null)}>
   <div style={s.sheet}>
    <button style={s.x} onClick={()=>!busy&&setActive(null)}>×</button>
    <div style={s.eyebrow}>ARIA FOUND SOMETHING</div>
    <h2 style={s.sheetTitle}>{active.name||'Unnamed person'}</h2>
    <div style={s.detail}><span>Why ARIA paused</span><strong>{active.reason}</strong></div>
    <div style={s.detail}><span>ARIA suggests</span><strong>{active.suggestion}</strong></div>
    <div style={s.evidence}><div><span>Extracted name</span><b>{active.name||'—'}</b></div><div><span>Phone</span><b>{active.phone||'Not safely read'}</b></div><div><span>Extraction confidence</span><b>{active.confidence??'—'}%</b></div>{active.raw_name&&<div><span>Original writing</span><b>{active.raw_name}</b></div>}</div>
    <input value={editName} onChange={e=>setEditName(e.target.value)} placeholder="Name" style={s.input}/>
    <input value={editPhone} onChange={e=>setEditPhone(e.target.value)} placeholder="Phone number" style={s.input}/>
    <button disabled={busy} style={s.primary} onClick={()=>act('approve')}>Confirm & remember</button>
    <button disabled={busy} style={s.secondary} onClick={()=>act('edit')}>Save correction, keep in review</button>
    <button disabled={busy} style={s.dismiss} onClick={()=>act('dismiss')}>Dismiss</button>
   </div>
  </div>}
  <style jsx>{`@keyframes reviewIn{from{opacity:0;transform:translateY(-7px) scale(.99)}to{opacity:1;transform:none}}`}</style>
 </main>
}

const s={
page:{minHeight:'100vh',background:'#07101f',color:'#fff',padding:'28px 16px 60px',boxSizing:'border-box'},
shell:{width:'min(620px,100%)',margin:'0 auto'},
back:{border:0,background:'rgba(255,255,255,.06)',color:'#fff',width:38,height:38,borderRadius:'50%',fontSize:27,cursor:'pointer',marginBottom:26},
eyebrow:{fontSize:10,letterSpacing:2.4,color:'rgba(255,255,255,.35)',marginBottom:9},
title:{fontSize:'clamp(28px,7vw,42px)',letterSpacing:-1.4,lineHeight:1.05,margin:'0 0 12px'},
sub:{color:'rgba(255,255,255,.48)',lineHeight:1.55,fontSize:14,margin:'0 0 25px',maxWidth:500},
stack:{display:'grid',gap:8},
card:{width:'100%',display:'flex',alignItems:'center',gap:12,textAlign:'left',padding:'11px 12px',borderRadius:18,border:'1px solid rgba(255,255,255,.075)',background:'rgba(255,255,255,.045)',color:'#fff',cursor:'pointer',boxShadow:'0 8px 28px rgba(0,0,0,.12)'},
avatar:{width:37,height:37,borderRadius:'50%',display:'grid',placeItems:'center',flex:'0 0 auto',background:'rgba(255,255,255,.08)',fontSize:13,fontWeight:700},
cardBody:{minWidth:0,flex:1},
cardTop:{display:'flex',alignItems:'center',gap:7,fontSize:13},
dot:{fontSize:7,color:'#d4af37'},
reason:{fontSize:12,color:'rgba(255,255,255,.7)',marginTop:3,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'},
suggestion:{fontSize:10,color:'rgba(255,255,255,.32)',marginTop:2,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'},
chevron:{fontSize:21,color:'rgba(255,255,255,.3)'},
empty:{padding:'45px 10px',textAlign:'center',color:'rgba(255,255,255,.35)'},
error:{padding:14,borderRadius:15,background:'rgba(255,80,80,.08)',color:'#ffb0b0',fontSize:13,marginBottom:15},
overlay:{position:'fixed',inset:0,zIndex:100000,background:'rgba(1,5,14,.7)',backdropFilter:'blur(15px)',display:'grid',placeItems:'end center',padding:12},
sheet:{width:'min(620px,100%)',maxHeight:'88vh',overflowY:'auto',borderRadius:28,padding:'28px 20px 22px',boxSizing:'border-box',background:'linear-gradient(145deg,#101d3a,#071020)',border:'1px solid rgba(255,255,255,.1)',boxShadow:'0 -20px 80px rgba(0,0,0,.5)',position:'relative'},
x:{position:'absolute',right:13,top:13,width:34,height:34,borderRadius:'50%',border:0,background:'rgba(255,255,255,.07)',color:'#fff',fontSize:22,cursor:'pointer'},
sheetTitle:{fontSize:27,margin:'0 0 22px',letterSpacing:-.8},
detail:{display:'grid',gap:5,padding:'13px 0',borderBottom:'1px solid rgba(255,255,255,.07)'},
detail span:{fontSize:10,color:'rgba(255,255,255,.3)',textTransform:'uppercase',letterSpacing:1.2},
detail strong:{fontSize:13,lineHeight:1.45,fontWeight:500},
evidence:{display:'grid',gap:8,padding:'16px 0'},
evidence div:{display:'flex',justifyContent:'space-between',gap:15,fontSize:12},
evidence span:{color:'rgba(255,255,255,.32)'},
evidence b:{fontWeight:500,textAlign:'right'},
input:{width:'100%',boxSizing:'border-box',padding:'13px 14px',borderRadius:14,border:'1px solid rgba(255,255,255,.1)',background:'rgba(255,255,255,.045)',color:'#fff',marginTop:8,outline:'none'},
primary:{width:'100%',padding:14,border:0,borderRadius:999,background:'#f4f4f4',color:'#07101e',fontWeight:700,cursor:'pointer',marginTop:14},
secondary:{width:'100%',padding:12,borderRadius:999,border:'1px solid rgba(255,255,255,.1)',background:'rgba(255,255,255,.05)',color:'#fff',cursor:'pointer',marginTop:8},
dismiss:{width:'100%',padding:10,border:0,background:'transparent',color:'rgba(255,255,255,.35)',cursor:'pointer',marginTop:5}
}

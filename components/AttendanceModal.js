// components/AttendanceModal.js
import{useCallback,useEffect,useState}from'react';
import{createPortal}from'react-dom';
import{supabase}from'../lib/supabaseClient';

export default function AttendanceModal({isOpen,onClose}){
const[session,setSession]=useState(null),[people,setPeople]=useState([]),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[closing,setClosing]=useState(false),[error,setError]=useState(''),[query,setQuery]=useState(''),[sessionName,setSessionName]=useState('');
const auth=async()=>{const{data:{session}}=await supabase.auth.getSession();return session};

const load=useCallback(async(showLoading=true)=>{
if(showLoading)setLoading(true);
setError('');
try{
const s=await auth();
if(!s){setError('You must be logged in.');return}
const h={Authorization:`Bearer ${s.access_token}`};
const sr=await fetch('/api/attendance/active-session',{headers:h}),sd=await sr.json();
if(!sr.ok)throw Error(sd.error||'Could not load attendance session.');
if(!sd.active){setSession(null);setPeople([]);setQuery('');return}
setSession(sd);
const pr=await fetch(`/api/attendance/people?session_id=${encodeURIComponent(sd.session_id)}`,{headers:h}),pd=await pr.json();
if(!pr.ok)throw Error(pd.error||'Could not load attendance people.');
setPeople(Array.isArray(pd)?pd:[]);
}catch(e){console.error('[ATTENDANCE]',e);setError(e.message||'Could not load attendance.')}finally{if(showLoading)setLoading(false)}
},[]);

useEffect(()=>{if(isOpen)load()},[isOpen,load]);

useEffect(()=>{
if(!isOpen||!session?.session_id)return;
let timer=null;
const channel=supabase.channel(`attendance-live-${session.session_id}`).on('postgres_changes',{
event:'*',schema:'public',table:'attendance_records',filter:`session_id=eq.${session.session_id}`
},()=>{
clearTimeout(timer);
timer=setTimeout(()=>load(false),120);
}).subscribe(status=>{
if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')console.error('[ATTENDANCE] Realtime channel error:',status);
});
return()=>{clearTimeout(timer);supabase.removeChannel(channel)};
},[isOpen,session?.session_id,load]);

const createSession=async()=>{
const name=sessionName.trim();
if(!name){setError('Enter a name for this attendance session.');return}
setSaving(true);setError('');
try{
const s=await auth();
if(!s)throw Error('You must be logged in.');
const r=await fetch('/api/attendance/create-session',{
method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${s.access_token}`},body:JSON.stringify({name})
}),d=await r.json();
if(!r.ok||!d.success)throw Error(d.error||'Could not start attendance.');
setSessionName('');
await load();
}catch(e){console.error('[ATTENDANCE] Create error:',e);setError(e.message||'Could not start attendance.')}finally{setSaving(false)}
};

const mark=async(id,currentMarked)=>{
if(!session||closing)return;
const next=!currentMarked,previous=people;
setPeople(current=>current.map(p=>p.id===id?{...p,marked:next,marked_by_name:next?'You':null}:p));
setError('');
try{
const s=await auth();
if(!s)throw Error('You must be logged in.');
const r=await fetch('/api/attendance/mark',{
method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${s.access_token}`},
body:JSON.stringify({session_id:session.session_id,people_id:id,present:next})
}),d=await r.json();
if(!r.ok||!d.success)throw Error(d.error||'Could not update attendance.');
setPeople(current=>current.map(p=>p.id===id?{...p,marked:d.present===true,marked_by_name:d.present===true?(d.marked_by_name||'You'):null}:p));
}catch(e){console.error('[ATTENDANCE] Mark/unmark error:',e);setPeople(previous);setError(e.message||'Could not update attendance.')}
};

const keepSession=async()=>{
if(!session||closing)return;
setClosing(true);setError('');
try{
const s=await auth();
if(!s)throw Error('You must be logged in.');
const r=await fetch('/api/attendance/close-session',{
method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${s.access_token}`},body:JSON.stringify({session_id:session.session_id})
}),d=await r.json();
if(!r.ok||!d.success)throw Error(d.error||'Could not keep this session.');
setSession(null);setPeople([]);setQuery('');
}catch(e){console.error('[ATTENDANCE] Keep error:',e);setError(e.message||'Could not keep this session.')}finally{setClosing(false)}
};

const leaveSession=async()=>{
if(!session||closing)return;
if(!window.confirm('Leave this attendance session?\n\nThis will permanently discard this live session and all of its attendance marks. This cannot be undone.'))return;
setClosing(true);setError('');
try{
const s=await auth();
if(!s)throw Error('You must be logged in.');
const r=await fetch('/api/attendance/leave-session',{
method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${s.access_token}`},body:JSON.stringify({session_id:session.session_id})
}),d=await r.json();
if(!r.ok||!d.success)throw Error(d.error||'Could not leave this session.');
setSession(null);setPeople([]);setQuery('');
}catch(e){console.error('[ATTENDANCE] Leave error:',e);setError(e.message||'Could not leave this session.')}finally{setClosing(false)}
};

useEffect(()=>{
if(!isOpen)return;
const esc=e=>{if(e.key==='Escape')onClose()};
document.addEventListener('keydown',esc);
return()=>document.removeEventListener('keydown',esc);
},[isOpen,onClose]);

if(!isOpen||typeof document==='undefined')return null;

const visible=people.filter(p=>`${p.first_name||''} ${p.last_name||''} ${p.phone||''}`.toLowerCase().includes(query.toLowerCase().trim()));
const present=people.filter(p=>p.marked).length,percentage=people.length?Math.round(present/people.length*100):0;

const content=<div style={overlay} onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
<div style={modal} role="dialog" aria-modal="true" aria-label="Live attendance">
<header style={header}>
<div><div style={eyebrow}>{session?'LIVE ATTENDANCE':'ATTENDANCE'}</div><h2 style={h2}>{session?.name||'New attendance session'}</h2><p style={sub}>{session?'Tap a person when you see them.':'Create a session to begin taking attendance.'}</p></div>
<button style={close} onClick={onClose} aria-label="Close attendance">×</button>
</header>
{error&&<div style={errorBox}><span>{error}</span><button style={retry} onClick={()=>load()}>Try again</button></div>}
{loading?<div style={loadingBox}>Preparing attendance...</div>:!session?<div style={createBox}>
<div style={plus}>＋</div><strong style={{fontSize:20}}>Start a new session</strong>
<span style={sub}>Give this attendance session a simple name, such as Sunday Service or Youth Meeting.</span>
<input style={input} value={sessionName} onChange={e=>setSessionName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')createSession()}} placeholder="Session name" maxLength={120} autoFocus/>
<button style={{...primary,opacity:saving||!sessionName.trim()?.5:1}} disabled={saving||!sessionName.trim()} onClick={createSession}>{saving?'Starting...':'Start attendance'}</button>
</div>:<>
<div style={stats}>
<div><strong style={big}>{present}</strong><span style={label}>present</span></div><div style={divider}/>
<div><strong style={stat}>{people.length}</strong><span style={label}>people</span></div>
<div><strong style={stat}>{percentage}%</strong><span style={label}>marked</span></div>
<div style={progress}><div style={{height:'100%',width:`${percentage}%`,background:'#fff',borderRadius:99}}/></div>
</div>
<div style={toolbar}><input style={search} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search people..."/>{query&&<button style={clear} onClick={()=>setQuery('')} aria-label="Clear search">×</button>}</div>
<div style={peopleBox}>{visible.length===0?<div style={empty}><strong>No people found</strong><span>{query?'Try another name or phone number.':'No active people are available yet.'}</span></div>:visible.map(p=><div style={{...personRow,...(p.marked?markedRow:{})}} key={p.id}>
<div style={personInfo}><div style={{...avatar,...(p.marked?presentAvatar:{})}}>{(p.first_name||'?').charAt(0).toUpperCase()}</div><div><strong>{p.first_name} {p.last_name||''}</strong><small style={small}>{p.marked?`Present${p.marked_by_name?` · ${p.marked_by_name}`:''}`:(p.phone||'No phone')}</small></div></div>
<button style={{...markButton,...(p.marked?doneButton:{})}} disabled={closing} onClick={()=>mark(p.id,!!p.marked)}>{p.marked?'✓ Unmark':'Mark present'}</button>
</div>)}</div>
<footer style={footer}><div style={live}><i/>Live attendance</div><div style={footerActions}><button style={leave} disabled={closing} onClick={leaveSession}>Leave</button><button style={keep} disabled={closing} onClick={keepSession}>{closing?'Saving...':'Keep session'}</button></div></footer>
</>}
</div></div>;

return createPortal(content,document.body);
}

const overlay={position:'fixed',inset:0,zIndex:2147483000,background:'rgba(2,5,12,.68)',backdropFilter:'blur(18px)',display:'flex',alignItems:'center',justifyContent:'center',padding:16,overflow:'auto'};
const modal={width:'min(960px,96vw)',height:'min(78vh,760px)',minHeight:500,background:'linear-gradient(145deg,rgba(43,60,83,.96),rgba(10,18,33,.98))',border:'1px solid rgba(235,244,255,.2)',borderRadius:30,overflow:'hidden',display:'flex',flexDirection:'column',color:'#f5f7fb',boxShadow:'0 35px 110px rgba(0,0,0,.7)'};
const header={display:'flex',justifyContent:'space-between',gap:20,padding:'25px 28px 20px',borderBottom:'1px solid rgba(255,255,255,.09)',flexShrink:0};
const eyebrow={fontSize:10,fontWeight:700,letterSpacing:2.4,color:'rgba(255,255,255,.43)',marginBottom:7},h2={margin:0,fontSize:'clamp(26px,3vw,38px)',lineHeight:1.05},sub={margin:'7px 0 0',color:'rgba(255,255,255,.5)',fontSize:14,lineHeight:1.5},close={width:42,height:42,borderRadius:'50%',border:'1px solid rgba(255,255,255,.13)',background:'rgba(255,255,255,.08)',color:'#fff',fontSize:27,cursor:'pointer'},errorBox={margin:'12px 26px 0',padding:'10px 13px',borderRadius:13,background:'rgba(239,68,68,.1)',border:'1px solid rgba(239,68,68,.2)',color:'#ffb0b0',display:'flex',justifyContent:'space-between',gap:10},retry={background:'none',border:0,color:'#fff',cursor:'pointer'},loadingBox={flex:1,display:'grid',placeItems:'center',color:'rgba(255,255,255,.5)'},createBox={flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:14,padding:30,textAlign:'center'},plus={width:58,height:58,borderRadius:'50%',display:'grid',placeItems:'center',background:'rgba(255,255,255,.08)',fontSize:28},input={width:'min(440px,100%)',padding:'14px 16px',borderRadius:14,border:'1px solid rgba(255,255,255,.12)',background:'rgba(0,0,0,.2)',color:'#fff',outline:0,fontSize:16},primary={padding:'13px 22px',border:0,borderRadius:999,background:'#fff',color:'#08101e',fontWeight:700,cursor:'pointer'},stats={display:'flex',alignItems:'center',gap:20,padding:'18px 28px',borderBottom:'1px solid rgba(255,255,255,.07)',flexShrink:0},big={fontSize:34},stat={fontSize:24},label={display:'block',fontSize:11,color:'rgba(255,255,255,.42)'},divider={width:1,height:35,background:'rgba(255,255,255,.1)'},progress={flex:1,height:5,background:'rgba(255,255,255,.1)',borderRadius:99,overflow:'hidden'},toolbar={padding:'12px 26px',flexShrink:0},search={width:'100%',padding:'13px 16px',borderRadius:14,border:'1px solid rgba(255,255,255,.1)',background:'rgba(0,0,0,.16)',color:'#fff',outline:0,fontSize:15},clear={position:'absolute',right:40,marginTop:10,border:0,background:'none',color:'#fff',fontSize:22},peopleBox={flex:1,overflow:'auto',padding:'0 26px'},empty={minHeight:180,display:'grid',placeItems:'center',alignContent:'center',gap:6,color:'rgba(255,255,255,.5)'},personRow={display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,padding:'11px 0',borderBottom:'1px solid rgba(255,255,255,.055)'},markedRow={background:'rgba(255,255,255,.018)'},personInfo={display:'flex',alignItems:'center',gap:12,minWidth:0},avatar={width:42,height:42,borderRadius:'50%',background:'rgba(255,255,255,.08)',display:'grid',placeItems:'center',flexShrink:0,fontWeight:700},presentAvatar={background:'rgba(255,255,255,.15)'},small={display:'block',marginTop:3,color:'rgba(255,255,255,.45)',fontSize:12},markButton={padding:'9px 13px',borderRadius:999,border:'1px solid rgba(255,255,255,.12)',background:'rgba(255,255,255,.05)',color:'#fff',cursor:'pointer',whiteSpace:'nowrap'},doneButton={background:'rgba(255,255,255,.12)'},footer={display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,padding:'16px 26px',borderTop:'1px solid rgba(255,255,255,.08)',flexShrink:0},live={fontSize:13,color:'rgba(255,255,255,.55)',display:'flex',alignItems:'center',gap:8},leave={padding:'10px 15px',borderRadius:999,border:'1px solid rgba(255,255,255,.12)',background:'transparent',color:'#fff',cursor:'pointer'},keep={padding:'10px 17px',border:0,borderRadius:999,background:'#fff',color:'#08101e',fontWeight:700,cursor:'pointer'},footerActions={display:'flex',gap:8};

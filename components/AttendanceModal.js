// components/AttendanceModal.js
import{useCallback,useEffect,useRef,useState}from'react';
import{createPortal}from'react-dom';
import{getClientSession}from'../lib/clientSession';import{publishDataChange}from'../lib/appData';

export default function AttendanceModal({isOpen,onClose}){
const[session,setSession]=useState(null),[canDiscard,setCanDiscard]=useState(false),[people,setPeople]=useState([]),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[closing,setClosing]=useState(false),[error,setError]=useState(''),[query,setQuery]=useState(''),[sessionName,setSessionName]=useState('');const mounted=useRef(false),loadSeq=useRef(0);
const auth=async()=>getClientSession();
useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
const finishClose=()=>{if(!mounted.current)return;setSession(null);setPeople([]);setQuery('');onClose()};

const load=useCallback(async(showLoading=true)=>{const seq=++loadSeq.current;if(showLoading&&mounted.current)setLoading(true);if(mounted.current)setError('');try{const s=await auth();if(!s)throw Error('You must be logged in.');const h={Authorization:'Bearer '+s.access_token};const sr=await fetch('/api/attendance/active-session',{headers:h,cache:'no-store'}),sd=await readJson(sr);if(!sr.ok)throw Error(sd.error||'Could not load attendance session.');if(!sd.active&&!sd.recoverable){if(seq===loadSeq.current&&mounted.current){setSession(null);setCanDiscard(false);setPeople([]);setQuery('')}return}const ns=normalizeSession(sd);if(!ns)throw Error('Attendance session response was incomplete.');if(ns.status==='closed'){if(seq===loadSeq.current&&mounted.current){setSession(null);setCanDiscard(false);setPeople([]);setQuery('');setError(ns.processing_status==='failed'?'ARIA could not finish the previous attendance. You can start a new session.':'Attendance processing is still finishing. You can start a new session.')}return}const pr=await fetch('/api/attendance/people?session_id='+encodeURIComponent(ns.session_id),{headers:h,cache:'no-store'}),pd=await readJson(pr);if(!pr.ok)throw Error(pd.error||'Could not load attendance people.');if(seq!==loadSeq.current||!mounted.current)return;setSession(ns);setCanDiscard(ns.can_discard===true);setPeople(normalizePeople(pd));}catch(e){console.error('[ATTENDANCE]',e);if(seq===loadSeq.current&&mounted.current)setError(String(e?.message||'Could not load attendance.'))}finally{if(seq===loadSeq.current&&showLoading&&mounted.current)setLoading(false)}},[]);
useEffect(()=>{if(isOpen)load()},[isOpen,load]);

useEffect(()=>{if(!isOpen||session?.status!=='active')return;const onFocus=()=>load(false);window.addEventListener('focus',onFocus);return()=>window.removeEventListener('focus',onFocus)},[isOpen,session?.status,load]);

const createSession=async()=>{
const name=sessionName.trim();
if(!name){setError('Enter a name for this attendance session.');return}
setSaving(true);setError('');
try{
const s=await auth();
if(!s)throw Error('You must be logged in.');
const r=await fetch('/api/attendance/create-session',{
method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${s.access_token}`},body:JSON.stringify({name})
}),d=await readJson(r);
if(!r.ok||!d.success)throw Error(d.error||'Could not start attendance.');
setSessionName('');
await load();
}catch(e){console.error('[ATTENDANCE] Create error:',e);setError(e.message||'Could not start attendance.')}finally{setSaving(false)}
};

const mark=async(id,currentMarked)=>{
if(!session||session.status!=='active'||closing)return;
const next=!currentMarked,previous=people;
setPeople(current=>current.map(p=>p.id===id?{...p,marked:next,marked_by_name:next?'You':null}:p));
setError('');
try{
const s=await auth();
if(!s)throw Error('You must be logged in.');
const r=await fetch('/api/attendance/mark',{
method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${s.access_token}`},
body:JSON.stringify({session_id:session.session_id,people_id:id,present:next})
}),d=await readJson(r);
if(!r.ok||!d.success)throw Error(d.error||'Could not update attendance.');
setPeople(current=>current.map(p=>p.id===id?{...p,marked:d.present===true,marked_by_name:d.present===true?(d.marked_by_name||'You'):null}:p));

}catch(e){console.error('[ATTENDANCE] Mark/unmark error:',e);setPeople(previous);setError(e.message||'Could not update attendance.')}
};

const retryAriaProcessing=async()=>{
if(!session?.session_id||closing)return;
setClosing(true);setError('');
try{
const s=await auth();
if(!s)throw Error('You must be logged in.');
const r=await fetch('/api/attendance/process-session',{
method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${s.access_token}`},
body:JSON.stringify({session_id:session.session_id})
}),d=await readJson(r);
if(!r.ok||!d.success)throw Error(d.error||'Unable to finish ARIA processing.');
if(d.processing_failed){if(mounted.current){setSession(prev=>prev?{...prev,processing_status:'failed',processing_error:null}:prev);setError(d.error||'Unable to finish ARIA processing.')}return}
publishDataChange('attendance');finishClose();
}catch(e){console.error('[ATTENDANCE] ARIA retry error:',e);setError(e.message||'Unable to finish ARIA processing.')}finally{if(mounted.current)setClosing(false)}
};

const keepSession=async()=>{
if(!session||session.status!=='active'||closing)return;
setClosing(true);setError('');
try{
const s=await auth();
if(!s)throw Error('You must be logged in.');
const r=await fetch('/api/attendance/close-session',{
method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${s.access_token}`},body:JSON.stringify({session_id:session.session_id})
}),d=await readJson(r);
if(d.processing_failed){if(mounted.current){if(d.session)setSession(prev=>prev?{...prev,...d.session,status:d.session.status||'closed',processing_status:d.session.aria_processing_status||'failed',processing_error:null}:prev);setError(d.error||'ARIA could not finish processing this attendance yet.')}return}
if(!r.ok||!d.success){
if(d.session)setSession(prev=>prev?{...prev,...d.session,status:d.session.status||'closed',closed_at:d.session.closed_at||null,processing_status:d.session.aria_processing_status||'failed',processing_error:d.session.aria_processing_error||null}:prev);
throw Error(d.error||'Could not keep this session.');
}
setSession(null);setPeople([]);setQuery('');publishDataChange('attendance');onClose();
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
}),d=await readJson(r);
if(!r.ok||!d.success)throw Error(d.error||'Could not leave this session.');
loadSeq.current++;
setSession(null);setPeople([]);setQuery('');setError('');
}catch(e){console.error('[ATTENDANCE] Leave error:',e);setError(e.message||'Could not leave this session.')}finally{setClosing(false)}
};

useEffect(()=>{
if(!isOpen)return;
const esc=e=>{if(e.key==='Escape')onClose()};
document.addEventListener('keydown',esc);
return()=>document.removeEventListener('keydown',esc);
},[isOpen,onClose]);

if(!isOpen||typeof document==='undefined')return null;

const q=String(query||'').toLowerCase().trim(),visible=people.filter(p=>[p.first_name,p.last_name,p.phone].filter(Boolean).join(' ').toLowerCase().includes(q));
const present=people.filter(p=>p.marked).length,percentage=people.length?Math.round(present/people.length*100):0;
const ariaProcessingFailed=Boolean(session?.status==='closed'&&session?.processing_status==='failed');

const content=<div style={overlay} onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
<div style={modal} role="dialog" aria-modal="true" aria-label="Live attendance">
<header style={header}>
<div><div style={eyebrow}>{session?'LIVE ATTENDANCE':'ATTENDANCE'}</div><h2 style={h2}>{session?.name||'New attendance session'}</h2><p style={sub}>{session?(session.status==='closed'?'Attendance saved. ARIA still needs to finish processing.':'Tap a person when you see them.'):'Create a session to begin taking attendance.'}</p></div>
<button style={close} onClick={onClose} aria-label="Close attendance">×</button>
</header>
{error&&<div style={errorBox}><span>{error}</span>{ariaProcessingFailed?<button style={retry} disabled={closing} onClick={retryAriaProcessing}>{closing?'Retrying...':'Retry processing'}</button>:<button style={retry} onClick={()=>load()}>Try again</button>}</div>}
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
<div style={personInfo}><div style={{...avatar,...(p.marked?presentAvatar:{})}}>{(p.first_name||'?').charAt(0).toUpperCase()}</div><div><strong>{p.first_name} {p.last_name||''}</strong>{p.marked&&<small style={small}>{`Present${p.marked_by_name?` · ${p.marked_by_name}`:''}`}</small>}</div></div>
<div style={rowActions}><button style={{...markButton,...(p.marked?doneButton:{})}} disabled={closing||session.status!=='active'} onClick={()=>mark(p.id,!!p.marked)}>{p.marked?'✓ Unmark':'Mark present'}</button></div>
</div>)}</div>
<footer style={footer}><div style={live}><i/>Live attendance</div><div style={footerActions}>{canDiscard&&session.status==='active'&&<button style={leave} disabled={closing} onClick={leaveSession}>Discard</button>}{session.status==='active'?<button style={keep} disabled={closing} onClick={keepSession}>{closing?'Saving...':'Keep session'}</button>:<button style={keep} disabled={closing} onClick={retryAriaProcessing}>{closing?'Processing...':'Retry ARIA'}</button>}</div></footer>
</>}
</div></div>;

return createPortal(content,document.body);
}

const readJson=async r=>{const raw=await r.text();if(!raw)return{};try{return JSON.parse(raw)}catch{return{error:'Request failed ('+r.status+')'}}};
const normalizeSession=d=>{const status=['active','closed'].includes(String(d?.status||''))?String(d.status):null;if(!d?.session_id||!status)return null;const processing_status=['pending','processing','completed','failed'].includes(String(d?.processing_status||d?.aria_processing_status||''))?String(d.processing_status||d.aria_processing_status):'pending';return{...d,session_id:String(d.session_id),name:String(d.name||'Attendance session'),status,processing_status,processing_error:d.processing_error?String(d.processing_error):null,can_discard:d.can_discard===true}};
const normalizePeople=data=>Array.isArray(data)?data.filter(Boolean).map(p=>({id:String(p.id||''),first_name:String(p.first_name??p.display_name??'').trim()||'Unknown',last_name:String(p.last_name??'').trim(),phone:String(p.phone??'').trim(),marked:p.marked===true||p.marked==='true'||p.marked===1,marked_by_name:p.marked_by_name?String(p.marked_by_name).trim():null})).filter(p=>p.id):[];

const overlay={position:'fixed',inset:0,zIndex:2147483000,background:'rgba(2,5,12,.68)',backdropFilter:'blur(18px)',display:'flex',alignItems:'center',justifyContent:'center',padding:12,overflow:'auto'};
const modal={width:'min(1120px,94vw)',height:'min(86vh,820px)',minHeight:480,background:'linear-gradient(145deg,rgba(43,60,83,.96),rgba(10,18,33,.98))',border:'1px solid rgba(235,244,255,.2)',borderRadius:30,overflow:'hidden',display:'flex',flexDirection:'column',color:'#f5f7fb',boxShadow:'0 35px 110px rgba(0,0,0,.7)'};
const header={display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:14,padding:'18px 22px 14px',borderBottom:'1px solid rgba(255,255,255,.08)',flexShrink:0};
const eyebrow={fontSize:9,fontWeight:700,letterSpacing:2.2,color:'rgba(255,255,255,.4)',marginBottom:5},h2={margin:0,fontSize:'clamp(24px,3vw,34px)',lineHeight:1.02},sub={margin:'5px 0 0',color:'rgba(255,255,255,.46)',fontSize:12,lineHeight:1.4},close={width:38,height:38,borderRadius:'50%',border:'1px solid rgba(255,255,255,.13)',background:'rgba(255,255,255,.08)',color:'#fff',fontSize:25,cursor:'pointer',flexShrink:0},errorBox={margin:'8px 18px 0',padding:'9px 12px',borderRadius:12,background:'rgba(239,68,68,.1)',border:'1px solid rgba(239,68,68,.2)',color:'#ffb0b0',display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,fontSize:13},retry={background:'none',border:0,color:'#fff',cursor:'pointer',fontWeight:700,whiteSpace:'nowrap'},loadingBox={flex:1,display:'grid',placeItems:'center',color:'rgba(255,255,255,.5)'},createBox={flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:14,padding:30,textAlign:'center'},plus={width:52,height:52,borderRadius:'50%',display:'grid',placeItems:'center',background:'rgba(255,255,255,.08)',fontSize:26},input={width:'min(440px,100%)',padding:'13px 15px',borderRadius:13,border:'1px solid rgba(255,255,255,.12)',background:'rgba(0,0,0,.2)',color:'#fff',outline:0,fontSize:15},primary={padding:'12px 20px',border:0,borderRadius:999,background:'#fff',color:'#08101e',fontWeight:700,cursor:'pointer'},stats={display:'flex',alignItems:'center',gap:14,padding:'12px 20px',borderBottom:'1px solid rgba(255,255,255,.06)',flexShrink:0},big={fontSize:28},stat={fontSize:20},label={display:'block',fontSize:10,color:'rgba(255,255,255,.4)'},divider={width:1,height:29,background:'rgba(255,255,255,.1)'},progress={flex:1,height:4,background:'rgba(255,255,255,.1)',borderRadius:99,overflow:'hidden'},toolbar={padding:'8px 18px',flexShrink:0},search={width:'100%',padding:'10px 14px',borderRadius:12,border:'1px solid rgba(255,255,255,.1)',background:'rgba(0,0,0,.16)',color:'#fff',outline:0,fontSize:14},clear={position:'absolute',right:31,marginTop:7,border:0,background:'none',color:'#fff',fontSize:20},peopleBox={flex:1,overflow:'auto',padding:'0 18px'},empty={minHeight:160,display:'grid',placeItems:'center',alignContent:'center',gap:6,color:'rgba(255,255,255,.5)'},personRow={display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,padding:'7px 0',borderBottom:'1px solid rgba(255,255,255,.05)',transition:'background .16s ease,box-shadow .16s ease'},markedRow={background:'rgba(74,222,128,.025)',boxShadow:'inset 0 0 18px rgba(74,222,128,.055),0 0 12px rgba(74,222,128,.035)'},personInfo={display:'flex',alignItems:'center',gap:10,minWidth:0},avatar={width:36,height:36,borderRadius:'50%',background:'rgba(255,255,255,.08)',display:'grid',placeItems:'center',flexShrink:0,fontWeight:700,fontSize:14},presentAvatar={background:'rgba(74,222,128,.12)',boxShadow:'inset 0 0 10px rgba(74,222,128,.08)'},small={display:'block',marginTop:1,color:'rgba(134,239,172,.58)',fontSize:10},markButton={padding:'7px 11px',borderRadius:999,border:'1px solid rgba(255,255,255,.11)',background:'rgba(255,255,255,.045)',color:'#fff',cursor:'pointer',whiteSpace:'nowrap',fontSize:13},doneButton={background:'rgba(74,222,128,.09)',borderColor:'rgba(74,222,128,.2)'},footer={display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,padding:'10px 18px',borderTop:'1px solid rgba(255,255,255,.07)',flexShrink:0},rowActions={display:'flex',alignItems:'center',justifyContent:'flex-end',gap:8,flexShrink:0},live={fontSize:12,color:'rgba(255,255,255,.45)',display:'flex',alignItems:'center',gap:7},leave={padding:'8px 14px',borderRadius:999,border:'1px solid rgba(255,255,255,.12)',background:'transparent',color:'#fff',cursor:'pointer',fontSize:13},keep={padding:'9px 16px',border:0,borderRadius:999,background:'#fff',color:'#08101e',fontWeight:700,cursor:'pointer',fontSize:13},footerActions={display:'flex',gap:8};

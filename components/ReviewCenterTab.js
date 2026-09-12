// components/ReviewCenterTab.js
import{useState,useEffect}from'react';
import{supabase}from'../lib/supabaseClient';

export default function ReviewCenterTab({modal=false,onClose}){
const[items,setItems]=useState([]),[loading,setLoading]=useState(true),[active,setActive]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[editName,setEditName]=useState(''),[editPhones,setEditPhones]=useState(['','']);
async function load(){setLoading(true);setError('');try{const{data:{session}}=await supabase.auth.getSession();if(!session)throw Error('You must be logged in.');const r=await fetch('/api/review',{headers:{Authorization:`Bearer ${session.access_token}`}}),d=await r.json();if(!r.ok)throw Error(d.error||'Could not load Review Center.');setItems(d.items||[])}catch(e){setError(e.message||'Review Center could not load.')}finally{setLoading(false)}}
useEffect(()=>{load()},[]);
function open(item){setActive(item);setEditName(item.name||'');const phones=Array.isArray(item.phones)?item.phones.map(x=>typeof x==='string'?x:x?.normalized||x?.raw||''):item.phone?[item.phone]:[];setEditPhones([phones[0]||'',phones[1]||''])}
function phoneText(item){const phones=Array.isArray(item.phones)?item.phones.map(x=>typeof x==='string'?x:x?.normalized||x?.raw).filter(Boolean):[];return phones.join(' · ')||item.phone||'No phone safely read'}
async function act(action){if(!active||busy)return;setBusy(true);setError('');try{const{data:{session}}=await supabase.auth.getSession();if(!session)throw Error('You must be logged in.');const r=await fetch('/api/review/resolve',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({id:active.id,action,name:editName,phones:editPhones.filter(Boolean)})}),d=await r.json();if(!r.ok)throw Error(d.error||'Review action failed.');setActive(null);await load()}catch(e){setError(e.message||'Review action failed.')}finally{setBusy(false)}}
const body=<div style={wrap}><div style={top}><div><div style={eyebrow}>ARIA · REVIEW CENTER</div><h1 style={title}>{items.length?`${items.length} need your attention.`:'Everything looks good.'}</h1><p style={sub}>{items.length?'ARIA paused these records because it wants you to decide what is true.':'There are no unresolved scan records waiting for you.'}</p></div>{modal&&<button style={close} onClick={()=>!busy&&onClose?.()}>×</button>}</div>{loading&&<div style={empty}>Loading review center…</div>}{!loading&&!items.length&&!error&&<div style={empty}>Nothing is waiting for review.</div>}{error&&<div style={errorBox}>{error}</div>}<div style={stack}>{items.map((item,i)=><button key={item.id} style={{...card,animation:`reviewIn .35s ease ${i*.035}s both`}} onClick={()=>open(item)}><div style={avatar}>{(item.name||'?').charAt(0).toUpperCase()}</div><div style={cardBody}><div style={cardTop}><strong>{item.name||'Unnamed person'}</strong><span style={dot}>●</span></div><div style={phone}>{phoneText(item)}</div><div style={reason}>{item.reason}</div></div><span style={chevron}>›</span></button>)}</div></div>;
if(!modal)return body;
return <div style={modalBox}><div style={modalCard}>{body}</div>{active&&<div style={overlay} onMouseDown={e=>e.target===e.currentTarget&&!busy&&setActive(null)}><div style={sheet}><button style={x} onClick={()=>!busy&&setActive(null)}>×</button><div style={eyebrow}>ARIA NEEDS YOU</div><h2 style={sheetTitle}>{active.name||'Unnamed person'}</h2><div style={detail}><span style={detailLabel}>Why ARIA paused</span><strong style={detailValue}>{active.reason}</strong></div><div style={detail}><span style={detailLabel}>What to check</span><strong style={detailValue}>{active.suggestion}</strong></div><div style={evidence}><div style={evidenceRow}><span style={evidenceLabel}>Name ARIA read</span><b style={evidenceValue}>{active.name||'—'}</b></div><div style={evidenceRow}><span style={evidenceLabel}>Phone ARIA read</span><b style={evidenceValue}>{phoneText(active)}</b></div>{active.raw_name&&<div style={evidenceRow}><span style={evidenceLabel}>Original writing</span><b style={evidenceValue}>{active.raw_name}</b></div>}</div><input value={editName} onChange={e=>setEditName(e.target.value)} placeholder="Name" style={input}/><input value={editPhones[0]} onChange={e=>setEditPhones(v=>[e.target.value,v[1]])} placeholder="Phone number" style={input}/><input value={editPhones[1]} onChange={e=>setEditPhones(v=>[v[0],e.target.value])} placeholder="Second phone number (optional)" style={input}/><button disabled={busy} style={primary} onClick={()=>act('approve')}>{busy?'Remembering…':'Accept & remember'}</button><button disabled={busy} style={secondary} onClick={()=>act('edit')}>Edit & remember</button><button disabled={busy} style={deleteButton} onClick={()=>act('delete')}>Delete</button></div></div></div>}
}
const wrap={maxWidth:900,margin:'0 auto',padding:'26px 20px 60px',color:'#eef4ff'};
const top={display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:20};
const eyebrow={fontSize:10,letterSpacing:2.4,textTransform:'uppercase',color:'rgba(255,255,255,.35)',marginBottom:9};
const title={fontSize:'clamp(28px,7vw,42px)',letterSpacing:-1.4,lineHeight:1.05,margin:'0 0 12px'};
const sub={color:'rgba(255,255,255,.48)',lineHeight:1.55,fontSize:14,margin:'0 0 25px',maxWidth:500};
const stack={display:'grid',gap:8};
const card={width:'100%',display:'flex',alignItems:'center',gap:12,textAlign:'left',padding:'11px 12px',borderRadius:18,border:'1px solid rgba(255,255,255,.075)',background:'rgba(255,255,255,.045)',color:'#fff',cursor:'pointer',boxShadow:'0 8px 28px rgba(0,0,0,.12)'};
const avatar={width:37,height:37,borderRadius:'50%',display:'grid',placeItems:'center',flex:'0 0 auto',background:'rgba(255,255,255,.08)',fontSize:13,fontWeight:700};
const cardBody={minWidth:0,flex:1};
const cardTop={display:'flex',alignItems:'center',gap:7,fontSize:13};
const dot={fontSize:7,color:'#d4af37'};
const phone={fontSize:12,color:'rgba(255,255,255,.58)',marginTop:3,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'};
const reason={fontSize:11,color:'rgba(255,255,255,.35)',marginTop:3,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'};
const chevron={fontSize:21,color:'rgba(255,255,255,.3)'};
const empty={padding:'45px 10px',textAlign:'center',color:'rgba(255,255,255,.35)'};
const errorBox={padding:14,borderRadius:15,background:'rgba(255,80,80,.08)',color:'#ffb0b0',fontSize:13,marginBottom:15};
const modalBox={position:'fixed',inset:0,zIndex:3000,background:'rgba(2,5,12,.8)',backdropFilter:'blur(20px)',padding:12};
const modalCard={height:'100%',maxWidth:960,margin:'0 auto',overflow:'auto',borderRadius:30,background:'#0a1128',border:'1px solid rgba(255,255,255,.1)'};
const overlay={position:'fixed',inset:0,zIndex:3100,background:'rgba(1,5,14,.7)',backdropFilter:'blur(15px)',display:'grid',placeItems:'end center',padding:12};
const sheet={width:'min(620px,100%)',maxHeight:'88vh',overflowY:'auto',borderRadius:28,padding:'28px 20px 22px',boxSizing:'border-box',background:'linear-gradient(145deg,#101d3a,#071020)',border:'1px solid rgba(255,255,255,.1)',boxShadow:'0 -20px 80px rgba(0,0,0,.5)',position:'relative'};
const x={position:'absolute',right:13,top:13,width:34,height:34,borderRadius:'50%',border:0,background:'rgba(255,255,255,.07)',color:'#fff',fontSize:22,cursor:'pointer'};
const sheetTitle={fontSize:27,margin:'0 0 22px',letterSpacing:-.8};
const detail={display:'grid',gap:5,padding:'13px 0',borderBottom:'1px solid rgba(255,255,255,.07)'};
const detailLabel={fontSize:10,color:'rgba(255,255,255,.3)',textTransform:'uppercase',letterSpacing:1.2};
const detailValue={fontSize:13,lineHeight:1.45,fontWeight:500};
const evidence={display:'grid',gap:8,padding:'16px 0'};
const evidenceRow={display:'flex',justifyContent:'space-between',gap:15,fontSize:12};
const evidenceLabel={color:'rgba(255,255,255,.32)'};
const evidenceValue={fontWeight:500,textAlign:'right',wordBreak:'break-word'};
const input={width:'100%',boxSizing:'border-box',padding:'13px 14px',borderRadius:14,border:'1px solid rgba(255,255,255,.1)',background:'rgba(255,255,255,.045)',color:'#fff',marginTop:8,outline:'none'};
const primary={width:'100%',padding:14,border:0,borderRadius:999,background:'#f4f4f4',color:'#07101e',fontWeight:700,cursor:'pointer',marginTop:14};
const secondary={width:'100%',padding:12,borderRadius:999,border:'1px solid rgba(255,255,255,.1)',background:'rgba(255,255,255,.05)',color:'#fff',cursor:'pointer',marginTop:8};
const deleteButton={width:'100%',padding:10,border:0,background:'transparent',color:'rgba(255,255,255,.35)',cursor:'pointer',marginTop:7};

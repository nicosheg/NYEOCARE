// components/ReviewCenterTab.js
import{useState,useEffect}from'react';
import{supabase}from'../lib/supabaseClient';

export default function ReviewCenterTab({modal=false,onClose}){
const[reviews,setReviews]=useState([]),[stats,setStats]=useState({}),[loading,setLoading]=useState(true),[message,setMessage]=useState(''),[drafts,setDrafts]=useState({}),[evidence,setEvidence]=useState(null);

const fetchReviews=async()=>{
setLoading(true);
try{
const{data:{session}}=await supabase.auth.getSession();
if(!session){setLoading(false);return}
const r=await fetch('/api/identity/review-items',{headers:{Authorization:`Bearer ${session.access_token}`}}),d=await r.json();
if(!r.ok)throw Error(d.error||'Unable to load reviews.');
setReviews(d.items||[]);setStats(d.stats||{});
setDrafts(Object.fromEntries((d.items||[]).map(x=>[x.id,{name:x.extracted_name||'',phone:x.extracted_phone||''}])));
}catch(e){setMessage(e.message||'Unable to load reviews.')}finally{setLoading(false)}
};

useEffect(()=>{fetchReviews()},[]);

const updateDraft=(id,key,value)=>setDrafts(prev=>({...prev,[id]:{...(prev[id]||{}),[key]:value}}));

const showEvidence=async item=>{
try{
const{data:{session}}=await supabase.auth.getSession();
if(!session)throw Error('You must be logged in.');
const r=await fetch(item.evidence_url,{headers:{Authorization:`Bearer ${session.access_token}`}});
if(!r.ok)throw Error('The original register could not be loaded.');
const blob=await r.blob();
const url=URL.createObjectURL(blob);
setEvidence({url,name:item.extracted_name});
}catch(e){setMessage(e.message||'Unable to load the register.')}
};

const action=async(item,type)=>{
const draft=drafts[item.id]||{};
if(type==='confirm'&&!item.best_candidate_id)return setMessage('ARIA could not find a safe existing match. Correct the row instead.');
if(type==='keep_new'&&!draft.name.trim())return setMessage('Enter the correct name first.');
if(!window.confirm(type==='confirm'?'Use the selected existing person for this register row?':'Save this corrected row as a new person?'))return;
setMessage('Processing…');
try{
const{data:{session}}=await supabase.auth.getSession();
if(!session)throw Error('You must be logged in.');
const body={scan_job_id:item.scan_job_id,review_index:item.review_index,action:type};
if(type==='confirm')body.target_person_id=item.best_candidate_id;
else{body.new_name=draft.name.trim();body.new_phone=draft.phone.trim();}
const r=await fetch('/api/identity/review-action',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify(body)}),d=await r.json();
if(!r.ok)throw Error(d.error||'Unable to resolve review.');
setMessage('Resolved.');await fetchReviews();setTimeout(()=>setMessage(''),1500);
}catch(e){setMessage(e.message||'Unable to resolve review.')}
};

const body=<div style={wrap}>
<div style={top}><div><div style={eyebrow}>ARIA REVIEW</div><h1>Identity review</h1><p>{stats.total||0} row{stats.total===1?'':'s'} need{stats.total===1?'s':''} a human decision before ARIA saves them.</p></div>{modal&&<button style={close} onClick={onClose}>×</button>}</div>
{message&&<div style={notice}>{message}</div>}
{loading?<div style={loadingBox}>Preparing reviews…</div>:!reviews.length?<div style={empty}>ARIA has no unresolved scan identities.</div>:<div style={list}>{reviews.map(item=>{
const draft=drafts[item.id]||{};
return <article style={card} key={item.id}>
<div style={rowTop}><div><div style={eyebrow}>{item.status==='conflict'?'CONFLICT':'NEEDS VERIFICATION'}</div><h2>{item.extracted_name||'Unknown person'}</h2></div><button style={evidenceButton} onClick={()=>showEvidence(item)}>View register</button></div>
<div style={muted}>Detected phone: {item.extracted_phone||'Unreadable'} · Scan confidence {item.confidence==null?'—':`${Math.round(Number(item.confidence))}%`}</div>
{item.reasons?.length>0&&<div style={reasons}>{item.reasons.map((x,i)=><span key={i}>{String(x).replace(/_/g,' ')}</span>)}</div>}
{item.verification_alternatives&&<details style={details}><summary>What ARIA saw in the independent passes</summary><pre style={pre}>{JSON.stringify(item.verification_alternatives,null,2)}</pre></details>}
{item.candidates?.length>0&&<div style={candidate}><div><span>NAME-BASED POSSIBLE MATCH</span><strong>{item.candidates[0].name}</strong><small>{item.candidates[0].phone||'No phone'} · Match {item.candidates[0].score}%</small></div><button style={primary} onClick={()=>action(item,'confirm')}>Confirm match</button></div>}
<div style={editBox}><label>Correct name</label><input value={draft.name||''} onChange={e=>updateDraft(item.id,'name',e.target.value)} /><label>Correct phone</label><input value={draft.phone||''} onChange={e=>updateDraft(item.id,'phone',e.target.value)} inputMode="tel"/><button style={secondary} onClick={()=>action(item,'keep_new')}>Save corrected person</button></div>
</article>})}</div>}
</div>;

if(!modal)return body;
return <div style={modalBox}><div style={modalCard}>{body}</div>{evidence&&<div style={imageOverlay} onClick={()=>{URL.revokeObjectURL(evidence.url);setEvidence(null)}}><div style={imageCard} onClick={e=>e.stopPropagation()}><div style={imageHead}><strong>{evidence.name||'Original register'}</strong><button style={close} onClick={()=>{URL.revokeObjectURL(evidence.url);setEvidence(null)}}>×</button></div><img src={evidence.url} alt="Original register" style={image}/></div></div>}</div>
}

const wrap={maxWidth:900,margin:'0 auto',padding:'26px 20px 60px',color:'#eef4ff'};
const top={display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:20};
const eyebrow={fontSize:10,letterSpacing:2,textTransform:'uppercase',color:'rgba(255,255,255,.35)'};
const close={width:42,height:42,border:0,borderRadius:'50%',background:'rgba(255,255,255,.08)',color:'#fff',fontSize:26,cursor:'pointer'};
const notice={padding:'11px 14px',borderRadius:14,background:'rgba(255,255,255,.06)',margin:'16px 0'};
const loadingBox={padding:60,textAlign:'center',color:'rgba(255,255,255,.45)'};
const empty={padding:60,textAlign:'center',color:'rgba(255,255,255,.4)'};
const list={display:'grid',gap:10,marginTop:20};
const card={padding:15,borderRadius:18,border:'1px solid rgba(255,255,255,.09)',background:'rgba(255,255,255,.035)'};
const rowTop={display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12};
const muted={color:'rgba(255,255,255,.45)',fontSize:12,marginTop:6};
const reasons={display:'flex',gap:6,flexWrap:'wrap',margin:'10px 0'};
const candidate={margin:'12px 0',padding:12,borderRadius:15,border:'1px solid rgba(143,183,255,.13)',background:'rgba(143,183,255,.045)',display:'flex',justifyContent:'space-between',alignItems:'center',gap:12};
const editBox={display:'grid',gap:6,marginTop:12};
const details={marginTop:10,color:'rgba(255,255,255,.5)',fontSize:12};
const pre={whiteSpace:'pre-wrap',fontSize:10,maxHeight:180,overflow:'auto'};
const primary={border:0,borderRadius:999,padding:'9px 13px',background:'#f5f5f5',color:'#08101e',fontWeight:700,cursor:'pointer'};
const secondary={border:'1px solid rgba(255,255,255,.12)',borderRadius:999,padding:'9px 13px',background:'rgba(255,255,255,.04)',color:'#fff',cursor:'pointer',marginTop:4};
const evidenceButton={border:'1px solid rgba(255,255,255,.1)',borderRadius:999,padding:'7px 10px',background:'rgba(255,255,255,.04)',color:'#fff',cursor:'pointer',fontSize:11};
const modalBox={position:'fixed',inset:0,zIndex:3000,background:'rgba(2,5,12,.8)',backdropFilter:'blur(20px)',padding:12};
const modalCard={height:'100%',maxWidth:960,margin:'0 auto',overflow:'auto',borderRadius:30,background:'#0a1128',border:'1px solid rgba(255,255,255,.1)'};
const imageOverlay={position:'fixed',inset:0,zIndex:4000,background:'rgba(0,0,0,.86)',padding:14,display:'grid',placeItems:'center'};
const imageCard={width:'min(1000px,100%)',height:'min(94vh,100%)',background:'#0a1128',borderRadius:22,overflow:'auto',border:'1px solid rgba(255,255,255,.12)'};
const imageHead={display:'flex',justifyContent:'space-between',alignItems:'center',padding:12,color:'#fff'};
const image={display:'block',width:'100%',height:'auto',maxHeight:'calc(94vh - 70px)',objectFit:'contain'};

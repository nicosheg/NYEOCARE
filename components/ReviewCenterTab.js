// components/ReviewCenterTab.js
import{useState,useEffect}from'react';
import{supabase}from'../lib/supabaseClient';

export default function ReviewCenterTab({modal=false,onClose}){
const[reviews,setReviews]=useState([]),[stats,setStats]=useState({}),[loading,setLoading]=useState(true),[message,setMessage]=useState('');
const fetchReviews=async()=>{setLoading(true);try{const{data:{session}}=await supabase.auth.getSession();if(!session){setLoading(false);return}const r=await fetch('/api/identity/review-items',{headers:{Authorization:`Bearer ${session.access_token}`}}),d=await r.json();if(!r.ok)throw Error(d.error||'Unable to load reviews.');setReviews(d.items||[]);setStats(d.stats||{})}catch(e){setMessage(e.message||'Unable to load reviews.')}finally{setLoading(false)}};
useEffect(()=>{fetchReviews()},[]);
const action=async(item,type)=>{if(!confirm(type==='confirm'?'Use the suggested identity for this scan?':'Keep this as a new person?'))return;setMessage('Processing…');try{const{data:{session}}=await supabase.auth.getSession();if(!session)throw Error('You must be logged in.');const body={scan_job_id:item.scan_job_id,review_index:item.review_index,action:type};if(type==='confirm')body.target_person_id=item.best_candidate_id;const r=await fetch('/api/identity/review-action',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify(body)}),d=await r.json();if(!r.ok)throw Error(d.error||'Unable to resolve review.');setMessage('Resolved.');await fetchReviews();setTimeout(()=>setMessage(''),1500)}catch(e){setMessage(e.message||'Unable to resolve review.')}};
const body=<div style={wrap}><div style={top}><div><div style={eyebrow}>ARIA REVIEW</div><h1>Identity review</h1><p>{stats.total||0} item{stats.total===1?'':'s'} need{stats.total===1?'s':''} a human decision.</p></div>{modal&&<button style={close} onClick={onClose}>×</button>}</div>{message&&<div style={notice}>{message}</div>}{loading?<div style={loadingBox}>Preparing reviews…</div>:!reviews.length?<div style={empty}>ARIA has no unresolved identity reviews.</div>:<div style={list}>{reviews.map(item=><article style={card} key={item.id}><div style={eyebrow}>{item.status==='conflict'?'CONFLICT':'NEEDS DECISION'}</div><h2>{item.extracted_name}</h2><p style={muted}>{item.extracted_phone||'No phone detected'} · Confidence {item.confidence==null?'—':`${Math.round(Number(item.confidence))}%`}</p>{item.best_candidate_id&&<div style={candidate}><div><span>ARIA'S BEST MATCH</span><strong>{item.candidates?.[0]?.name||'Existing person'}</strong><small>{item.candidates?.[0]?.phone||'No phone'} · Score {item.score}</small></div><button style={primary} onClick={()=>action(item,'confirm')}>Use match</button></div>}{item.reasons?.length>0&&<div style={reasons}>{item.reasons.map((x,i)=><span key={i}>{String(x).replace(/_/g,' ')}</span>)}</div>}<button style={secondary} onClick={()=>action(item,'keep_new')}>Keep as new person</button></article>)}</div>}</div>;
if(!modal)return body;return <div style={modalBox}><div style={modalCard}>{body}</div></div>;
}
const wrap={maxWidth:900,margin:'0 auto',padding:'26px 20px 60px',color:'#eef4ff'};
const top={display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:20};
const eyebrow={fontSize:10,letterSpacing:2,color:'rgba(255,255,255,.35)',textTransform:'uppercase'};
const close={width:42,height:42,border:0,borderRadius:'50%',background:'rgba(255,255,255,.08)',color:'#fff',fontSize:26,cursor:'pointer'};
const notice={padding:'11px 14px',borderRadius:14,background:'rgba(255,255,255,.06)',margin:'16px 0'};
const loadingBox={padding:60,textAlign:'center',color:'rgba(255,255,255,.45)'};
const empty={padding:60,textAlign:'center',color:'rgba(255,255,255,.4)'};
const list={display:'grid',gap:12,marginTop:22};
const card={padding:20,borderRadius:24,border:'1px solid rgba(255,255,255,.09)',background:'rgba(255,255,255,.035)'};
const candidate={margin:'18px 0 12px',padding:14,borderRadius:18,border:'1px solid rgba(143,183,255,.13)',background:'rgba(143,183,255,.045)',display:'flex',justifyContent:'space-between',alignItems:'center',gap:12};
const reasons={display:'flex',gap:6,flexWrap:'wrap',margin:'12px 0'};
const primary={border:0,borderRadius:999,padding:'10px 15px',background:'#f5f5f5',color:'#08101e',fontWeight:700,cursor:'pointer'};
const secondary={border:'1px solid rgba(255,255,255,.12)',borderRadius:999,padding:'10px 15px',background:'rgba(255,255,255,.04)',color:'#fff',cursor:'pointer'};
const muted={color:'rgba(255,255,255,.45)',fontSize:13};
const modalBox={position:'fixed',inset:0,zIndex:3000,background:'rgba(2,5,12,.8)',backdropFilter:'blur(20px)',padding:12};
const modalCard={height:'100%',maxWidth:960,margin:'0 auto',overflow:'auto',borderRadius:30,background:'#0a1128',border:'1px solid rgba(255,255,255,.1)'};

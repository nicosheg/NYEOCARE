// components/ScanModal.js
import{useState,useRef,useEffect,useCallback}from'react';
import{supabase}from'../lib/supabaseClient';
import{getScanState,setScanState,clearScanState}from'../lib/scanStore';

export default function ScanModal({isOpen,onClose}){
const camera=useRef(null),photos=useRef(null),files=useRef(null),poll=useRef(null),timer=useRef(null);
const[state,setState]=useState(getScanState()),[program,setProgram]=useState('GIBEON'),[message,setMessage]=useState(''),[seconds,setSeconds]=useState(0);

const stop=useCallback(()=>{if(poll.current)clearInterval(poll.current);if(timer.current)clearInterval(timer.current);poll.current=null;timer.current=null},[]);

const reset=useCallback(()=>{stop();clearScanState();setState(getScanState());setMessage('');setSeconds(0)},[stop]);

const update=useCallback(v=>{setScanState(v);setState(getScanState())},[]);

const startPolling=useCallback(jobId=>{
stop();
let n=0;
setSeconds(0);
timer.current=setInterval(()=>{n+=1;setSeconds(n)},1000);
poll.current=setInterval(async()=>{
try{
const{data:{session}}=await supabase.auth.getSession();
if(!session)return;
const r=await fetch(`/api/scan/status?job_id=${encodeURIComponent(jobId)}`,{headers:{Authorization:`Bearer ${session.access_token}`}});
if(!r.ok)return;
const d=await r.json();
if(['pending','processing','retrying'].includes(d.status)){
const msgs={enhancing:'ARIA is preparing the image…',reading_handwriting:'ARIA is reading the register…',validating:'ARIA is checking every row…',matching_community:'ARIA is comparing with your people…',retrying:'ARIA is verifying the scan…'};
setMessage(msgs[d.progress]||d.message||'ARIA is working…');
}else if(d.status==='complete'){
stop();
const x=d.result||{};
update({stage:'complete',summary:{total:x.total_extracted??x.total_valid??x.people?.length??0,newVisitors:x.new_members||0,returning:x.updated||0,needsReview:x.needs_review?.length||0}});
}else if(d.status==='failed'){
stop();
update({stage:'error',message:d.message||'Scan failed'});
}
}catch(e){console.error('[SCAN POLL]',e)}
},1500);
},[stop,update]);

useEffect(()=>{if(!isOpen)return;setState(getScanState());return()=>stop()},[isOpen,stop]);
useEffect(()=>()=>stop(),[stop]);

const preprocess=file=>new Promise((resolve,reject)=>{
if(!file||!file.type?.startsWith('image/'))return reject(Error('Please select an image.'));
const reader=new FileReader();
reader.onload=e=>{
const img=new Image();
img.onload=()=>{
const max=2800,scale=Math.min(1,max/Math.max(img.width,img.height)),w=Math.max(1,Math.round(img.width*scale)),h=Math.max(1,Math.round(img.height*scale)),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
if(!ctx)return reject(Error('Image preparation failed.'));
canvas.width=w;
canvas.height=h;
ctx.imageSmoothingEnabled=true;
ctx.imageSmoothingQuality='high';
ctx.drawImage(img,0,0,w,h);
const data=canvas.toDataURL('image/jpeg',.94).split(',')[1];
if(!data)return reject(Error('Image encoding failed.'));
resolve(data);
};
img.onerror=()=>reject(Error('Could not read this image.'));
img.src=e.target.result;
};
reader.onerror=()=>reject(Error('Could not read this file.'));
reader.readAsDataURL(file);
});

const handleFile=async e=>{
const file=e.target.files?.[0];
e.target.value='';
if(!file)return;
setScanState({stage:'processing',jobId:null,scanningLine:false,message:''});
setState(getScanState());
setMessage('ARIA is preparing the image…');
try{
const base64=await preprocess(file);
const{data:{session}}=await supabase.auth.getSession();
if(!session)throw Error('You must be logged in.');
const r=await fetch('/api/scan/start',{
method:'POST',
headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
body:JSON.stringify({image_base64:base64,program_name:program.trim()||'GIBEON'})
});
const d=await r.json();
if(!r.ok)throw Error(d.error||'Could not start scan.');
update({stage:'processing',jobId:d.job_id,scanningLine:true});
startPolling(d.job_id);
}catch(e){
console.error('[SCAN START]',e);
update({stage:'error',message:e.message||'Could not process the image.'});
}
};

if(!isOpen)return null;
const s=state||{},summary=s.summary;

return <div style={overlay}>
<div style={modal}>
<button style={close} onClick={()=>{reset();onClose()}}>×</button>
<div style={inner}>
{s.stage==='idle'&&<>
<div style={eyebrow}>NYEOCARE · SCAN</div>
<h1 style={title}>Add a register.</h1>
<p style={sub}>Choose how you want to give ARIA the register.</p>
<input value={program} onChange={e=>setProgram(e.target.value)} placeholder="Program / event name" style={inputStyle}/>
<div style={sourceGrid}>
<button style={source} onClick={()=>camera.current?.click()}><span style={sourceIcon}>⌾</span><strong>Camera</strong><small>Take a new photo</small></button>
<button style={source} onClick={()=>photos.current?.click()}><span style={sourceIcon}>▧</span><strong>Photos</strong><small>Choose from gallery</small></button>
<button style={source} onClick={()=>files.current?.click()}><span style={sourceIcon}>□</span><strong>Files</strong><small>Choose an image file</small></button>
</div>
<input ref={camera} type="file" accept="image/*" capture="environment" onChange={handleFile} hidden/>
<input ref={photos} type="file" accept="image/*" onChange={handleFile} hidden/>
<input ref={files} type="file" accept="image/*,.jpg,.jpeg,.png,.webp" onChange={handleFile} hidden/>
<p style={hint}>Photos, screenshots and supported image files are all accepted.</p>
</>}
{s.stage==='processing'&&<div style={status}>
<div style={pulse}>A</div>
<strong>{message||'ARIA is working…'}</strong>
<span>{seconds}s</span>
</div>}
{s.stage==='complete'&&summary&&<div style={result}>
<div style={success}>People memory updated.</div>
<strong>{summary.total} people processed.</strong>
<span>{summary.newVisitors} new · {summary.returning} recognised{summary.needsReview?` · ${summary.needsReview} need review`:''}</span>
<button style={secondary} onClick={reset}>Scan another</button>
</div>}
{s.stage==='error'&&<div style={result}>
<div style={error}>Scan could not be completed.</div>
<p>{s.message||'Please try again with a clearer image.'}</p>
<button style={secondary} onClick={reset}>Try again</button>
</div>}
</div>
</div>
</div>
}

const overlay={position:'fixed',inset:0,zIndex:4000,background:'rgba(2,6,16,.82)',backdropFilter:'blur(20px)',padding:14};
const modal={position:'relative',height:'100%',maxWidth:620,margin:'0 auto',borderRadius:30,border:'1px solid rgba(255,255,255,.1)',background:'#0a1128',overflow:'auto',color:'#fff'};
const close={position:'absolute',right:18,top:18,width:40,height:40,border:0,borderRadius:'50%',background:'rgba(255,255,255,.07)',color:'#fff',fontSize:25,cursor:'pointer'};
const inner={maxWidth:500,margin:'0 auto',padding:'70px 24px 50px',textAlign:'center'};
const eyebrow={fontSize:10,letterSpacing:2.5,color:'rgba(255,255,255,.35)',marginBottom:12};
const title={fontSize:'clamp(36px,9vw,52px)',letterSpacing:'-.04em',margin:'0 0 10px',fontWeight:600};
const sub={color:'rgba(255,255,255,.45)',lineHeight:1.6,margin:'0 auto 22px'};
const inputStyle={width:'100%',padding:'14px 16px',margin:'0 0 22px',borderRadius:15,border:'1px solid rgba(255,255,255,.1)',background:'rgba(255,255,255,.04)',color:'#fff',outline:'none',boxSizing:'border-box'};
const sourceGrid={display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10};
const source={minHeight:150,padding:'20px 10px',borderRadius:22,border:'1px solid rgba(255,255,255,.09)',background:'rgba(255,255,255,.035)',color:'#fff',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:8,cursor:'pointer'};
const sourceIcon={width:50,height:50,borderRadius:18,display:'grid',placeItems:'center',background:'rgba(255,255,255,.065)',border:'1px solid rgba(255,255,255,.08)',fontSize:25,color:'rgba(255,255,255,.75)'};
const hint={fontSize:12,color:'rgba(255,255,255,.28)',marginTop:18,lineHeight:1.5};
const status={marginTop:35,padding:30,borderRadius:25,background:'rgba(255,255,255,.035)',display:'grid',gap:12,justifyItems:'center'};
const pulse={width:70,height:70,borderRadius:'50%',display:'grid',placeItems:'center',background:'rgba(212,175,55,.1)',border:'1px solid rgba(212,175,55,.3)',color:'#d4af37',fontSize:22};
const result={marginTop:35,padding:28,borderRadius:25,background:'rgba(255,255,255,.035)',display:'grid',gap:12};
const success={color:'#8fd7b4',fontSize:18};
const error={color:'#ff9d9d',fontSize:18};
const secondary={marginTop:10,padding:'11px 18px',borderRadius:999,border:'1px solid rgba(255,255,255,.12)',background:'rgba(255,255,255,.05)',color:'#fff',cursor:'pointer'};

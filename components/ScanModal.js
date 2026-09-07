// components/ScanModal.js
import{useState,useRef,useEffect,useCallback}from'react';
import{useRouter}from'next/router';
import{supabase}from'../lib/supabaseClient';
import{getScanState,setScanState,clearScanState}from'../lib/scanStore';

const MAX_DIMENSION=1800,MAX_IMAGE_BYTES=3.5*1024*1024;

export default function ScanModal({isOpen,onClose}){
const router=useRouter(),cameraInputRef=useRef(null),uploadInputRef=useRef(null),pollRef=useRef(null),timerRef=useRef(null);
const[programName,setProgramName]=useState('GIBEON'),[scanState,setScanStateLocal]=useState(getScanState()),[progressMessage,setProgressMessage]=useState(''),[elapsedSeconds,setElapsedSeconds]=useState(0);

const sync=useCallback(()=>setScanStateLocal(getScanState()),[]);
const stop=useCallback(()=>{if(pollRef.current)clearInterval(pollRef.current);if(timerRef.current)clearInterval(timerRef.current);pollRef.current=null;timerRef.current=null},[]);
const update=useCallback(v=>{setScanState(v);setScanStateLocal(v)},[]);

const startPolling=useCallback(jobId=>{
stop();
let seconds=0;
setElapsedSeconds(0);
timerRef.current=setInterval(()=>{seconds+=1;setElapsedSeconds(seconds)},1000);
pollRef.current=setInterval(async()=>{
try{
const{data:{session}}=await supabase.auth.getSession();
if(!session)return;
const r=await fetch(`/api/scan/status?job_id=${encodeURIComponent(jobId)}`,{headers:{Authorization:`Bearer ${session.access_token}`}});
if(!r.ok)return;
const d=await r.json();
if(['pending','processing','retrying'].includes(d.status)){
const messages={queued:'ARIA is preparing the register…',enhancing:'ARIA is preparing the image…',reading_handwriting:'ARIA is reading the register…',validating:'ARIA is checking every row…',matching_community:'ARIA is comparing with your people…',building_memory:'ARIA is remembering your community…',retrying:'ARIA is verifying the scan…'};
setProgressMessage(messages[d.progress]||d.message||'ARIA is working…');
}else if(d.status==='complete'){
stop();
const x=d.result||{};
update({stage:'complete',summary:{total:x.total_extracted??x.total_valid??x.people?.length??0,newVisitors:x.new_members||0,returning:x.updated||0,duplicates:x.duplicates||0,needsReview:x.needs_review?.length||0}});
}else if(d.status==='failed'){
stop();
update({stage:'error',message:d.message||'ARIA was unable to read the register.'});
}
}catch(err){console.error('[SCAN POLL]',err)}
},1500);
},[stop,update]);

useEffect(()=>{
if(!isOpen)return;
const current=getScanState();
setScanStateLocal(current);
if(current.stage==='processing'&&current.jobId)startPolling(current.jobId);
return()=>stop();
},[isOpen,startPolling,stop]);

useEffect(()=>{
if(!isOpen)return;
const previous=document.body.style.overflow;
document.body.style.overflow='hidden';
return()=>{document.body.style.overflow=previous};
},[isOpen]);

const preprocessImage=async file=>{
if(!file||!file.type?.startsWith('image/'))throw Error('Please select an image of the register.');
let objectUrl=null,img=null,canvas=null,blob=null;
try{
objectUrl=URL.createObjectURL(file);
img=await new Promise((resolve,reject)=>{
const image=new Image();
image.onload=()=>resolve(image);
image.onerror=()=>reject(Error('Could not read the selected image.'));
image.src=objectUrl;
});
const scale=Math.min(1,MAX_DIMENSION/Math.max(img.naturalWidth||img.width,img.naturalHeight||img.height));
const width=Math.max(1,Math.round((img.naturalWidth||img.width)*scale));
const height=Math.max(1,Math.round((img.naturalHeight||img.height)*scale));
canvas=document.createElement('canvas');
canvas.width=width;
canvas.height=height;
const ctx=canvas.getContext('2d',{alpha:false});
if(!ctx)throw Error('Image preparation failed.');
ctx.imageSmoothingEnabled=true;
ctx.imageSmoothingQuality='high';
ctx.fillStyle='#fff';
ctx.fillRect(0,0,width,height);
ctx.drawImage(img,0,0,width,height);
blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.82));
if(!blob)throw Error('Image encoding failed.');
if(blob.size>MAX_IMAGE_BYTES)blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.68));
if(!blob||blob.size>MAX_IMAGE_BYTES)throw Error('The photo is still too large. Please move farther back and try again.');
const base64=await new Promise((resolve,reject)=>{
const reader=new FileReader();
reader.onload=()=>resolve(String(reader.result||'').split(',')[1]||'');
reader.onerror=()=>reject(Error('Could not prepare the image.'));
reader.readAsDataURL(blob);
});
if(base64.length<100)throw Error('Image encoding failed.');
return base64;
}finally{
if(objectUrl)URL.revokeObjectURL(objectUrl);
if(img)img.src='';
if(canvas){canvas.width=1;canvas.height=1}
}
};

const handleFile=async e=>{
const file=e.target.files?.[0];
e.target.value='';
if(!file)return;
update({stage:'processing',scanningLine:true,jobId:null,message:''});
setProgressMessage('ARIA is preparing the image…');
try{
const base64=await preprocessImage(file);
const{data:{session}}=await supabase.auth.getSession();
if(!session)throw Error('You must be logged in to scan.');
const r=await fetch('/api/scan/start',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({image_base64:base64,program_name:programName.trim()||'GIBEON'})});
let data={};
try{data=await r.json()}catch{throw Error('The scan service returned an invalid response.')}
if(!r.ok)throw Error(data.error||'Failed to start scan.');
if(!data.job_id)throw Error('ARIA did not return a scan job.');
update({stage:'processing',jobId:data.job_id,scanningLine:true});
startPolling(data.job_id);
}catch(err){
console.error('[SCAN START]',err);
stop();
update({stage:'error',message:err.message||'ARIA could not process the register.'});
}
};

const handleClose=()=>{stop();clearScanState();onClose()};
const retry=()=>{clearScanState();setProgressMessage('');setElapsedSeconds(0);sync()};
if(!isOpen)return null;

const{stage,summary,message}=scanState;

return <div className="scan-modal-overlay" onClick={handleClose}>
<div className="scan-modal" onClick={e=>e.stopPropagation()}>
<button className="scan-modal-close" onClick={handleClose} aria-label="Close scan">×</button>
<div className="scan-content">
<div className="scan-eyebrow">ARIA · SCAN</div>
<h1>Remember people.</h1>
<p className="scan-subtitle">Capture the full register clearly. ARIA will verify what it sees.</p>

{stage==='idle'&&<>
<div className="program-wrap">
<label htmlFor="scan-program">Program / Event Name</label>
<input id="scan-program" type="text" value={programName} onChange={e=>setProgramName(e.target.value)} placeholder="e.g. GIBEON" autoComplete="off"/>
</div>
<div className="scan-tip">Ensure the full page is visible with good lighting. Keep the camera steady and avoid shadows, folds, glare, or cut-off edges.</div>
<div className="scan-actions">
<button className="scan-primary" onClick={()=>cameraInputRef.current?.click()}><span>⌾</span> Take Photo</button>
<button className="scan-secondary scan-upload" onClick={()=>uploadInputRef.current?.click()}><span>↑</span> Upload Image</button>
</div>
<input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleFile} hidden/>
<input ref={uploadInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/*" onChange={handleFile} hidden/>
<p className="scan-hint">Use Take Photo for a live camera capture or Upload Image for an existing register photo.</p>
</>}

{stage==='processing'&&<div className="scan-card scan-processing">
<div className="aria-orb"><span/></div>
<p className="aria-message">{progressMessage||'ARIA is working…'}</p>
{elapsedSeconds>5&&<p className="elapsed">{elapsedSeconds}s elapsed</p>}
<p className="leave-note">You can leave this page — ARIA will keep working.</p>
</div>}

{stage==='complete'&&summary&&<div className="scan-card scan-result">
<div className="result-title">Memory updated</div>
<p className="result-total">{summary.total} lives remembered.</p>
<div className="result-stats">
{summary.newVisitors>0&&<div>{summary.newVisitors} first-time visitors</div>}
{summary.returning>0&&<div>{summary.returning} familiar faces returning</div>}
{summary.duplicates>0&&<div>{summary.duplicates} familiar faces recognised</div>}
{summary.needsReview>0&&<div>{summary.needsReview} need your attention</div>}
</div>
<p className="aria-message">ARIA has finished preparing your community.</p>
<button className="scan-primary wide" onClick={()=>router.push('/people?tab=community')}>View Community</button>
</div>}

{stage==='error'&&<div className="scan-card scan-error">
<p>{message||'ARIA was unable to read the register. Please try again with a clearer photo.'}</p>
<button className="scan-secondary" onClick={retry}>Try Again</button>
</div>}
</div>

<style jsx>{`
.scan-modal-overlay{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.78);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:8px;overflow:hidden;overscroll-behavior:contain}
.scan-modal{box-sizing:border-box;position:relative;width:min(760px,calc(100vw - 16px));height:min(920px,calc(100dvh - 16px));min-height:0;background:#0A0F1A;border:1px solid rgba(255,255,255,.07);border-radius:30px;color:#fff;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:42px 18px 22px;box-shadow:0 24px 80px rgba(0,0,0,.45)}
.scan-modal-close{position:absolute;z-index:2;top:12px;right:14px;width:42px;height:42px;border:0;border-radius:50%;background:rgba(255,255,255,.06);color:rgba(255,255,255,.7);font-size:28px;line-height:1;cursor:pointer}
.scan-content{box-sizing:border-box;width:100%;max-width:620px;margin:0 auto;padding:0 18px;text-align:center}
.scan-eyebrow{font-size:10px;letter-spacing:2.5px;color:rgba(255,255,255,.35);margin-bottom:12px}
.scan-content h1{font-size:30px;font-weight:700;color:#f0f0f0;margin:0 0 8px}
.scan-subtitle{color:rgba(255,255,255,.6);margin:0 0 28px;line-height:1.6}
.program-wrap{margin-bottom:20px}
.program-wrap label{font-weight:600;display:block;margin-bottom:8px;color:#f0f0f0}
.program-wrap input{box-sizing:border-box;padding:13px 16px;font-size:16px;border-radius:14px;border:1px solid rgba(255,255,255,.08);background:rgba(20,25,40,.8);color:#fff;width:100%;max-width:340px;text-align:center;outline:none}
.program-wrap input:focus{border-color:rgba(212,175,55,.55);box-shadow:0 0 0 3px rgba(212,175,55,.08)}
.scan-tip{background:rgba(20,25,40,.9);border-radius:20px;border:1px solid rgba(255,255,255,.05);padding:15px 17px;margin-bottom:24px;text-align:left;font-size:14px;color:rgba(255,255,255,.6);line-height:1.55}
.scan-actions{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
.scan-primary,.scan-secondary{box-sizing:border-box;min-height:52px;border-radius:28px;font-weight:700;font-size:16px;cursor:pointer;transition:transform .15s,box-shadow .2s}
.scan-primary{border:0;padding:15px 28px;background:rgba(212,175,55,.95);color:#0A0F1A}
.scan-primary:hover{transform:translateY(-1px);box-shadow:0 8px 30px rgba(212,175,55,.18)}
.scan-primary:active,.scan-secondary:active{transform:scale(.98)}
.scan-primary span,.scan-secondary span{font-size:20px;margin-right:7px;vertical-align:-1px}
.scan-primary.wide{width:100%;font-size:15px}
.scan-secondary{border:1px solid rgba(255,255,255,.12);padding:13px 25px;background:rgba(255,255,255,.05);color:#fff}
.scan-upload{min-width:170px}
.scan-hint{font-size:12px;color:rgba(255,255,255,.3);margin-top:14px;line-height:1.5}
.scan-card{background:rgba(20,25,40,.9);border-radius:26px;border:1px solid rgba(255,255,255,.05);padding:26px;margin-top:20px}
.scan-processing{padding:38px 24px}
.aria-orb{width:86px;height:86px;border-radius:50%;margin:0 auto 22px;background:radial-gradient(circle,rgba(212,175,55,.15) 0%,transparent 70%);animation:breathe 3s ease-in-out infinite;position:relative}
.aria-orb span{position:absolute;width:17px;height:17px;border-radius:50%;background:#D4AF37;top:50%;left:50%;transform:translate(-50%,-50%);box-shadow:0 0 20px rgba(212,175,55,.4);animation:pulse 2s ease-in-out infinite}
.aria-message{font-size:16px;margin:0 0 8px;line-height:1.5}
.elapsed,.leave-note{color:rgba(255,255,255,.4);font-size:13px}
.leave-note{font-size:12px;margin-top:8px;color:rgba(255,255,255,.3)}
.scan-result{text-align:left}
.result-title{font-size:24px;color:#D4AF37;margin-bottom:12px}
.result-total{color:#f0f0f0;font-size:18px;margin-bottom:16px}
.result-stats{display:flex;flex-direction:column;gap:7px;margin-bottom:20px;color:rgba(255,255,255,.65);font-size:15px}
.scan-result .aria-message{font-size:14px;margin-bottom:20px}
.scan-error{text-align:left}
.scan-error p{color:#EF4444;margin-bottom:16px;line-height:1.55}
@keyframes breathe{0%{transform:scale(.95);opacity:.8}50%{transform:scale(1.05);opacity:1}100%{transform:scale(.95);opacity:.8}}
@keyframes pulse{0%{transform:translate(-50%,-50%) scale(1);opacity:.8}50%{transform:translate(-50%,-50%) scale(1.4);opacity:1}100%{transform:translate(-50%,-50%) scale(1);opacity:.8}}
@media(max-width:520px){
.scan-modal-overlay{padding:5px}
.scan-modal{width:calc(100vw - 10px);height:calc(100dvh - 10px);border-radius:26px;padding:42px 10px 16px}
.scan-content{padding:0 8px}
.scan-content h1{font-size:27px}
.scan-subtitle{font-size:14px;margin-bottom:22px}
.scan-actions{flex-direction:column}
.scan-primary,.scan-secondary,.scan-upload{width:100%}
.scan-card{padding:24px 18px}
}
@media(max-height:650px) and (orientation:landscape){
.scan-modal{height:calc(100dvh - 8px);width:calc(100vw - 8px)}
}
`}</style>
</div>
</div>
  }

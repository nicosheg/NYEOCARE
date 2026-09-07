// components/ScanModal.js
import{useState,useRef,useEffect,useCallback}from'react';
import{useRouter}from'next/router';
import{supabase}from'../lib/supabaseClient';
import{getScanState,setScanState,clearScanState}from'../lib/scanStore';

export default function ScanModal({isOpen,onClose}){
const router=useRouter(),fileInputRef=useRef(null),pollRef=useRef(null),timerRef=useRef(null);
const[programName,setProgramName]=useState('GIBEON'),[scanState,setScanStateLocal]=useState(getScanState()),[progressMessage,setProgressMessage]=useState(''),[elapsedSeconds,setElapsedSeconds]=useState(0);

const sync=useCallback(()=>setScanStateLocal(getScanState()),[]);
const stop=useCallback(()=>{if(pollRef.current)clearInterval(pollRef.current);if(timerRef.current)clearInterval(timerRef.current);pollRef.current=null;timerRef.current=null},[]);
const update=useCallback(v=>{setScanState(v);sync()},[sync]);

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
const messages={queued:'ARIA is preparing the register…',enhancing:'ARIA is preparing the image…',reading_handwriting:'ARIA is reading the register…',validating:'ARIA is checking every row…',matching_community:'ARIA is comparing with your people…',retrying:'ARIA is verifying the scan…'};
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

useEffect(()=>{const current=getScanState();setScanStateLocal(current);if(current.stage==='processing'&&current.jobId)startPolling(current.jobId);return()=>stop()},[startPolling,stop]);

const preprocessImage=file=>new Promise((resolve,reject)=>{
if(!file||!file.type?.startsWith('image/'))return reject(Error('Please select an image of the register.'));
const reader=new FileReader();
reader.onload=e=>{
const img=new Image();
img.onload=()=>{
const max=2800,scale=Math.min(1,max/Math.max(img.width,img.height)),width=Math.max(1,Math.round(img.width*scale)),height=Math.max(1,Math.round(img.height*scale)),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
if(!ctx)return reject(Error('Image preparation failed.'));
canvas.width=width;
canvas.height=height;
ctx.imageSmoothingEnabled=true;
ctx.imageSmoothingQuality='high';
ctx.drawImage(img,0,0,width,height);
const base64=canvas.toDataURL('image/jpeg',.94).split(',')[1];
if(!base64||base64.length<100)return reject(Error('Image encoding failed.'));
resolve(base64);
};
img.onerror=()=>reject(Error('Could not read the selected image.'));
img.src=e.target.result;
};
reader.onerror=()=>reject(Error('Could not read the selected file.'));
reader.readAsDataURL(file);
});

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
const data=await r.json();
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
if(!isOpen)return null;

const{stage,summary,message}=scanState;

return <div className="scan-modal-overlay" onClick={handleClose}>
<div className="scan-modal" onClick={e=>e.stopPropagation()}>
<button className="scan-modal-close" onClick={handleClose}>×</button>
<div className="scan-content">
<div className="scan-eyebrow">ARIA · SCAN</div>
<h1>Remember people.</h1>
<p className="scan-subtitle">Capture the full register clearly. ARIA will verify what it sees.</p>

{stage==='idle'&&<>
<div className="program-wrap">
<label>Program / Event Name</label>
<input type="text" value={programName} onChange={e=>setProgramName(e.target.value)} placeholder="e.g. GIBEON"/>
</div>
<div className="scan-tip">Ensure the full page is visible — no torn, folded, or cut-off edges — and good lighting.</div>
<button className="scan-primary" onClick={()=>fileInputRef.current?.click()}>Take Photo of Register</button>
<input ref={fileInputRef} type="file" accept="image/*" onChange={handleFile} hidden/>
<p className="scan-hint">Chrome will open its normal camera and file chooser.</p>
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
<button className="scan-secondary" onClick={()=>{clearScanState();sync()}}>Try Again</button>
</div>}
</div>

<style jsx>{`
.scan-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);backdrop-filter:blur(8px);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px}
.scan-modal{background:#0A0F1A;border-radius:32px;max-width:700px;width:100%;max-height:90vh;overflow-y:auto;padding:40px 20px 20px;border:1px solid rgba(255,255,255,.05);position:relative;color:#fff}
.scan-modal-close{position:absolute;top:16px;right:20px;background:none;border:0;color:rgba(255,255,255,.5);font-size:28px;cursor:pointer}
.scan-content{max-width:600px;margin:0 auto;padding:0 20px;text-align:center}
.scan-eyebrow{font-size:10px;letter-spacing:2.5px;color:rgba(255,255,255,.35);margin-bottom:12px}
.scan-content h1{font-size:28px;font-weight:700;color:#f0f0f0;margin:0 0 8px}
.scan-subtitle{color:rgba(255,255,255,.6);margin:0 0 25px;line-height:1.6}
.program-wrap{margin-bottom:20px}
.program-wrap label{font-weight:600;display:block;margin-bottom:8px;color:#f0f0f0}
.program-wrap input{padding:12px 16px;font-size:16px;border-radius:12px;border:1px solid rgba(255,255,255,.06);background:rgba(20,25,40,.8);color:#fff;width:100%;max-width:300px;text-align:center;outline:none}
.scan-tip{background:rgba(20,25,40,.9);border-radius:20px;border:1px solid rgba(255,255,255,.05);padding:14px 16px;margin-bottom:25px;text-align:left;font-size:14px;color:rgba(255,255,255,.6);line-height:1.5}
.scan-primary{border:0;padding:16px 36px;border-radius:30px;background:rgba(212,175,55,.95);color:#0A0F1A;font-weight:700;font-size:18px;cursor:pointer;transition:transform .15s,box-shadow .2s}
.scan-primary:hover{transform:translateY(-1px);box-shadow:0 8px 30px rgba(212,175,55,.18)}
.scan-primary.wide{width:100%;font-size:15px}
.scan-hint{font-size:12px;color:rgba(255,255,255,.3);margin-top:14px}
.scan-card{background:rgba(20,25,40,.9);border-radius:26px;border:1px solid rgba(255,255,255,.05);padding:24px;margin-top:20px}
.scan-processing{padding:30px}
.aria-orb{width:80px;height:80px;border-radius:50%;margin:0 auto 20px;background:radial-gradient(circle,rgba(212,175,55,.15) 0%,transparent 70%);animation:breathe 3s ease-in-out infinite;position:relative}
.aria-orb span{position:absolute;width:16px;height:16px;border-radius:50%;background:#D4AF37;top:50%;left:50%;transform:translate(-50%,-50%);box-shadow:0 0 20px rgba(212,175,55,.4);animation:pulse 2s ease-in-out infinite}
.aria-message{font-size:16px;margin:0 0 8px}
.elapsed,.leave-note{color:rgba(255,255,255,.4);font-size:13px}
.leave-note{font-size:12px;margin-top:8px;color:rgba(255,255,255,.3)}
.scan-result{text-align:left}
.result-title{font-size:24px;color:#D4AF37;margin-bottom:12px}
.result-total{color:#f0f0f0;font-size:18px;margin-bottom:16px}
.result-stats{display:flex;flex-direction:column;gap:6px;margin-bottom:20px;color:rgba(255,255,255,.65);font-size:15px}
.scan-result .aria-message{font-size:14px;margin-bottom:20px}
.scan-error{text-align:left}
.scan-error p{color:#EF4444;margin-bottom:12px}
.scan-secondary{border:1px solid rgba(255,255,255,.12);padding:10px 20px;border-radius:30px;background:rgba(255,255,255,.05);color:#fff;cursor:pointer}
@keyframes breathe{0%{transform:scale(.95);opacity:.8}50%{transform:scale(1.05);opacity:1}100%{transform:scale(.95);opacity:.8}}
@keyframes pulse{0%{transform:translate(-50%,-50%) scale(1);opacity:.8}50%{transform:translate(-50%,-50%) scale(1.4);opacity:1}100%{transform:translate(-50%,-50%) scale(1);opacity:.8}}
@media(max-width:520px){.scan-modal{border-radius:26px;padding:40px 12px 16px}.scan-content{padding:0 12px}.scan-content h1{font-size:26px}.scan-primary{width:100%;padding:15px 20px}}
`}</style>
</div>
</div>
  }

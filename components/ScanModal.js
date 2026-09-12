// components/ScanModal.js
import{useState,useRef,useEffect,useCallback}from'react'
import{createPortal}from'react-dom'
import{useRouter}from'next/router'
import{supabase}from'../lib/supabaseClient'
import{getScanState,setScanState,clearScanState}from'../lib/scanStore'
import{useOnboarding}from'./OnboardingProvider'

const MAX_IMAGE_BYTES=3500000
const MAX_DIMENSION=2200
const POLL_MS=1200
const normalizeName=value=>String(value||'').trim().replace(/\s+/g,' ').split(' ').map(part=>part?part.charAt(0).toUpperCase()+part.slice(1).toLowerCase():'').join(' ')
const messageForProgress=(progress,status)=>({queued:'ARIA is preparing the register…',enhancing:'ARIA is enhancing the image…',layout_analysis:'ARIA is reading the register structure…',reading_handwriting:'ARIA is reading the handwriting…',verifying_rows:'ARIA is checking the physical rows…',validating:'ARIA is validating the extracted records…',matching_community:'ARIA is comparing the register with the community…',building_memory:'ARIA is preparing the records for review…',retrying:'ARIA is retrying safely…'})[progress]||status==='pending'?'ARIA is preparing your scan…':'ARIA is working through the register…'

export default function ScanModal({isOpen,onClose}){
 const router=useRouter()
 const cameraInput=useRef(null),uploadInput=useRef(null),galleryInput=useRef(null),videoRef=useRef(null),streamRef=useRef(null),pollRef=useRef(null),pollingJob=useRef(null)
 const onboarding=useOnboarding()
 const[mounted,setMounted]=useState(false)
 const[programName,setProgramName]=useState('')
 const[scanState,setScanStateLocal]=useState(getScanState())
 const[progressMessage,setProgressMessage]=useState('')
 const[elapsedSeconds,setElapsedSeconds]=useState(0)
 const[completionTimestamp,setCompletionTimestamp]=useState(null)
 const[celebration,setCelebration]=useState(false)
 const[cameraOpen,setCameraOpen]=useState(false)
 const[cameraError,setCameraError]=useState('')

 useEffect(()=>{setMounted(true);return()=>setMounted(false)},[])
 const sync=useCallback(next=>{setScanState(next);setScanStateLocal(getScanState())},[])
 const stopPolling=useCallback(()=>{if(pollRef.current){clearInterval(pollRef.current);pollRef.current=null}pollingJob.current=null},[])
 const stopCamera=useCallback(()=>{if(streamRef.current){streamRef.current.getTracks().forEach(track=>track.stop());streamRef.current=null}if(videoRef.current)videoRef.current.srcObject=null},[])
 const startCamera=useCallback(async()=>{
  setCameraError('');stopCamera()
  try{
   if(typeof navigator==='undefined'||!navigator.mediaDevices?.getUserMedia)throw new Error('Live camera capture is not available in this browser.')
   const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}},audio:false})
   streamRef.current=stream
   if(videoRef.current){videoRef.current.srcObject=stream;await videoRef.current.play().catch(()=>{})}
  }catch(error){console.error('[SCAN] Camera error:',error);setCameraError(error?.message||'Camera access was unavailable. You can still choose an image below.');stopCamera()}
 },[stopCamera])
 const completeOnboarding=useCallback(async()=>{if(!onboarding?.enabled||onboarding.isExperienced('scan'))return;try{const{data:{session}}=await supabase.auth.getSession();if(!session)return;const r=await fetch('/api/onboarding',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({action:'experience_completed',experience:'scan'})});if(r.ok)onboarding.completeExperience('scan')}catch{}},[onboarding])
 const pollJob=useCallback(jobId=>{
  if(!jobId||pollingJob.current===jobId)return
  stopPolling();pollingJob.current=jobId
  const poll=async()=>{
   try{
    const{data:{session}}=await supabase.auth.getSession();if(!session)return
    const r=await fetch(`/api/scan/status?job_id=${encodeURIComponent(jobId)}`,{headers:{Authorization:`Bearer ${session.access_token}`},cache:'no-store'})
    const data=await r.json().catch(()=>({}));if(!r.ok)return
    setElapsedSeconds(Number(data.elapsed_seconds)||0)
    if(['pending','processing','retrying'].includes(data.status)){
     const msg=data.message||messageForProgress(data.progress,data.status);setProgressMessage(msg)
     sync({stage:'processing',jobId,scanningLine:true,progress:data.progress||'queued',message:msg});return
    }
    if(data.status==='complete'){
     stopPolling();const result=data.result||{},people=Array.isArray(result.people)?result.people:[],review=Array.isArray(result.needs_review)?result.needs_review:Array.isArray(result.review)?result.review:[]
     const total=Number(result.total_extracted??result.total_valid??people.length??0)
     const summary={total,newVisitors:Number(result.new_members||0),returning:Number(result.updated||0),duplicates:Array.isArray(result.duplicates)?result.duplicates.length:Number(result.duplicates||0),needsReview:Number(result.needs_review_count??review.length??0)}
     const normalizedPeople=people.map(row=>({...row,name:normalizeName(row.name)})),normalizedReview=review.map(row=>({...row,name:normalizeName(row.name)})),finalResult={...result,people:normalizedPeople,needs_review:normalizedReview}
     setCompletionTimestamp(new Date().toLocaleString());setElapsedSeconds(Number(data.elapsed_seconds)||0)
     sync({stage:'complete',jobId,summary,results:finalResult,revealedPeople:normalizedPeople,ariaMessages:Array.isArray(result.aria_messages)?result.aria_messages:[]})
     setCelebration(true);setTimeout(()=>setCelebration(false),750);completeOnboarding();return
    }
    if(data.status==='failed'){stopPolling();const msg=data.message||'ARIA could not complete this scan.';setProgressMessage(msg);sync({stage:'error',jobId,message:msg})}
   }catch(error){console.error('[SCAN] Polling error:',error)}
  }
  poll();pollRef.current=setInterval(poll,POLL_MS)
 },[completeOnboarding,stopPolling,sync])
 useEffect(()=>{if(!isOpen)return;const current=getScanState();setScanStateLocal(current);if(current.stage==='processing'&&current.jobId){setProgressMessage(current.message||'ARIA is continuing your scan…');pollJob(current.jobId)}return()=>stopPolling()},[isOpen,pollJob,stopPolling])
 useEffect(()=>{if(!isOpen||!mounted)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=previous}},[isOpen,mounted])
 useEffect(()=>{if(!isOpen)return;const handler=e=>{if(e.key==='Escape'&&scanState.stage!=='processing')onClose?.()};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler)},[isOpen,onClose,scanState.stage])
 useEffect(()=>{if(cameraOpen&&isOpen&&scanState.stage==='idle')startCamera();else stopCamera();return()=>stopCamera()},[cameraOpen,isOpen,scanState.stage,startCamera,stopCamera])
 const preprocessImage=useCallback(file=>new Promise((resolve,reject)=>{
  if(!file)return reject(new Error('No image selected.'))
  if(!file.type.startsWith('image/'))return reject(new Error('Please choose a photo or image of the register.'))
  const url=URL.createObjectURL(file),image=new Image()
  image.onload=async()=>{try{
   const longest=Math.max(image.naturalWidth,image.naturalHeight),scale=Math.min(1,MAX_DIMENSION/Math.max(1,longest)),width=Math.max(1,Math.round(image.naturalWidth*scale)),height=Math.max(1,Math.round(image.naturalHeight*scale)),canvas=document.createElement('canvas');canvas.width=width;canvas.height=height
   const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw new Error('Image processing is unavailable on this device.')
   ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(image,0,0,width,height)
   let blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.9));if(!blob)throw new Error('Could not prepare the image.')
   if(blob.size>MAX_IMAGE_BYTES)blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.76));if(!blob||blob.size>MAX_IMAGE_BYTES)throw new Error('This image is too large. Please retake the photo from a little farther away.')
   const reader=new FileReader();reader.onload=()=>{URL.revokeObjectURL(url);canvas.width=1;canvas.height=1;const base64=String(reader.result||'').split(',')[1];if(!base64||base64.length<100)reject(new Error('Image encoding failed.'));else resolve(base64)};reader.onerror=()=>reject(new Error('Could not read the prepared image.'));reader.readAsDataURL(blob)
  }catch(error){URL.revokeObjectURL(url);reject(error)}}
  image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Failed to load the selected image.'))};image.src=url
 }),[])
 const handleFile=useCallback(async file=>{
  if(!file||scanState.stage==='processing')return
  const name=normalizeName(programName);if(!name){setCameraError('Enter the event or program name before scanning.');setCameraOpen(false);return}
  stopCamera();setCameraOpen(false);sync({stage:'processing',scanningLine:true,progress:'enhancing',message:'ARIA is preparing the image…'});setProgressMessage('ARIA is preparing the image…');setElapsedSeconds(0)
  try{
   const image_base64=await preprocessImage(file),{data:{session}}=await supabase.auth.getSession();if(!session)throw new Error('You must be logged in to scan.')
   const r=await fetch('/api/scan/start',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({image_base64,program_name:name})}),data=await r.json().catch(()=>({}))
   if(!r.ok)throw new Error(data.error||'ARIA could not start the scan.');if(!data.job_id)throw new Error('ARIA did not return a scan job.')
   sync({stage:'processing',jobId:data.job_id,scanningLine:true,progress:data.progress||'queued',message:data.message||'ARIA is preparing to read the register…'});setProgressMessage(data.message||'ARIA is preparing to read the register…');pollJob(data.job_id)
  }catch(error){stopPolling();sync({stage:'error',message:error.message||'Failed to start scan.'});setProgressMessage(error.message||'Failed to start scan.')}
 },[pollJob,preprocessImage,programName,scanState.stage,stopCamera,stopPolling,sync])
 const handleFileInput=useCallback(e=>{const file=e.target.files?.[0];e.target.value='';if(file)handleFile(file)},[handleFile])
 const snapAndScan=useCallback(()=>{
  if(!videoRef.current||scanState.stage==='processing')return
  const name=normalizeName(programName);if(!name){setCameraError('Enter the event or program name before scanning.');return}
  const video=videoRef.current;if(!video.videoWidth||!video.videoHeight){setCameraError('Camera is still starting. Hold on for a moment and try again.');return}
  const canvas=document.createElement('canvas'),scale=Math.min(1,MAX_DIMENSION/Math.max(video.videoWidth,video.videoHeight));canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale))
  const ctx=canvas.getContext('2d',{alpha:false});if(!ctx){setCameraError('Camera capture is unavailable on this device.');return};ctx.drawImage(video,0,0,canvas.width,canvas.height)
  canvas.toBlob(blob=>{if(!blob){setCameraError('The photo could not be captured. Please try again.');return}handleFile(new File([blob],`nyeocare-scan-${Date.now()}.jpg`,{type:'image/jpeg'}))},'image/jpeg',.9)
 },[handleFile,programName,scanState.stage])
 if(!isOpen||!mounted)return null
 const close=()=>{if(scanState.stage==='processing')return;stopPolling();stopCamera();setCameraOpen(false);clearScanState();setScanStateLocal(getScanState());setProgressMessage('');onClose?.()}
 const reset=()=>{stopPolling();stopCamera();setCameraOpen(false);clearScanState();setScanStateLocal(getScanState());setProgressMessage('');setElapsedSeconds(0);setCompletionTimestamp(null);setCelebration(false);setCameraError('')}
 const openCamera=()=>{if(!normalizeName(programName)){setCameraError('Enter the event or program name first.');return}setCameraError('');setCameraOpen(true)}
 const{stage,summary,message}=scanState,result=scanState.results||{},count=summary?.total??result.total_extracted??result.total_valid??result.people?.length??0,reviewCount=summary?.needsReview??result.needs_review?.length??0
 const phases={queued:['Preparing',8],enhancing:['Preparing image',18],layout_analysis:['Reading structure',32],reading_handwriting:['Reading handwriting',52],verifying_rows:['Checking rows',68],validating:['Validating extraction',80],matching_community:['Comparing community',90],building_memory:['Preparing review',97],retrying:['Retrying safely',68]},phase=phases[scanState.progress]||phases.queued
 const content=<div style={styles.overlay} onMouseDown={e=>{if(e.target===e.currentTarget&&stage!=='processing')close()}}><div style={styles.modal} role="dialog" aria-modal="true" aria-label="NYEOCARE Scan" onMouseDown={e=>e.stopPropagation()}><button style={styles.close} onClick={close} disabled={stage==='processing'} aria-label="Close">×</button><div style={styles.inner}><div style={styles.eyebrow}>NYEOCARE · SCAN</div>
 {stage==='idle'&&!cameraOpen&&<><h2 style={styles.title}>Remember people.</h2><p style={styles.sub}>Tell NYEOCARE what this register is for, then open the camera to scan it.</p><div style={styles.idle}><input value={programName} onChange={e=>{setProgramName(e.target.value);setCameraError('')}} placeholder="Event or program name" autoComplete="off" style={styles.input}/><button style={styles.capture} onClick={openCamera}>Open camera</button>{cameraError&&<div style={styles.cameraError}>{cameraError}</div>}<div style={styles.hint}>You choose the event name. NYEOCARE never pre-fills it for you.</div></div></>}
 {stage==='idle'&&cameraOpen&&<div style={styles.cameraPage}><div style={styles.cameraTop}><button style={styles.back} onClick={()=>{stopCamera();setCameraOpen(false);setCameraError('')}}>‹</button><div style={styles.cameraTopText}><strong>Scan register</strong><span>{normalizeName(programName)}</span></div><span style={styles.cameraDot}/></div><div style={styles.previewWrap}><video ref={videoRef} playsInline muted autoPlay style={styles.video}/><div style={styles.frame}><i/><i/><i/><i/></div>{cameraError&&<div style={styles.cameraOverlay}>{cameraError}</div>}</div><div style={styles.cameraActions}><button style={styles.cameraOption} onClick={()=>uploadInput.current?.click()}><span>↑</span>Upload</button><button style={styles.shutter} onClick={snapAndScan} aria-label="Snap and scan"><span style={styles.shutterInner}/></button><button style={styles.cameraOption} onClick={()=>galleryInput.current?.click()}><span>▣</span>Gallery</button></div><input ref={uploadInput} type="file" accept="image/*,.png,.jpg,.jpeg,.webp" hidden onChange={handleFileInput}/><input ref={galleryInput} type="file" accept="image/*" hidden onChange={handleFileInput}/><input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={handleFileInput}/><div style={styles.cameraHint}>Fit the complete register inside the frame. Snap & scan sends the photo directly to ARIA.</div>{typeof navigator!=='undefined'&&!navigator.mediaDevices?.getUserMedia&&<button style={styles.fallback} onClick={()=>cameraInput.current?.click()}>Use device camera</button>}</div>}
 {stage==='processing'&&<div style={styles.status}><div style={styles.pulse}>✦</div><strong style={styles.statusTitle}>{progressMessage||phase[0]}</strong><div style={styles.progressTrack}><div style={{...styles.progress,width:`${phase[1]}%`}}/></div><div style={styles.phase}>{phase[0]}</div><span style={styles.meta}>{elapsedSeconds}s · ARIA is extracting first, deciding later</span></div>}
 {stage==='complete'&&<div style={{...styles.result,animation:celebration?'ariaCelebrate .75s ease-out':'none'}}><div style={styles.success}>✓ Register remembered.</div><strong>{count} {Number(count)===1?'person':'people'} processed.</strong><span style={styles.resultText}>{reviewCount?`${reviewCount} ${reviewCount===1?'row was':'rows were'} preserved in Review Center rather than guessed.`:'ARIA completed the extraction without needing additional review.'}</span><button style={styles.secondary} onClick={reset}>Scan another</button>{reviewCount>0&&<button style={styles.primary} onClick={()=>router.push('/review')}>Review {reviewCount} {reviewCount===1?'record':'records'}</button>}<button style={styles.secondary} onClick={()=>router.push('/people')}>View community</button>{completionTimestamp&&<span style={styles.meta}>{completionTimestamp} · {elapsedSeconds}s</span>}</div>}
 {stage==='error'&&<div style={styles.result}><div style={styles.error}>Scan not completed.</div><span style={styles.resultText}>{message||'ARIA stopped safely. No uncertain records were discarded.'}</span><button style={styles.secondary} onClick={reset}>Try again</button></div>}
 </div></div><style jsx>{`@keyframes ariaPulse{0%,100%{transform:scale(1);opacity:.7}50%{transform:scale(1.08);opacity:1}}@keyframes ariaCelebrate{0%{transform:scale(.97);opacity:.7}100%{transform:scale(1);opacity:1}}`}</style></div>
 return createPortal(content,document.body)
}

const styles={overlay:{position:'fixed',inset:0,zIndex:100000,display:'grid',placeItems:'center',padding:14,background:'rgba(2,6,16,.68)',backdropFilter:'blur(16px)',WebkitBackdropFilter:'blur(16px)'},modal:{position:'relative',width:'min(580px,calc(100vw - 28px))',height:'75vh',maxHeight:'75vh',overflowY:'auto',boxSizing:'border-box',borderRadius:30,background:'linear-gradient(145deg,rgba(16,27,55,.98),rgba(7,14,32,.98))',border:'1px solid rgba(255,255,255,.11)',boxShadow:'0 30px 100px rgba(0,0,0,.55)',color:'#fff'},close:{position:'absolute',top:14,right:14,width:38,height:38,borderRadius:'50%',border:'1px solid rgba(255,255,255,.1)',background:'rgba(255,255,255,.06)',color:'rgba(255,255,255,.8)',fontSize:25,lineHeight:1,cursor:'pointer',zIndex:5},inner:{minHeight:'100%',maxWidth:500,margin:'0 auto',padding:'48px 24px 34px',boxSizing:'border-box',display:'flex',flexDirection:'column',justifyContent:'center',textAlign:'center'},eyebrow:{fontSize:10,letterSpacing:2.5,color:'rgba(255,255,255,.35)',marginBottom:10},title:{fontSize:'clamp(27px,7vw,38px)',lineHeight:1.05,letterSpacing:-1.2,margin:'0 0 12px'},sub:{margin:'0 auto',maxWidth:440,color:'rgba(255,255,255,.45)',lineHeight:1.6,fontSize:14},idle:{marginTop:20},input:{width:'100%',boxSizing:'border-box',padding:'14px 16px',margin:'22px 0 14px',borderRadius:15,border:'1px solid rgba(255,255,255,.1)',background:'rgba(255,255,255,.04)',color:'#fff',outline:'none',fontSize:15},capture:{display:'block',width:'100%',boxSizing:'border-box',padding:'15px 24px',border:0,borderRadius:999,background:'#f4f4f4',color:'#07101e',fontWeight:700,cursor:'pointer',fontSize:14},primary:{display:'block',width:'100%',margin:'10px auto 0',padding:'12px 18px',border:0,borderRadius:999,background:'#f4f4f4',color:'#07101e',fontWeight:700,cursor:'pointer',fontSize:13},secondary:{display:'block',margin:'10px auto 0',padding:'11px 18px',borderRadius:999,border:'1px solid rgba(255,255,255,.12)',background:'rgba(255,255,255,.05)',color:'#fff',cursor:'pointer',fontSize:13},hint:{fontSize:12,color:'rgba(255,255,255,.3)',marginTop:14,lineHeight:1.5},cameraError:{marginTop:12,color:'#ffb1b1',fontSize:12,lineHeight:1.45},cameraPage:{display:'flex',flexDirection:'column',gap:14,minHeight:'62vh'},cameraTop:{display:'flex',alignItems:'center',gap:12,textAlign:'left',padding:'4px 2px 10px'},back:{width:38,height:38,borderRadius:'50%',border:'1px solid rgba(255,255,255,.1)',background:'rgba(255,255,255,.06)',color:'#fff',fontSize:28,lineHeight:1,cursor:'pointer'},cameraTopText:{display:'grid',gap:2},cameraDot:{marginLeft:'auto',width:8,height:8,borderRadius:'50%',background:'#8fd7b4',boxShadow:'0 0 14px rgba(143,215,180,.6)'},previewWrap:{position:'relative',width:'100%',height:'min(52vh,520px)',minHeight:320,overflow:'hidden',borderRadius:24,background:'#020711',border:'1px solid rgba(255,255,255,.1)'},video:{width:'100%',height:'100%',objectFit:'cover',display:'block'},frame:{position:'absolute',inset:'9%',border:'1px solid rgba(255,255,255,.65)',borderRadius:18,pointerEvents:'none'},cameraOverlay:{position:'absolute',left:14,right:14,bottom:14,padding:'11px 13px',borderRadius:14,background:'rgba(2,7,17,.82)',color:'#ffd0d0',fontSize:12,lineHeight:1.4},cameraActions:{display:'grid',gridTemplateColumns:'1fr auto 1fr',alignItems:'center',gap:12},cameraOption:{border:0,background:'transparent',color:'rgba(255,255,255,.78)',fontSize:12,cursor:'pointer',display:'grid',justifyItems:'center',gap:5},shutter:{width:76,height:76,borderRadius:'50%',border:'5px solid rgba(255,255,255,.9)',background:'transparent',display:'grid',placeItems:'center',cursor:'pointer',boxShadow:'0 0 0 7px rgba(255,255,255,.08)'},shutterInner:{width:56,height:56,borderRadius:'50%',background:'#fff'},cameraHint:{fontSize:11,color:'rgba(255,255,255,.35)',lineHeight:1.45},fallback:{alignSelf:'center',border:'1px solid rgba(255,255,255,.12)',borderRadius:999,padding:'10px 16px',background:'rgba(255,255,255,.05)',color:'#fff',cursor:'pointer'},status:{marginTop:28,padding:28,borderRadius:25,background:'rgba(255,255,255,.035)',display:'grid',gap:12,justifyItems:'center'},pulse:{width:68,height:68,borderRadius:'50%',display:'grid',placeItems:'center',background:'rgba(212,175,55,.1)',border:'1px solid rgba(212,175,55,.3)',color:'#d4af37',fontSize:22,animation:'ariaPulse 2s ease-in-out infinite'},statusTitle:{fontSize:14,minHeight:20},phase:{fontSize:12,color:'rgba(255,255,255,.55)'},progressTrack:{width:'100%',height:5,borderRadius:999,background:'rgba(255,255,255,.08)',overflow:'hidden'},progress:{height:'100%',borderRadius:999,background:'#d4af37',transition:'width .8s ease'},meta:{fontSize:11,color:'rgba(255,255,255,.3)',lineHeight:1.5},result:{marginTop:28,padding:26,borderRadius:25,background:'rgba(255,255,255,.035)',display:'grid',gap:12},success:{color:'#8fd7b4',fontSize:18},error:{color:'#ff9d9d',fontSize:18},resultText:{fontSize:13,color:'rgba(255,255,255,.55)',lineHeight:1.55}}

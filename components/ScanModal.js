// components/ScanModal.js
import{useState,useRef,useEffect,useCallback}from'react'
import{createPortal}from'react-dom'
import{useRouter}from'next/router'
import{supabase}from'../lib/supabaseClient'
import{getScanState,setScanState,clearScanState}from'../lib/scanStore'
import{useOnboarding}from'./OnboardingProvider'

export default function ScanModal({isOpen,onClose}){
 const router=useRouter()
 const cameraInput=useRef(null),uploadInput=useRef(null),pollRef=useRef(null)
 const onboarding=useOnboarding()
 const[mounted,setMounted]=useState(false)
 const[programName,setProgramName]=useState('GIBEON')
 const[scanState,setScanStateLocal]=useState(getScanState())
 const[progressMessage,setProgressMessage]=useState('')
 const[elapsedSeconds,setElapsedSeconds]=useState(0)
 const[completionTimestamp,setCompletionTimestamp]=useState(null)
 const[celebration,setCelebration]=useState(false)

 useEffect(()=>{setMounted(true);return()=>setMounted(false)},[])
 const updateState=useCallback(next=>{setScanState(next);setScanStateLocal(getScanState())},[])
 const stopPolling=useCallback(()=>{if(pollRef.current){clearInterval(pollRef.current);pollRef.current=null}},[])
 const completeScanOnboarding=useCallback(async()=>{
  if(!onboarding?.enabled||onboarding.isExperienced('scan'))return
  try{
   const{data:{session}}=await supabase.auth.getSession()
   if(!session)return
   const response=await fetch('/api/onboarding',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({action:'experience_completed',experience:'scan'})})
   if(response.ok)onboarding.completeExperience('scan')
  }catch(error){console.error('[ONBOARDING] Scan completion error:',error)}
 },[onboarding])
 const startPolling=useCallback(jobId=>{
  stopPolling()
  const poll=async()=>{
   try{
    const{data:{session}}=await supabase.auth.getSession()
    if(!session)return
    const response=await fetch(`/api/scan/status?job_id=${encodeURIComponent(jobId)}`,{headers:{Authorization:`Bearer ${session.access_token}`}})
    const data=await response.json()
    if(!response.ok)return
    setElapsedSeconds(Number(data.elapsed_seconds)||0)
    if(['processing','pending','retrying'].includes(data.status)){
     setProgressMessage(data.message||'ARIA is working…')
     updateState({stage:'processing',jobId,scanningLine:true,progress:data.progress,message:data.message||''})
    }else if(data.status==='complete'){
     stopPolling()
     const result=data.result||{},total=result.total_extracted??result.total_valid??result.people?.length??0
     const summary={total,newVisitors:result.new_members||0,returning:result.updated||0,duplicates:result.duplicates?.length||0,needsReview:result.needs_review?.length||0}
     setElapsedSeconds(Number(data.elapsed_seconds)||0)
     setCompletionTimestamp(new Date().toLocaleString())
     updateState({stage:'complete',jobId,summary,results:result})
     setCelebration(true)
     setTimeout(()=>setCelebration(false),700)
     completeScanOnboarding()
    }else if(data.status==='failed'){
     stopPolling()
     setProgressMessage(data.message||'ARIA could not complete this scan.')
     updateState({stage:'error',jobId,message:data.message||'ARIA could not complete this scan.'})
    }
   }catch(error){console.error('[SCAN] Polling error:',error)}
  }
  poll()
  pollRef.current=setInterval(poll,1250)
 },[stopPolling,updateState,completeScanOnboarding])
 useEffect(()=>{
  if(!isOpen)return
  const current=getScanState()
  setScanStateLocal(current)
  if(current.stage==='processing'&&current.jobId){setProgressMessage(current.message||'ARIA is continuing your scan…');startPolling(current.jobId)}
  return()=>stopPolling()
 },[isOpen,startPolling,stopPolling])
 useEffect(()=>{
  if(!isOpen||!mounted)return
  const previous=document.body.style.overflow
  document.body.style.overflow='hidden'
  return()=>{document.body.style.overflow=previous}
 },[isOpen,mounted])
 useEffect(()=>{
  if(!isOpen)return
  const handler=e=>{if(e.key==='Escape'&&scanState.stage!=='processing')onClose?.()}
  window.addEventListener('keydown',handler)
  return()=>window.removeEventListener('keydown',handler)
 },[isOpen,onClose,scanState.stage])
 const preprocessImage=useCallback(file=>new Promise((resolve,reject)=>{
  if(!file)return reject(new Error('No image selected.'))
  const url=URL.createObjectURL(file),image=new Image()
  image.onload=async()=>{
   try{
    const max=1600,scale=Math.min(1,max/Math.max(image.naturalWidth,image.naturalHeight)),width=Math.max(1,Math.round(image.naturalWidth*scale)),height=Math.max(1,Math.round(image.naturalHeight*scale)),canvas=document.createElement('canvas')
    canvas.width=width;canvas.height=height
    const context=canvas.getContext('2d',{alpha:false})
    if(!context)throw new Error('Image processing is unavailable on this device.')
    context.drawImage(image,0,0,width,height)
    let blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.82))
    if(!blob)throw new Error('Could not prepare the image.')
    if(blob.size>3500000)blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.68))
    if(!blob||blob.size>3500000)throw new Error('The image is too large. Please retake the photo from a little farther away.')
    const reader=new FileReader()
    reader.onload=()=>{URL.revokeObjectURL(url);canvas.width=1;canvas.height=1;const base64=String(reader.result).split(',')[1];if(!base64||base64.length<100)reject(new Error('Image encoding failed.'));else resolve(base64)}
    reader.onerror=()=>reject(new Error('Could not read the prepared image.'))
    reader.readAsDataURL(blob)
   }catch(error){URL.revokeObjectURL(url);reject(error)}
  }
  image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Failed to load image.'))}
  image.src=url
 }),[])
 const handleFile=useCallback(async file=>{
  if(!file||scanState.stage==='processing')return
  updateState({stage:'processing',scanningLine:true,progress:'enhancing'})
  setProgressMessage('ARIA is preparing the image…')
  setElapsedSeconds(0)
  let image_base64
  try{image_base64=await preprocessImage(file)}catch(error){updateState({stage:'error',message:error.message||'Failed to process image.'});return}
  try{
   const{data:{session}}=await supabase.auth.getSession()
   if(!session){updateState({stage:'error',message:'You must be logged in to scan.'});return}
   const response=await fetch('/api/scan/start',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({image_base64,program_name:programName.trim()||'GIBEON'})})
   const data=await response.json()
   if(!response.ok)throw new Error(data.error||'ARIA could not start the scan.')
   if(!data.job_id)throw new Error('ARIA did not return a scan job.')
   updateState({stage:'processing',jobId:data.job_id,scanningLine:true,progress:'queued'})
   setProgressMessage('ARIA is preparing to read the register…')
   startPolling(data.job_id)
  }catch(error){updateState({stage:'error',message:error.message||'Failed to start scan.'})}
 },[programName,preprocessImage,startPolling,scanState.stage,updateState])
 const handleFileInput=useCallback(event=>{const file=event.target.files?.[0];event.target.value='';if(file)handleFile(file)},[handleFile])
 if(!isOpen||!mounted)return null
 const close=()=>{if(scanState.stage==='processing')return;stopPolling();clearScanState();setScanStateLocal(getScanState());onClose?.()}
 const{stage,summary,message}=scanState,result=scanState.results||{},count=summary?.total??result.total_extracted??result.total_valid??result.people?.length??null
 const phases={queued:['Preparing',8],enhancing:['Preparing image',15],layout_analysis:['Examining register structure',28],reading_handwriting:['Reviewing handwriting',48],verifying_rows:['Verifying physical rows',68],validating:['Validating records',80],matching_community:['Comparing community',90],building_memory:['Remembering verified people',97],retrying:['Waiting for safe provider capacity',68]}
 const phase=phases[scanState.progress]||phases.queued
 const content=<div style={styles.overlay} onMouseDown={e=>{if(e.target===e.currentTarget&&stage!=='processing')close()}}>
  <div style={styles.modal} role="dialog" aria-modal="true" aria-label="ARIA Scan" onMouseDown={e=>e.stopPropagation()}>
   <button style={styles.close} onClick={close} disabled={stage==='processing'} aria-label="Close">×</button>
   <div style={styles.inner}>
    <div style={styles.eyebrow}>ARIA · SCAN</div>
    <h2 style={styles.title}>Remember people.</h2>
    <p style={styles.sub}>ARIA reads the register, verifies the physical rows, and saves only what it can safely confirm.</p>
    {stage==='idle'&&<div style={styles.idle}>
     <input value={programName} onChange={e=>setProgramName(e.target.value)} placeholder="Program name" style={styles.input}/>
     <label style={styles.capture}>Take photo<input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={handleFileInput}/></label>
     <button style={styles.secondary} onClick={()=>uploadInput.current?.click()}>Upload image</button>
     <input ref={uploadInput} type="file" accept="image/*,.png,.jpg,.jpeg,.webp" hidden onChange={handleFileInput}/>
     <div style={styles.hint}>Use one clear photo showing the complete register.</div>
    </div>}
    {stage==='processing'&&<div style={styles.status}>
     <div style={styles.pulse}>✦</div>
     <strong style={styles.statusTitle}>{progressMessage||phase[0]}</strong>
     <div style={styles.progressTrack}><div style={{...styles.progress,width:`${phase[1]}%`}}/></div>
     <div style={styles.phase}>{phase[0]}</div>
     <span style={styles.meta}>{elapsedSeconds}s · server time · nothing is saved until verification finishes</span>
    </div>}
    {stage==='complete'&&<div style={{...styles.result,animation:celebration?'ariaCelebrate .7s ease-out':'none'}}>
     <div style={styles.success}>✓ Register remembered.</div>
     <strong>{count!=null?`${count} ${Number(count)===1?'person':'people'} processed.`:'Your register has been processed.'}</strong>
     <span style={styles.resultText}>{summary?.needsReview?`${summary.needsReview} row${summary.needsReview===1?'':'s'} held for human review instead of being guessed.`:'ARIA safely verified the register.'}</span>
     <button style={styles.secondary} onClick={()=>{clearScanState();setScanStateLocal(getScanState());setCelebration(false)}}>Scan another</button>
     <button style={styles.secondary} onClick={()=>router.push('/people')}>View community</button>
     {completionTimestamp&&<span style={styles.meta}>{completionTimestamp} · {elapsedSeconds}s</span>}
    </div>}
    {stage==='error'&&<div style={styles.result}>
     <div style={styles.error}>Scan not completed.</div>
     <span style={styles.resultText}>{message||'ARIA stopped safely. No uncertain records were saved.'}</span>
     <button style={styles.secondary} onClick={()=>{clearScanState();setScanStateLocal(getScanState());setProgressMessage('')}}>Try again</button>
    </div>}
   </div>
  </div>
  <style jsx>{`@keyframes ariaPulse{0%,100%{transform:scale(1);opacity:.7}50%{transform:scale(1.08);opacity:1}}@keyframes ariaCelebrate{0%{transform:scale(.97);opacity:.7}100%{transform:scale(1);opacity:1}}`}</style>
 </div>
 return createPortal(content,document.body)
}

const styles={
 overlay:{position:'fixed',inset:0,zIndex:100000,display:'grid',placeItems:'center',padding:'14px',background:'rgba(2,6,16,.68)',backdropFilter:'blur(16px)',WebkitBackdropFilter:'blur(16px)'},
 modal:{position:'relative',width:'min(580px,calc(100vw - 28px))',height:'75vh',maxHeight:'75vh',overflowY:'auto',boxSizing:'border-box',borderRadius:30,background:'linear-gradient(145deg,rgba(16,27,55,.98),rgba(7,14,32,.98))',border:'1px solid rgba(255,255,255,.11)',boxShadow:'0 30px 100px rgba(0,0,0,.55)',color:'#fff'},
 close:{position:'absolute',top:14,right:14,width:38,height:38,borderRadius:'50%',border:'1px solid rgba(255,255,255,.1)',background:'rgba(255,255,255,.06)',color:'rgba(255,255,255,.8)',fontSize:25,lineHeight:1,cursor:'pointer',zIndex:5},
 inner:{minHeight:'100%',maxWidth:500,margin:'0 auto',padding:'48px 24px 34px',boxSizing:'border-box',display:'flex',flexDirection:'column',justifyContent:'center',textAlign:'center'},
 eyebrow:{fontSize:10,letterSpacing:2.5,color:'rgba(255,255,255,.35)',marginBottom:10},
 title:{fontSize:'clamp(27px,7vw,38px)',lineHeight:1.05,letterSpacing:-1.2,margin:'0 0 12px'},
 sub:{margin:'0 auto',maxWidth:430,color:'rgba(255,255,255,.45)',lineHeight:1.6,fontSize:14},
 idle:{marginTop:20},
 input:{width:'100%',boxSizing:'border-box',padding:'14px 16px',margin:'22px 0 14px',borderRadius:15,border:'1px solid rgba(255,255,255,.1)',background:'rgba(255,255,255,.04)',color:'#fff',outline:'none',fontSize:15},
 capture:{display:'inline-block',padding:'15px 24px',borderRadius:999,background:'#f4f4f4',color:'#07101e',fontWeight:700,cursor:'pointer',fontSize:14},
 secondary:{display:'block',margin:'10px auto 0',padding:'11px 18px',borderRadius:999,border:'1px solid rgba(255,255,255,.12)',background:'rgba(255,255,255,.05)',color:'#fff',cursor:'pointer',fontSize:13},
 hint:{fontSize:12,color:'rgba(255,255,255,.3)',marginTop:14,lineHeight:1.5},
 status:{marginTop:28,padding:28,borderRadius:25,background:'rgba(255,255,255,.035)',display:'grid',gap:12,justifyItems:'center'},
 pulse:{width:68,height:68,borderRadius:'50%',display:'grid',placeItems:'center',background:'rgba(212,175,55,.1)',border:'1px solid rgba(212,175,55,.3)',color:'#d4af37',fontSize:22,animation:'ariaPulse 2s ease-in-out infinite'},
 statusTitle:{fontSize:14,minHeight:20},
 phase:{fontSize:12,color:'rgba(255,255,255,.55)'},
 progressTrack:{width:'100%',height:5,borderRadius:999,background:'rgba(255,255,255,.08)',overflow:'hidden'},
 progress:{height:'100%',borderRadius:999,background:'#d4af37',transition:'width .8s ease'},
 meta:{fontSize:11,color:'rgba(255,255,255,.3)',lineHeight:1.5},
 result:{marginTop:28,padding:26,borderRadius:25,background:'rgba(255,255,255,.035)',display:'grid',gap:12},
 success:{color:'#8fd7b4',fontSize:18},
 error:{color:'#ff9d9d',fontSize:18},
 resultText:{color:'rgba(255,255,255,.45)',fontSize:13,lineHeight:1.5}
  }

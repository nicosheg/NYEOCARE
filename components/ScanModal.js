// components/ScanModal.js
import{useState,useRef,useEffect,useCallback}from'react'
import{createPortal}from'react-dom'
import{useRouter}from'next/router'
import{supabase}from'../lib/supabaseClient'
import{getScanState,setScanState,clearScanState}from'../lib/scanStore'
import{useOnboarding}from'./OnboardingProvider'

export default function ScanModal({isOpen,onClose}){
 const router=useRouter()
 const cameraInput=useRef(null),uploadInput=useRef(null),pollRef=useRef(null),timerRef=useRef(null)
 const onboarding=useOnboarding()
 const [mounted,setMounted]=useState(false)
 const [programName,setProgramName]=useState('GIBEON')
 const [scanState,setScanStateLocal]=useState(getScanState())
 const [progressMessage,setProgressMessage]=useState('')
 const [elapsedSeconds,setElapsedSeconds]=useState(0)
 const [completionTimestamp,setCompletionTimestamp]=useState(null)
 const [celebration,setCelebration]=useState(false)

 useEffect(()=>{
  setMounted(true)
  return()=>setMounted(false)
 },[])

 const syncState=useCallback(()=>setScanStateLocal(getScanState()),[])

 const updateState=useCallback(next=>{
  setScanState(next)
  setScanStateLocal(getScanState())
 },[])

 const stopPolling=useCallback(()=>{
  if(pollRef.current){clearInterval(pollRef.current);pollRef.current=null}
  if(timerRef.current){clearInterval(timerRef.current);timerRef.current=null}
 },[])

 const completeScanOnboarding=useCallback(async()=>{
  if(!onboarding?.enabled||onboarding.isExperienced('scan'))return
  try{
   const{data:{session}}=await supabase.auth.getSession()
   if(!session)return
   const response=await fetch('/api/onboarding',{
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
    body:JSON.stringify({action:'experience_completed',experience:'scan'})
   })
   if(response.ok)onboarding.completeExperience('scan')
  }catch(error){console.error('[ONBOARDING] Scan completion error:',error)}
 },[onboarding])

 const startPolling=useCallback(jobId=>{
  stopPolling()
  let seconds=0
  setElapsedSeconds(0)
  timerRef.current=setInterval(()=>{
   seconds++
   setElapsedSeconds(seconds)
  },1000)
  pollRef.current=setInterval(async()=>{
   try{
    const{data:{session}}=await supabase.auth.getSession()
    if(!session)return
    const response=await fetch(`/api/scan/status?job_id=${encodeURIComponent(jobId)}`,{
     headers:{Authorization:`Bearer ${session.access_token}`}
    })
    const data=await response.json()
    if(!response.ok)return
    if(data.status==='processing'||data.status==='pending'||data.status==='retrying'){
     const messages={
      enhancing:'ARIA is enhancing the image clarity…',
      reading_handwriting:'ARIA is reading the handwriting…',
      validating:'ARIA is validating the extracted data…',
      matching_community:'ARIA is comparing with your community…',
      building_memory:'ARIA is saving the verified records…',
      retrying:'ARIA is taking a little longer than usual…'
     }
     setProgressMessage(messages[data.progress]||data.message||'ARIA is working…')
     updateState({stage:'processing',jobId,scanningLine:true})
    }else if(data.status==='complete'){
     stopPolling()
     const result=data.result||{}
     const total=result.total_extracted??result.total_valid??result.people?.length??0
     const summary={
      total,
      newVisitors:result.new_members||0,
      returning:result.updated||0,
      duplicates:result.duplicates?.length||0,
      needsReview:result.needs_review?.length||0
     }
     setCompletionTimestamp(new Date().toLocaleString())
     updateState({stage:'complete',jobId,summary})
     setCelebration(true)
     setTimeout(()=>setCelebration(false),700)
     completeScanOnboarding()
    }else if(data.status==='failed'){
     stopPolling()
     updateState({stage:'error',jobId,message:data.message||'ARIA could not complete this scan.'})
    }
   }catch(error){console.error('[SCAN] Polling error:',error)}
  },1500)
 },[stopPolling,updateState,completeScanOnboarding])

 useEffect(()=>{
  if(!isOpen)return
  const current=getScanState()
  setScanStateLocal(current)
  if(current.stage==='processing'&&current.jobId){
   setProgressMessage('ARIA is continuing your scan…')
   startPolling(current.jobId)
  }
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
  const handler=e=>{
   if(e.key==='Escape'&&scanState.stage!=='processing')onClose?.()
  }
  window.addEventListener('keydown',handler)
  return()=>window.removeEventListener('keydown',handler)
 },[isOpen,onClose,scanState.stage])

 const preprocessImage=useCallback(file=>new Promise((resolve,reject)=>{
  if(!file)return reject(new Error('No image selected.'))
  const url=URL.createObjectURL(file)
  const image=new Image()
  image.onload=async()=>{
   try{
    const max=1600
    const scale=Math.min(1,max/Math.max(image.naturalWidth,image.naturalHeight))
    const width=Math.max(1,Math.round(image.naturalWidth*scale))
    const height=Math.max(1,Math.round(image.naturalHeight*scale))
    const canvas=document.createElement('canvas')
    canvas.width=width
    canvas.height=height
    const context=canvas.getContext('2d',{alpha:false})
    if(!context)throw new Error('Image processing is unavailable on this device.')
    context.drawImage(image,0,0,width,height)
    let blob=await new Promise(resolveBlob=>canvas.toBlob(resolveBlob,'image/jpeg',.82))
    if(!blob)throw new Error('Could not prepare the image.')
    if(blob.size>3500000)blob=await new Promise(resolveBlob=>canvas.toBlob(resolveBlob,'image/jpeg',.68))
    if(!blob||blob.size>3500000)throw new Error('The image is too large. Please retake the photo from a little farther away.')
    const reader=new FileReader()
    reader.onload=()=>{
     URL.revokeObjectURL(url)
     canvas.width=1
     canvas.height=1
     const base64=String(reader.result).split(',')[1]
     if(!base64||base64.length<100)reject(new Error('Image encoding failed.'))
     else resolve(base64)
    }
    reader.onerror=()=>reject(new Error('Could not read the prepared image.'))
    reader.readAsDataURL(blob)
   }catch(error){
    URL.revokeObjectURL(url)
    reject(error)
   }
  }
  image.onerror=()=>{
   URL.revokeObjectURL(url)
   reject(new Error('Failed to load image.'))
  }
  image.src=url
 }),[])

 const handleFile=useCallback(async file=>{
  if(!file||scanState.stage==='processing')return
  updateState({stage:'processing',scanningLine:true})
  setProgressMessage('ARIA is preparing the image…')
  setElapsedSeconds(0)
  let image_base64
  try{
   image_base64=await preprocessImage(file)
  }catch(error){
   console.error('[SCAN] Image preprocessing error:',error)
   updateState({stage:'error',message:error.message||'Failed to process image.'})
   return
  }
  try{
   const{data:{session}}=await supabase.auth.getSession()
   if(!session){
    updateState({stage:'error',message:'You must be logged in to scan.'})
    return
   }
   const response=await fetch('/api/scan/start',{
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
    body:JSON.stringify({image_base64,program_name:programName.trim()||'GIBEON'})
   })
   const data=await response.json()
   if(!response.ok)throw new Error(data.error||'ARIA could not start the scan.')
   if(!data.job_id)throw new Error('ARIA did not return a scan job.')
   updateState({stage:'processing',jobId:data.job_id,scanningLine:true})
   setProgressMessage('ARIA is reading the register…')
   startPolling(data.job_id)
  }catch(error){
   console.error('[SCAN] Start error:',error)
   updateState({stage:'error',message:error.message||'Failed to start scan.'})
  }
 },[programName,preprocessImage,startPolling,scanState.stage,updateState])

 const handleFileInput=useCallback(event=>{
  const file=event.target.files?.[0]
  event.target.value=''
  if(file)handleFile(file)
 },[handleFile])

 if(!isOpen||!mounted)return null

 const close=()=>{
  if(scanState.stage==='processing')return
  stopPolling()
  clearScanState()
  setScanStateLocal(getScanState())
  onClose?.()
 }

 const{stage,summary,message}=scanState
 const result=scanState.results||{}
 const count=summary?.total??result.total_extracted??result.total_valid??result.people?.length??null
 const messages={
  preparing:'Preparing your register…',
  enhancing:'Enhancing the image…',
  reading_handwriting:'Reading handwriting…',
  validating:'Checking what ARIA sees…',
  matching_community:'Matching your community…',
  building_memory:'Building memory…',
  processing:'ARIA is remembering people…'
 }

 const content=<div style={styles.overlay} onMouseDown={event=>{if(event.target===event.currentTarget&&stage!=='processing')close()}}>
  <div style={styles.modal} role="dialog" aria-modal="true" aria-label="ARIA Scan" onMouseDown={event=>event.stopPropagation()}>
   <button style={styles.close} onClick={close} disabled={stage==='processing'} aria-label="Close">×</button>
   <div style={styles.inner}>
    <div style={styles.eyebrow}>ARIA · SCAN</div>
    <h2 style={styles.title}>Remember people.</h2>
    <p style={styles.sub}>Capture the full register clearly. ARIA will verify what it sees.</p>

    {stage==='idle'&&<div style={styles.idle}>
     <input value={programName} onChange={event=>setProgramName(event.target.value)} placeholder="Program name" style={styles.input}/>
     <label style={styles.capture}>
      Take photo
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={handleFileInput}/>
     </label>
     <button style={styles.secondary} onClick={()=>uploadInput.current?.click()}>Upload image</button>
     <input ref={uploadInput} type="file" accept="image/*,.png,.jpg,.jpeg,.webp" hidden onChange={handleFileInput}/>
     <div style={styles.hint}>Use a clear, well-lit photo showing the complete register.</div>
    </div>}

    {stage==='processing'&&<div style={styles.status}>
     <div style={styles.pulse}>✦</div>
     <strong style={styles.statusTitle}>{messages[scanState.progress]||messages[stage]||progressMessage||messages.processing}</strong>
     <div style={styles.progressTrack}><div style={{...styles.progress,width:'65%'}}/></div>
     <span style={styles.meta}>{elapsedSeconds}s · ARIA is working</span>
    </div>}

    {stage==='complete'&&<div style={{...styles.result,animation:celebration?'ariaCelebrate .7s ease-out':'none'}}>
     <div style={styles.success}>✓ Scan complete.</div>
     <strong>{count!=null?`${count} ${Number(count)===1?'person':'people'} remembered.`:'Your register has been remembered.'}</strong>
     <span style={styles.resultText}>ARIA has processed the register and updated the community.</span>
     <button style={styles.secondary} onClick={()=>{clearScanState();setScanStateLocal(getScanState());setCelebration(false)}}>Scan another</button>
     <button style={styles.secondary} onClick={()=>router.push('/people')}>View community</button>
     {completionTimestamp&&<span style={styles.meta}>{completionTimestamp}</span>}
    </div>}

    {stage==='error'&&<div style={styles.result}>
     <div style={styles.error}>Something went wrong.</div>
     <span style={styles.resultText}>{message||'The register could not be processed.'}</span>
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
 sub:{margin:'0 auto',maxWidth:410,color:'rgba(255,255,255,.45)',lineHeight:1.6,fontSize:14},
 idle:{marginTop:20},
 input:{width:'100%',boxSizing:'border-box',padding:'14px 16px',margin:'22px 0 14px',borderRadius:15,border:'1px solid rgba(255,255,255,.1)',background:'rgba(255,255,255,.04)',color:'#fff',outline:'none',fontSize:15},
 capture:{display:'inline-block',padding:'15px 24px',borderRadius:999,background:'#f4f4f4',color:'#07101e',fontWeight:700,cursor:'pointer',fontSize:14},
 secondary:{display:'block',margin:'10px auto 0',padding:'11px 18px',borderRadius:999,border:'1px solid rgba(255,255,255,.12)',background:'rgba(255,255,255,.05)',color:'#fff',cursor:'pointer',fontSize:13},
 hint:{fontSize:12,color:'rgba(255,255,255,.3)',marginTop:14,lineHeight:1.5},
 status:{marginTop:28,padding:28,borderRadius:25,background:'rgba(255,255,255,.035)',display:'grid',gap:12,justifyItems:'center'},
 pulse:{width:68,height:68,borderRadius:'50%',display:'grid',placeItems:'center',background:'rgba(212,175,55,.1)',border:'1px solid rgba(212,175,55,.3)',color:'#d4af37',fontSize:22,animation:'ariaPulse 2s ease-in-out infinite'},
 statusTitle:{fontSize:14},
 progressTrack:{width:'100%',height:5,borderRadius:999,background:'rgba(255,255,255,.08)',overflow:'hidden'},
 progress:{height:'100%',borderRadius:999,background:'#d4af37',transition:'width .5s ease'},
 meta:{fontSize:11,color:'rgba(255,255,255,.3)'},
 result:{marginTop:28,padding:26,borderRadius:25,background:'rgba(255,255,255,.035)',display:'grid',gap:12},
 success:{color:'#8fd7b4',fontSize:18},
 error:{color:'#ff9d9d',fontSize:18},
 resultText:{color:'rgba(255,255,255,.45)',fontSize:13,lineHeight:1.5}
  }

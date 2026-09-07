// components/ScanModal.js
import {useState,useRef,useEffect,useCallback} from 'react'
import {useRouter} from 'next/router'
import {supabase} from '../lib/supabaseClient'
import {useScanStore} from '../lib/scanStore'
import {useOnboarding} from '../lib/useOnboarding'

export default function ScanModal({isOpen,onClose}){
 const router=useRouter()
 const cameraInput=useRef(null),uploadInput=useRef(null)
 const {completeStep}=useOnboarding()
 const [programName,setProgramName]=useState('GIBEON')
 const [scan,setScan]=useState(null)
 const [elapsed,setElapsed]=useState(0)
 const [error,setError]=useState('')
 const [celebration,setCelebration]=useState(false)
 const {scanState,setScanState,clearScanState}=useScanStore()

 const stop=useCallback(()=>{setScan(null);setElapsed(0)},[])
 const startPolling=useCallback(async(jobId)=>{
  let active=true
  const started=Date.now()
  const poll=async()=>{
   if(!active)return
   try{
    const r=await fetch(`/api/scan/status?job_id=${encodeURIComponent(jobId)}`)
    const d=await r.json()
    if(!r.ok)throw new Error(d.error||'Unable to check scan status')
    if(d.status==='complete'){
     active=false
     setScan({status:'complete',result:d.result||d.data||null})
     setScanState({status:'complete',jobId,result:d.result||d.data||null})
     setCelebration(true)
     completeStep?.('scan')
     return
    }
    if(d.status==='failed'){
     active=false
     const message=d.error||'The scan could not be completed.'
     setError(message)
     setScan({status:'failed',error:message})
     setScanState({status:'failed',jobId,error:message})
     return
    }
    setElapsed(Math.floor((Date.now()-started)/1000))
    setScan({status:'processing',progress:d.progress||0,stage:d.stage||'processing'})
    setTimeout(poll,1200)
   }catch(e){
    active=false
    const message=e.message||'Something went wrong while checking the scan.'
    setError(message)
    setScan({status:'failed',error:message})
    setScanState({status:'failed',jobId,error:message})
   }
  }
  poll()
  return()=>{active=false}
 },[completeStep,setScanState])

 const preprocess=useCallback(file=>new Promise((resolve,reject)=>{
  if(!file)return reject(new Error('No image selected.'))
  const url=URL.createObjectURL(file)
  const img=new Image()
  img.onload=async()=>{
   try{
    const max=1800
    const scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight))
    const w=Math.max(1,Math.round(img.naturalWidth*scale))
    const h=Math.max(1,Math.round(img.naturalHeight*scale))
    const canvas=document.createElement('canvas')
    canvas.width=w
    canvas.height=h
    const ctx=canvas.getContext('2d',{alpha:false})
    if(!ctx)throw new Error('Image processing is unavailable on this device.')
    ctx.drawImage(img,0,0,w,h)
    const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.82))
    if(!blob)throw new Error('Could not prepare the image.')
    let finalBlob=blob
    if(finalBlob.size>3.5*1024*1024){
     const smaller=await new Promise(r=>canvas.toBlob(r,'image/jpeg',.68))
     if(smaller)finalBlob=smaller
    }
    if(finalBlob.size>3.5*1024*1024)throw new Error('This image is too large. Please take the photo again from a little farther away.')
    const reader=new FileReader()
    reader.onload=()=>{
     URL.revokeObjectURL(url)
     canvas.width=1
     canvas.height=1
     resolve(String(reader.result).split(',')[1])
    }
    reader.onerror=()=>reject(new Error('Could not read the prepared image.'))
    reader.readAsDataURL(finalBlob)
   }catch(e){
    URL.revokeObjectURL(url)
    reject(e)
   }
  }
  img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('The selected image could not be opened.'))}
  img.src=url
 }),[])

 const handleFile=useCallback(async file=>{
  if(!file||scan?.status==='processing')return
  setError('')
  setScan({status:'processing',progress:5,stage:'preparing'})
  const started=Date.now()
  setElapsed(0)
  try{
   const image_base64=await preprocess(file)
   setElapsed(Math.floor((Date.now()-started)/1000))
   const r=await fetch('/api/scan/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image_base64,program_name:programName.trim()||'GIBEON'})})
   let d={}
   try{d=await r.json()}catch{}
   if(!r.ok)throw new Error(d.error||'Could not start the scan.')
   if(!d.job_id)throw new Error('The scan started without a job ID.')
   setScanState({status:'processing',jobId:d.job_id,progress:5,stage:'preparing'})
   startPolling(d.job_id)
  }catch(e){
   const message=e.message||'Something went wrong while starting the scan.'
   setError(message)
   setScan({status:'failed',error:message})
   setScanState({status:'failed',error:message})
  }
 },[preprocess,programName,scan?.status,setScanState,startPolling])

 useEffect(()=>{
  if(!isOpen)return
  setError('')
  setCelebration(false)
  const existing=scanState
  if(existing?.status==='processing'&&existing.jobId){
   setScan({status:'processing',progress:existing.progress||0,stage:existing.stage||'processing'})
   startPolling(existing.jobId)
  }else if(existing?.status==='complete'){
   setScan({status:'complete',result:existing.result||null})
  }else if(existing?.status==='failed'){
   setScan({status:'failed',error:existing.error||''})
  }else stop()
 },[isOpen,scanState,startPolling,stop])

 useEffect(()=>{
  if(!isOpen)return
  const fn=e=>{if(e.key==='Escape'&&scan?.status!=='processing')onClose?.()}
  window.addEventListener('keydown',fn)
  return()=>window.removeEventListener('keydown',fn)
 },[isOpen,onClose,scan?.status])

 if(!isOpen)return null

 const close=()=>{
  if(scan?.status==='processing')return
  clearScanState()
  stop()
  onClose?.()
 }

 const result=scan?.result||{}
 const count=result.people_count??result.peopleCount??result.count??result.records_created??result.recordsCreated
 const stage=scan?.stage||'processing'
 const messages={preparing:'Preparing your register…',enhancing:'Enhancing the image…',reading_handwriting:'Reading handwriting…',validating:'Checking what ARIA sees…',matching_community:'Matching your community…',building_memory:'Building memory…',processing:'ARIA is remembering people…'}

 return <div style={styles.overlay} onMouseDown={e=>{if(e.target===e.currentTarget&&scan?.status!=='processing')close()}}>
  <div style={styles.modal} role="dialog" aria-modal="true" aria-label="ARIA Scan">
   <button style={styles.close} onClick={close} disabled={scan?.status==='processing'} aria-label="Close">×</button>
   <div style={styles.inner}>
    <div style={styles.eyebrow}>ARIA · SCAN</div>
    <h2 style={styles.title}>Remember people.</h2>
    <p style={styles.sub}>Capture the full register clearly. ARIA will verify what it sees.</p>

    {!scan&&<>
     <input value={programName} onChange={e=>setProgramName(e.target.value)} placeholder="Program name" style={styles.input}/>
     <label style={styles.capture}>
      Take photo
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={e=>{handleFile(e.target.files?.[0]);e.target.value=''}}/>
     </label>
     <button style={styles.secondary} onClick={()=>uploadInput.current?.click()}>Upload image</button>
     <input ref={uploadInput} type="file" accept="image/*,.png,.jpg,.jpeg,.webp" hidden onChange={e=>{handleFile(e.target.files?.[0]);e.target.value=''}}/>
     <div style={styles.hint}>Use a clear, well-lit photo showing the complete register.</div>
    </>}

    {scan?.status==='processing'&&<div style={styles.status}>
     <div style={styles.pulse}>✦</div>
     <strong style={styles.statusTitle}>{messages[stage]||messages.processing}</strong>
     <div style={styles.progressTrack}><div style={{...styles.progress,width:`${Math.max(5,Math.min(100,scan.progress||0))}%`}}/></div>
     <span style={styles.meta}>{Math.max(0,elapsed)}s · Please keep this screen open</span>
    </div>}

    {scan?.status==='complete'&&<div style={styles.result}>
     <div style={styles.success}>{celebration?'✦ Done.':'✓ Scan complete.'}</div>
     <strong>{count!=null?`${count} ${Number(count)===1?'person':'people'} remembered.`:'Your register has been remembered.'}</strong>
     <span style={styles.resultText}>ARIA has processed the register and updated the community.</span>
     <button style={styles.secondary} onClick={()=>{setScan(null);setCelebration(false);clearScanState()}}>Scan another</button>
     <button style={styles.secondary} onClick={()=>router.push('/people')}>View community</button>
    </div>}

    {scan?.status==='failed'&&<div style={styles.result}>
     <div style={styles.error}>Something went wrong.</div>
     <span style={styles.resultText}>{error||scan.error||'The register could not be processed.'}</span>
     <button style={styles.secondary} onClick={()=>{setScan(null);setError('');clearScanState()}}>Try again</button>
    </div>}
   </div>
  </div>
  <style jsx>{`@keyframes ariaPulse{0%,100%{transform:scale(1);opacity:.7}50%{transform:scale(1.08);opacity:1}}`}</style>
 </div>
}

const styles={
 overlay:{position:'fixed',inset:0,zIndex:4000,background:'rgba(2,6,16,.72)',backdropFilter:'blur(14px)',WebkitBackdropFilter:'blur(14px)',padding:'14px',display:'grid',placeItems:'center'},
 modal:{position:'relative',width:'min(580px,calc(100vw - 28px))',height:'min(75vh,700px)',maxHeight:'75vh',overflow:'auto',borderRadius:30,background:'linear-gradient(145deg,rgba(16,27,55,.97),rgba(7,14,32,.97))',border:'1px solid rgba(255,255,255,.11)',boxShadow:'0 30px 100px rgba(0,0,0,.5)',color:'#fff',scrollbarWidth:'thin'},
 close:{position:'absolute',top:14,right:14,width:38,height:38,borderRadius:'50%',border:'1px solid rgba(255,255,255,.1)',background:'rgba(255,255,255,.06)',color:'rgba(255,255,255,.75)',fontSize:25,lineHeight:1,cursor:'pointer',zIndex:2},
 inner:{maxWidth:500,minHeight:'100%',margin:'0 auto',padding:'48px 24px 34px',textAlign:'center',display:'flex',flexDirection:'column',justifyContent:'center'},
 eyebrow:{fontSize:10,letterSpacing:2.5,color:'rgba(255,255,255,.35)',marginBottom:10},
 title:{fontSize:'clamp(27px,7vw,38px)',lineHeight:1.05,letterSpacing:-1.2,margin:'0 0 12px'},
 sub:{margin:'0 auto',maxWidth:410,color:'rgba(255,255,255,.45)',lineHeight:1.6,fontSize:14},
 input:{width:'100%',boxSizing:'border-box',padding:'14px 16px',margin:'22px 0 14px',borderRadius:15,border:'1px solid rgba(255,255,255,.1)',background:'rgba(255,255,255,.04)',color:'#fff',outline:'none',fontSize:15},
 capture:{display:'inline-block',padding:'15px 24px',borderRadius:999,background:'#f4f4f4',color:'#07101e',fontWeight:700,cursor:'pointer',fontSize:14},
 secondary:{marginTop:10,padding:'11px 18px',borderRadius:999,border:'1px solid rgba(255,255,255,.12)',background:'rgba(255,255,255,.05)',color:'#fff',cursor:'pointer',fontSize:13},
 hint:{fontSize:12,color:'rgba(255,255,255,.3)',marginTop:14,lineHeight:1.5},
 status:{marginTop:28,padding:26,borderRadius:25,background:'rgba(255,255,255,.035)',display:'grid',gap:12,justifyItems:'center'},
 pulse:{width:64,height:64,borderRadius:'50%',display:'grid',placeItems:'center',background:'rgba(212,175,55,.1)',border:'1px solid rgba(212,175,55,.3)',color:'#d4af37',fontSize:22,animation:'ariaPulse 2s ease-in-out infinite'},
 statusTitle:{fontSize:14},
 progressTrack:{width:'100%',height:5,borderRadius:999,background:'rgba(255,255,255,.08)',overflow:'hidden'},
 progress:{height:'100%',borderRadius:999,background:'#d4af37',transition:'width .5s ease'},
 meta:{fontSize:11,color:'rgba(255,255,255,.3)'},
 result:{marginTop:28,padding:25,borderRadius:25,background:'rgba(255,255,255,.035)',display:'grid',gap:12},
 success:{color:'#8fd7b4',fontSize:18},
 error:{color:'#ff9d9d',fontSize:18},
 resultText:{color:'rgba(255,255,255,.45)',fontSize:13,lineHeight:1.5}
   }

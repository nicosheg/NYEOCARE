// components/AriaVoice.js
import{useEffect,useRef,useState}from'react';
import{supabase}from'../lib/supabaseClient';

const chunkText=text=>{const out=[];let s=String(text||'').trim();while(s.length>195){let i=s.lastIndexOf(' ',195);if(i<80)i=195;out.push(s.slice(0,i).trim());s=s.slice(i).trim()}if(s)out.push(s);return out};

export default function AriaVoice({onResponse}){
const[recording,setRecording]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[supported,setSupported]=useState(true);
const media=useRef(null),chunks=useRef([]),conversationId=useRef(null),stopped=useRef(false);

useEffect(()=>{setSupported(typeof window!=='undefined'&&!!navigator.mediaDevices?.getUserMedia&&typeof MediaRecorder!=='undefined')},[]);

const auth=async()=>{const{data:{session}}=await supabase.auth.getSession();if(!session)throw Error('You must be logged in.');return session};

const start=async()=>{
if(!supported||recording||busy)return;
setError('');
try{
const stream=await navigator.mediaDevices.getUserMedia({audio:true});
const types=['audio/webm;codecs=opus','audio/webm','audio/mp4'];
const type=types.find(x=>MediaRecorder.isTypeSupported?.(x))||'';
const recorder=new MediaRecorder(stream,type?{mimeType:type}:undefined);
chunks.current=[];stopped.current=false;
recorder.ondataavailable=e=>{if(e.data?.size)chunks.current.push(e.data)};
recorder.onerror=()=>{stream.getTracks().forEach(t=>t.stop());setRecording(false);setError('Recording failed. Please try again.')};
recorder.onstop=async()=>{
stream.getTracks().forEach(t=>t.stop());
setRecording(false);
if(stopped.current)return;
const blob=new Blob(chunks.current,{type:recorder.mimeType||'audio/webm'});
if(!blob.size){setError('No audio was recorded.');return}
await process(blob);
};
media.current=recorder;recorder.start();setRecording(true);
}catch(e){setError(e.name==='NotAllowedError'?'Microphone permission was denied.':e.message||'Unable to start microphone.')}}
;

const stop=()=>{stopped.current=false;if(media.current&&media.current.state!=='inactive')media.current.stop()};

const cancel=()=>{stopped.current=true;if(media.current&&media.current.state!=='inactive')media.current.stop();else setRecording(false);setError('')};

const process=async blob=>{
setBusy(true);setError('');
try{
const s=await auth(),h={Authorization:`Bearer ${s.access_token}`},form=new FormData();
form.append('audio',blob,'aria.webm');
const tr=await fetch('/api/aria/voice/transcribe',{method:'POST',headers:h,body:form});
const td=await tr.json();
if(!tr.ok)throw Error(td.error||'Unable to understand the recording.');
const message=String(td.text||'').trim();
if(!message)throw Error('I could not hear a clear request.');
const cr=await fetch('/api/aria/chat',{method:'POST',headers:{...h,'Content-Type':'application/json'},body:JSON.stringify({message,conversationId:conversationId.current})});
const cd=await cr.json();
if(!cr.ok)throw Error(cd.error||'ARIA could not process that request.');
conversationId.current=cd.conversationId||conversationId.current;
if(onResponse)onResponse(cd);
for(const text of chunkText(cd.text))await speak(text,h);
}catch(e){setError(e.message||'Voice request failed.')}finally{setBusy(false)}
};

const speak=async(text,h)=>{
const r=await fetch('/api/aria/voice/speak',{method:'POST',headers:{...h,'Content-Type':'application/json'},body:JSON.stringify({text})});
if(!r.ok){const d=await r.json().catch(()=>({}));throw Error(d.error||'ARIA could not speak.')}
const blob=await r.blob(),url=URL.createObjectURL(blob);
try{await new Promise((resolve,reject)=>{const audio=new Audio(url);audio.onended=resolve;audio.onerror=reject;audio.play().catch(reject)})}finally{URL.revokeObjectURL(url)}
};

if(!supported)return <div style={box}>Voice is not supported in this browser.</div>;

return <div style={box}>
<div style={title}>Talk to ARIA</div>
<div style={sub}>{recording?'Listening…':busy?'ARIA is thinking…':'Speak naturally and ARIA will remember the conversation.'}</div>
<div style={actions}>
{recording?<><button style={primary} onClick={stop}>Stop</button><button style={ghost} onClick={cancel}>Cancel</button></>:<button style={primary} disabled={busy} onClick={start}>{busy?'Working…':'🎙 Talk'}</button>}
</div>
{error?<div style={err}>{error}</div>:null}
</div>
}

const box={padding:20,borderRadius:24,background:'rgba(255,255,255,.045)',border:'1px solid rgba(255,255,255,.08)'},title={fontSize:18,fontWeight:600,color:'#f5f5f5'},sub={marginTop:6,color:'rgba(255,255,255,.5)',fontSize:13,lineHeight:1.5},actions={display:'flex',gap:8,marginTop:16},primary={border:0,borderRadius:999,padding:'10px 17px',background:'#f5f5f5',color:'#0a1128',fontWeight:600,cursor:'pointer'},ghost={border:'1px solid rgba(255,255,255,.12)',borderRadius:999,padding:'10px 17px',background:'rgba(255,255,255,.05)',color:'#fff',cursor:'pointer'},err={marginTop:12,color:'#ffb0b0',fontSize:13};

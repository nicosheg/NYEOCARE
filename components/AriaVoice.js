// components/AriaVoice.js
import{useRef,useState,useEffect}from'react';
import{supabase}from'../lib/supabaseClient';

const split=text=>{const a=[];let s=String(text||'').replace(/\s+/g,' ').trim();while(s.length>195){let i=s.lastIndexOf(' ',195);if(i<80)i=195;a.push(s.slice(0,i).trim());s=s.slice(i).trim()}if(s)a.push(s);return a};
const activation=/^(?:hey\s+)?neyo\b[\s,.:;-]*/i;

export default function AriaVoice({onResponse,briefingText}){
 const[recording,setRecording]=useState(false),[busy,setBusy]=useState(false),[speaking,setSpeaking]=useState(false),[error,setError]=useState(''),[supported,setSupported]=useState(true),[activated,setActivated]=useState(false);
 const recorder=useRef(null),chunks=useRef([]),stream=useRef(null),conversationId=useRef(null),cancelled=useRef(false),audio=useRef(null),speakingRef=useRef(false);

 useEffect(()=>{setSupported(typeof window!=='undefined'&&!!navigator.mediaDevices?.getUserMedia&&typeof MediaRecorder!=='undefined');return()=>{try{audio.current?.pause()}catch{};stream.current?.getTracks().forEach(t=>t.stop())}},[]);

 const auth=async()=>{const{data:{session}}=await supabase.auth.getSession();if(!session)throw Error('You must be logged in.');return session};

 const speak=async text=>{
  const value=String(text||'').trim();
  if(!value)return;
  const s=await auth(),h={Authorization:`Bearer ${s.access_token}`};
  const r=await fetch('/api/aria/voice/speak',{method:'POST',headers:{...h,'Content-Type':'application/json'},body:JSON.stringify({text:value})});
  const contentType=r.headers.get('content-type')||'';
  if(!r.ok){
   let message='ARIA could not speak.';
   if(contentType.includes('application/json')){const body=await r.json().catch(()=>null);message=body?.error||message}
   throw Error(message);
  }
  const blob=await r.blob();
  if(!blob.size)throw Error('ARIA returned empty audio.');
  const url=URL.createObjectURL(blob);
  try{
   await new Promise((resolve,reject)=>{
    const player=new Audio(url);
    audio.current=player;
    player.onended=resolve;
    player.onerror=()=>reject(Error('Audio playback failed.'));
    player.onabort=()=>reject(Error('Audio playback was interrupted.'));
    player.play().catch(reject);
   });
  }finally{audio.current=null;URL.revokeObjectURL(url)}
 };

 const speakText=async text=>{
  if(speakingRef.current)return;
  const parts=split(text);
  if(!parts.length)return;
  speakingRef.current=true;
  setSpeaking(true);
  setError('');
  try{for(const part of parts)await speak(part)}catch(e){setError(e.message||'ARIA could not speak.')}finally{speakingRef.current=false;setSpeaking(false)}
 };

 const stopSpeaking=()=>{try{audio.current?.pause();audio.current.currentTime=0}catch{};audio.current=null;speakingRef.current=false;setSpeaking(false)};

 const process=async blob=>{
  setBusy(true);setError('');
  try{
   const s=await auth(),h={Authorization:`Bearer ${s.access_token}`},form=new FormData();
   const ext=blob.type.includes('mp4')?'mp4':'webm';
   form.append('audio',blob,`aria.${ext}`);
   const tr=await fetch('/api/aria/voice/transcribe',{method:'POST',headers:h,body:form}),td=await tr.json();
   if(!tr.ok)throw Error(td.error||'Unable to understand the recording.');
   let message=String(td.text||'').trim();
   if(!message)throw Error('I could not hear a clear request.');
   const match=message.match(activation);
   if(!activated&&!match){await speakText('Say Neyo when you are ready.');return}
   if(match){
    message=message.replace(activation,'').trim();
    setActivated(true);
    if(!message){await speakText('I’m listening.');return}
   }
   const cr=await fetch('/api/aria/chat',{method:'POST',headers:{...h,'Content-Type':'application/json'},body:JSON.stringify({message,conversationId:conversationId.current})}),cd=await cr.json();
   if(!cr.ok)throw Error(cd.error||'ARIA could not process that request.');
   conversationId.current=cd.conversationId||conversationId.current;
   onResponse?.(cd);
   await speakText(cd.text);
  }catch(e){setError(e.message||'Voice request failed.')}finally{setBusy(false)}
 };

 const start=async()=>{
  if(!supported||recording||busy||speaking)return;
  setError('');cancelled.current=false;
  try{
   stream.current=await navigator.mediaDevices.getUserMedia({audio:true});
   const types=['audio/webm;codecs=opus','audio/webm','audio/mp4'],type=types.find(x=>MediaRecorder.isTypeSupported?.(x))||'';
   recorder.current=new MediaRecorder(stream.current,type?{mimeType:type}:undefined);
   chunks.current=[];
   recorder.current.ondataavailable=e=>{if(e.data?.size)chunks.current.push(e.data)};
   recorder.current.onstop=async()=>{
    stream.current?.getTracks().forEach(t=>t.stop());
    setRecording(false);
    if(cancelled.current)return;
    const blob=new Blob(chunks.current,{type:recorder.current?.mimeType||'audio/webm'});
    if(!blob.size){setError('No audio was recorded.');return}
    await process(blob);
   };
   recorder.current.onerror=()=>{stream.current?.getTracks().forEach(t=>t.stop());setRecording(false);setError('Recording failed. Please try again.')};
   recorder.current.start();
   setRecording(true);
  }catch(e){
   stream.current?.getTracks().forEach(t=>t.stop());
   setRecording(false);
   setError(e.name==='NotAllowedError'?'Microphone permission was denied.':e.message||'Unable to start microphone.')
  }
 };

 const stop=()=>{cancelled.current=false;if(recorder.current&&recorder.current.state!=='inactive')recorder.current.stop()};
 const cancel=()=>{cancelled.current=true;if(recorder.current&&recorder.current.state!=='inactive')recorder.current.stop();else{stream.current?.getTracks().forEach(t=>t.stop());setRecording(false)}};

 if(!supported)return null;

 return <div style={box}>
  <div style={title}>ARIA</div>
  <div style={sub}>{recording?'Listening…':speaking?'ARIA is speaking…':busy?'ARIA is thinking…':activated?'ARIA is ready.':'Say “Neyo” to talk to ARIA.'}</div>
  <div style={actions}>
   {briefingText&&!speaking&&<button style={primary} disabled={busy||recording} onClick={()=>speakText(briefingText)}>🔊 Brief me</button>}
   {speaking&&<button style={ghost} onClick={stopSpeaking}>Stop</button>}
   {recording?<><button style={primary} onClick={stop}>Stop</button><button style={ghost} onClick={cancel}>Cancel</button></>:!speaking&&<button style={ghost} disabled={busy} onClick={start}>{busy?'Working…':'🎙 Talk'}</button>}
  </div>
  {error&&<div style={errorStyle}>{error}</div>}
 </div>;
}

const box={padding:20,borderRadius:24,background:'rgba(255,255,255,.045)',border:'1px solid rgba(255,255,255,.08)'};
const title={fontSize:18,fontWeight:600,color:'#f5f5f5'};
const sub={marginTop:6,color:'rgba(255,255,255,.5)',fontSize:13,lineHeight:1.5};
const actions={display:'flex',gap:8,marginTop:16,flexWrap:'wrap'};
const primary={border:0,borderRadius:999,padding:'10px 17px',background:'#f5f5f5',color:'#0a1128',fontWeight:600,cursor:'pointer'};
const ghost={border:'1px solid rgba(255,255,255,.12)',borderRadius:999,padding:'10px 17px',background:'rgba(255,255,255,.05)',color:'#fff',cursor:'pointer'};
const errorStyle={marginTop:12,color:'#ffb0b0',fontSize:13,lineHeight:1.5};

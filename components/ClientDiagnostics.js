import{useEffect}from'react';
import{getClientSession,refreshClientSession}from'../lib/clientSession';

let installed=false;
const recent=new Map();

function shouldSend(key,windowMs=30000){
 const now=Date.now(),previous=recent.get(key)||0;
 if(now-previous<windowMs)return false;
 recent.set(key,now);return true;
}

function isChunkError(message){
 return /ChunkLoadError|Loading chunk|dynamically imported module|Failed to fetch dynamically imported module/i.test(String(message||''));
}
function isExpectedAbort(message){
 return /AbortError|operation was aborted|signal is aborted|aborted without reason/i.test(String(message||''));
}

async function send(payload){
 if(typeof window==='undefined'||payload?.pathname==='/system/diagnostics')return;
 try{
  let session=await getClientSession();
  if(!session)return;
  const body={...payload,pathname:window.location.pathname,userAgent:navigator.userAgent};
  let r=await fetch('/api/diagnostics/client-error',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify(body),keepalive:true});
  if(r.status===401){
   session=await refreshClientSession().catch(()=>null);
   if(session)await fetch('/api/diagnostics/client-error',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify(body),keepalive:true});
  }
 }catch{}
}

export default function ClientDiagnostics(){
 useEffect(()=>{
  if(installed||typeof window==='undefined')return;
  installed=true;

  const reportWindowError=e=>{
   const error=e?.error;
   const message=String(error?.message||e?.message||'Unknown browser error');
   if(isChunkError(message))return;
   const target=e?.target;
   const resource=target&&target!==window?{
    tag:String(target.tagName||'').slice(0,20),
    url:String(target.src||target.href||'').split('?')[0].slice(0,300)
   }:null;
   const key='window:'+message.slice(0,240);
   if(!shouldSend(key))return;
   void send({
    kind:'client_runtime_error',
    severity:'error',
    surface:'window',
    message,
    stack:String(error?.stack||'').slice(0,6000),
    metadata:{resource}
   });
  };

  const reportUnhandled=e=>{
   const reason=e?.reason,message=String(reason?.message||reason||'Unhandled promise rejection');
   if(isChunkError(message))return;
   const key='rejection:'+message.slice(0,240);
   if(!shouldSend(key))return;
   void send({
    kind:'client_unhandled_rejection',
    severity:'error',
    surface:'window',
    message,
    stack:String(reason?.stack||'').slice(0,6000)
   });
  };

  window.addEventListener('error',reportWindowError,true);
  window.addEventListener('unhandledrejection',reportUnhandled);

  const nativeFetch=window.fetch.bind(window);
  window.fetch=async(...args)=>{
   const started=performance.now(),input=args[0];
   let pathname='';
   try{pathname=new URL(typeof input==='string'?input:input?.url||'',window.location.href).pathname}catch{}
   try{
    const response=await nativeFetch(...args);
    const duration=Math.round(performance.now()-started);
    if(pathname.startsWith('/api/')&&pathname!=='/api/diagnostics/client-error'){
     const key='api:'+pathname+':'+response.status;
     if((response.status>=500||response.status===408||response.status===429)&&shouldSend(key)){
      void send({
       kind:'client_api_error',
       severity:response.status>=500?'error':'warning',
       surface:'fetch',
       message:'API request returned '+response.status+' '+pathname,
       requestId:response.headers.get('x-nyeo-request-id'),
       metadata:{status:response.status,duration_ms:duration,method:String(args[1]?.method||'GET').slice(0,12)}
      });
     }else if(duration>=4000&&shouldSend('slow:'+pathname)){
      void send({
       kind:'client_api_slow',
       severity:'warning',
       surface:'fetch',
       message:'API request exceeded 4 seconds: '+pathname,
       requestId:response.headers.get('x-nyeo-request-id'),
       metadata:{status:response.status,duration_ms:duration,method:String(args[1]?.method||'GET').slice(0,12)}
      });
     }
    }
    return response;
   }catch(error){
    const duration=Math.round(performance.now()-started);
    if(isExpectedAbort(error?.message||error))throw error;
    if(pathname.startsWith('/api/')&&pathname!=='/api/diagnostics/client-error'&&shouldSend('network:'+pathname)){
     void send({
      kind:'client_network_error',
      severity:'error',
      surface:'fetch',
      message:String(error?.message||error||'Network request failed'),
      metadata:{duration_ms:duration,method:String(args[1]?.method||'GET').slice(0,12),pathname}
     });
    }
    throw error;
   }
  };

  return()=>{
   window.removeEventListener('error',reportWindowError,true);
   window.removeEventListener('unhandledrejection',reportUnhandled);
  };
 },[]);
 return null;
}
// lib/performanceTelemetry.js
const MAX_META_KEYS=8;
const cleanMeta=meta=>Object.fromEntries(Object.entries(meta||{}).slice(0,MAX_META_KEYS).filter(([,v])=>v!==undefined&&v!==null).map(([k,v])=>[String(k).slice(0,40),typeof v==='number'&&Number.isFinite(v)?v:typeof v==='boolean'?v:String(v).slice(0,120)]));
export function recordPerformance(metric,durationMs,{status='ok',...meta}={}){
 if(typeof window==='undefined'||typeof navigator==='undefined')return;
 const body=JSON.stringify({metric:String(metric).slice(0,80),duration_ms:Math.max(0,Math.round(Number(durationMs)||0)),status:String(status).slice(0,30),meta:cleanMeta(meta),at:new Date().toISOString()});
 try{if(navigator.sendBeacon){const blob=new Blob([body],{type:'application/json'});if(navigator.sendBeacon('/api/telemetry/performance',blob))return}}catch{}
 fetch('/api/telemetry/performance',{method:'POST',headers:{'Content-Type':'application/json'},body,keepalive:true}).catch(()=>{});
}
export function measurePerformance(metric,meta={}){
 const start=typeof performance!=='undefined'?performance.now():Date.now();
 return(status='ok',extra={})=>recordPerformance(metric,(typeof performance!=='undefined'?performance.now():Date.now())-start,{status,...meta,...extra});
}
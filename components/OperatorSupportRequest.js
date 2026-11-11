// components/OperatorSupportRequest.js
import{useEffect,useState}from'react';
import{getClientSession}from'../lib/clientSession';

const REASONS=[
 {value:'unclear',label:'I am not sure what the next step is'},
 {value:'capacity',label:'I do not have the capacity right now'},
 {value:'reassignment',label:'Someone else may be better placed'},
 {value:'blocked',label:'Something is blocking the work'}
];

export default function OperatorSupportRequest({queueItemId,championName=null}){
 const[open,setOpen]=useState(false),[reason,setReason]=useState('unclear'),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[sent,setSent]=useState(null);
 useEffect(()=>{let active=true;(async()=>{try{const session=await getClientSession();if(!session?.access_token)return;const response=await fetch('/api/operator-support?queue_item_id='+encodeURIComponent(queueItemId),{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});const body=await response.json().catch(()=>({}));if(active&&response.ok&&body.requested)setSent({message:body.acknowledged?'A leader has acknowledged your request. Continue the conversation with them; the responsibility remains open until its real outcome is recorded.':'You have already asked for help with this responsibility. It is waiting for a response.'})}catch(e){console.warn('[OPERATOR SUPPORT] existing request check failed:',e?.message||e)}})();return()=>{active=false}},[queueItemId]);
 const submit=async()=>{
  if(busy||!queueItemId)return;
  setBusy(true);setError('');
  try{
   const session=await getClientSession();
   if(!session?.access_token)throw new Error('Please sign in again.');
   const response=await fetch('/api/operator-support',{
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},
    body:JSON.stringify({queue_item_id:queueItemId,reason,note})
   });
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(data.error||'Your request could not be sent.');
   setSent(data);setOpen(false);setNote('');
  }catch(e){setError(e.message||'Your request could not be sent.')}
  finally{setBusy(false)}
 };
 if(sent)return <div className="supportSent" role="status"><strong>Help requested</strong><span>{sent.message||('Your request has been shared with '+(sent.recipient?.name||'your support contact')+'.')}</span></div>;
 return <div className="supportRoot">
  {!open?<button type="button" className="supportTrigger" onClick={()=>setOpen(true)}>Need help with this?</button>:<div className="supportForm">
   <div className="supportHeading">What would make this easier?</div>
   <select value={reason} onChange={e=>setReason(e.target.value)} disabled={busy} aria-label="Choose why you need help">
    {REASONS.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}
   </select>
   <textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={500} rows={2} placeholder="Add context for the person helping you (optional)." disabled={busy}/>
   <p>This goes to {championName?championName:'an active organization leader'}. Authorized leaders can see the request and the responsibility you linked so they can help—not to score your activity.</p>
   {error&&<div className="supportError" role="alert">{error}</div>}
   <div className="supportActions">
    <button type="button" className="supportSend" onClick={submit} disabled={busy}>{busy?'Sending…':'Send request'}</button>
    <button type="button" className="supportCancel" onClick={()=>{setOpen(false);setError('')}} disabled={busy}>Cancel</button>
   </div>
  </div>}
  <style jsx>{`
   .supportRoot{margin-top:7px}
   .supportTrigger{border:0;background:transparent;padding:2px 0;color:rgba(214,184,106,.9);font-size:11px;font-weight:600;cursor:pointer}
   .supportForm{padding:12px;border:1px solid rgba(214,184,106,.18);border-radius:15px;background:rgba(214,184,106,.045)}
   .supportHeading{font-size:12px;color:var(--ny-text);font-weight:650;margin-bottom:8px}
   select,textarea{width:100%;box-sizing:border-box;border:1px solid var(--ny-border);border-radius:10px;background:rgba(5,12,24,.72);color:var(--ny-text);font:inherit;font-size:12px;padding:10px;outline:none}
   textarea{resize:vertical;margin-top:8px;line-height:1.5}
   p{margin:8px 0 0;color:var(--ny-text-muted);font-size:10px;line-height:1.5}
   .supportActions{display:flex;gap:8px;align-items:center;margin-top:10px}
   .supportSend,.supportCancel{border-radius:999px;padding:8px 12px;font-size:11px;font-weight:650;cursor:pointer}
   .supportSend{border:1px solid rgba(214,184,106,.28);background:rgba(214,184,106,.12);color:var(--ny-gold-soft)}
   .supportCancel{border:1px solid var(--ny-border-subtle);background:transparent;color:var(--ny-text-muted)}
   button:disabled{opacity:.5;cursor:default}
   .supportError{margin-top:8px;color:#f2a0a0;font-size:11px}
   .supportSent{display:grid;gap:3px;margin-top:7px;padding:8px 10px;border:1px solid rgba(127,191,154,.18);border-radius:12px;background:rgba(127,191,154,.055)}
   .supportSent strong{color:var(--ny-success);font-size:10px;font-weight:650}
   .supportSent span{color:var(--ny-text-muted);font-size:10px;line-height:1.45}
  `}</style>
 </div>;
}

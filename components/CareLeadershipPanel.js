// components/CareLeadershipPanel.js
import{useCallback,useEffect,useState}from'react';
import{getClientSession}from'../lib/clientSession';

const count=value=>Number(value||0).toLocaleString();
const dueLabel=(date,today)=>{
 if(!date)return'No due date';
 if(date<today)return'Overdue';
 if(date===today)return'Due today';
 return new Date(date+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'});
};

export default function CareLeadershipPanel(){
 const[data,setData]=useState(null),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const[targets,setTargets]=useState({}),[showAll,setShowAll]=useState(false);
 const load=useCallback(async()=>{
  setError('');
  try{
   const session=await getClientSession();
   if(!session?.access_token)throw new Error('Sign in again to view team care.');
   const response=await fetch('/api/care-oversight',{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(body.error||'Team care could not be loaded.');
   setData(body);
  }catch(e){setError(e.message||'Team care could not be loaded.')}
 },[]);
 useEffect(()=>{load()},[load]);

 const acknowledge=async id=>{
  if(busy)return;
  setBusy('support:'+id);setError('');setNotice('');
  try{
   const session=await getClientSession();
   const response=await fetch('/api/care-oversight/acknowledge',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify({message_id:id})});
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(body.error||'Could not acknowledge the request.');
   setNotice('Request acknowledged.');
   await load();
  }catch(e){setError(e.message||'Could not acknowledge the request.')}
  finally{setBusy('')}
 };

 const reassign=async item=>{
  const target=targets[item.queue_item_id];
  if(!target||busy)return;
  setBusy('move:'+item.queue_item_id);setError('');setNotice('');
  try{
   const session=await getClientSession();
   const response=await fetch('/api/care-oversight/reassign',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify({queue_item_id:item.queue_item_id,target_user_id:target,reason:'Leadership moved this responsibility in ARIA Today.'})});
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(body.error||'Could not move this responsibility.');
   setNotice('Responsibility moved.');
   await load();
  }catch(e){setError(e.message||'Could not move this responsibility.')}
  finally{setBusy('')}
 };

 if(error&&!data)return <section className="careTeam"><div className="careTeamError">{error}</div><button className="careRefresh" onClick={load}>Try again</button><style jsx>{styles}</style></section>;
 if(!data)return <section className="careTeam"><div className="careTeamLoading">Loading team care…</div><style jsx>{styles}</style></section>;

 const summary=data.summary||{},loop=data.care_loop||{},today=data.today||'';
 const requests=(data.support_requests||[]).filter(x=>!x.support_acknowledged_at);
 const assignments=data.assignments||[];
 const candidates=data.operator_candidates||[];
 const visible=showAll?assignments:assignments.slice(0,5);

 return <section className="careTeam" aria-label="Team care">
  <div className="careStats">
   <div><strong>{count(summary.open_responsibilities)}</strong><span>Open</span></div>
   <div><strong>{count(summary.due_today)}</strong><span>Due today</span></div>
   <div><strong>{count(summary.support_requests)}</strong><span>Help waiting</span></div>
   <div><strong>{count(summary.outcomes_recorded_7d)}</strong><span>Outcomes · 7d</span></div>
  </div>
  {(notice||error)&&<div className={error?'careTeamError':'careTeamNotice'} role="status">{error||notice}</div>}

  <section className="careSection">
   <header><h3>Help requests</h3><span>{count(summary.support_requests)}</span></header>
   {requests.length?requests.map(request=><article className="careRequest" key={request.id}>
    <div className="careRequestName">{request.sender?.name||'Operator'}</div>
    <div className="careRequestTask">{request.task_title||'Needs support'}</div>
    <div className="careRequestBody">{request.body}</div>
    <button className="careAction" disabled={busy==='support:'+request.id} onClick={()=>acknowledge(request.id)}>{busy==='support:'+request.id?'Saving…':'Acknowledge'}</button>
   </article>):<div className="careEmpty">No requests waiting.</div>}
  </section>

  <section className="careSection">
   <header><h3>Needs coordination</h3><span>{assignments.length}</span></header>
   {visible.length?visible.map(item=><article className="careAssignment" key={item.queue_item_id}>
    <div className="careAssignmentTop"><strong>{item.title||'Responsibility'}</strong><span className={item.queue_date<today?'careOverdue':'careDate'}>{dueLabel(item.queue_date,today)}</span></div>
    {item.message&&<div className="careRequestBody">{item.message}</div>}
    <div className="careAssigned">With {item.assigned_to_name||'Unassigned'}</div>
    <div className="careMove">
     <select aria-label={'Move '+(item.title||'responsibility')} value={targets[item.queue_item_id]||''} onChange={e=>setTargets(v=>({...v,[item.queue_item_id]:e.target.value}))}>
      <option value="">Move to…</option>
      {candidates.filter(person=>person.id!==item.assigned_user_id).map(person=><option key={person.id} value={person.id}>{person.name||'Operator'}</option>)}
     </select>
     <button className="careAction" disabled={!targets[item.queue_item_id]||busy==='move:'+item.queue_item_id} onClick={()=>reassign(item)}>{busy==='move:'+item.queue_item_id?'Moving…':'Move'}</button>
    </div>
   </article>):<div className="careEmpty">No work needs coordination.</div>}
   {assignments.length>5&&<button className="careTextButton" onClick={()=>setShowAll(v=>!v)}>{showAll?'Show less':'Show all '+assignments.length}</button>}
  </section>

  <section className="careSection">
   <header><h3>Team workload</h3></header>
   <div className="careWorkload">{(data.workloads||[]).map(person=><div key={person.id}><span>{person.name||'Operator'}</span><b>{count(person.open_count)} open · {count(person.due_count)} today</b></div>)}</div>
  </section>
  <div className="careFooter"><span>{loop.rate===null?'No follow-up outcomes due this week':count(loop.completed_with_outcome)+' / '+count(loop.due)+' completed · '+loop.rate+'%'}</span><button className="careRefresh" onClick={load} aria-label="Refresh team care">↻</button></div>
  <style jsx>{styles}</style>
 </section>;
}

const styles=`
 .careTeam{display:grid;gap:14px;color:var(--ny-text);padding-top:7px}
 .careStats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}
 .careStats>div{min-width:0;padding:11px 8px;border:1px solid var(--ny-border-subtle);border-radius:13px;background:rgba(255,255,255,.025)}
 .careStats strong{display:block;font-size:20px;line-height:1.1;font-weight:650;font-variant-numeric:tabular-nums}
 .careStats span{display:block;margin-top:4px;color:var(--ny-text-muted);font-size:9px;line-height:1.2}
 .careSection{min-width:0}
 .careSection>header{display:flex;align-items:center;justify-content:space-between;margin-bottom:7px}
 .careSection h3{margin:0;font-size:12px;font-weight:650}
 .careSection>header>span{color:var(--ny-text-muted);font-size:10px}
 .careRequest,.careAssignment{padding:10px;border:1px solid var(--ny-border-subtle);border-radius:12px;background:rgba(255,255,255,.025)}
 .careRequest+.careRequest,.careAssignment+.careAssignment{margin-top:7px}
 .careRequestName{font-size:11px;font-weight:650}
 .careRequestTask{margin-top:3px;font-size:11px}
 .careRequestBody{margin-top:4px;color:var(--ny-text-muted);font-size:10px;line-height:1.4;overflow-wrap:anywhere}
 .careAction{min-height:36px;padding:0 12px;border:1px solid rgba(214,184,106,.24);border-radius:10px;background:rgba(214,184,106,.09);color:var(--ny-gold-soft);font-size:10px;font-weight:650}
 .careRequest>.careAction{margin-top:8px}
 .careAssignmentTop{display:flex;align-items:flex-start;justify-content:space-between;gap:9px}
 .careAssignmentTop strong{min-width:0;font-size:11px;font-weight:650}
 .careDate,.careOverdue{flex-shrink:0;color:var(--ny-text-muted);font-size:9px}
 .careOverdue{color:#D77B7B}
 .careAssigned{margin-top:7px;font-size:9px;color:var(--ny-text-muted)}
 .careMove{display:flex;gap:7px;margin-top:8px}
 .careMove select{flex:1;min-width:0;min-height:38px;padding:0 9px;border:1px solid var(--ny-border-subtle);border-radius:10px;background:#0B1326;color:var(--ny-text);font-size:10px}
 .careMove .careAction{flex-shrink:0}
 .careEmpty{padding:10px 0;color:var(--ny-text-muted);font-size:10px}
 .careTextButton,.careRefresh{border:0;background:transparent;color:var(--ny-gold-soft);font-size:10px;padding:6px 0}
 .careWorkload{display:grid;gap:5px}
 .careWorkload>div{display:flex;justify-content:space-between;gap:8px;padding:7px 0;border-bottom:1px solid var(--ny-border-subtle);font-size:10px}
 .careWorkload>div span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
 .careWorkload>div b{flex-shrink:0;color:var(--ny-text-muted);font-weight:500}
 .careTeamNotice,.careTeamError{padding:8px 10px;border-radius:10px;background:rgba(143,175,214,.08);font-size:10px}
 .careTeamError{color:#F2AAAA;background:rgba(215,123,123,.08)}
 .careTeamLoading{padding:24px 0;text-align:center;color:var(--ny-text-muted);font-size:11px}
 .careFooter{display:flex;align-items:center;justify-content:space-between;padding-top:8px;border-top:1px solid var(--ny-border-subtle);color:var(--ny-text-muted);font-size:9px}
 @media(max-width:390px){.careStats{gap:5px}.careStats>div{padding:9px 6px}.careStats strong{font-size:17px}.careStats span{font-size:8px}.careMove{gap:5px}.careMove select{padding:0 6px}}
`;

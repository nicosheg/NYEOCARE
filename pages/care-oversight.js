// pages/care-oversight.js
import{useCallback,useEffect,useState}from'react';
import{useRouter}from'next/router';
import Layout from'../components/Layout';
import{getClientSession}from'../lib/clientSession';

const fmtDate=value=>value?new Date(value).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'';
const metricValue=(value)=>Number(value||0).toLocaleString();

export default function CareOversight(){
 const router=useRouter();
 const[data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const[busy,setBusy]=useState(''),[championDraft,setChampionDraft]=useState('');
 const[targetByItem,setTargetByItem]=useState({});
 const[notice,setNotice]=useState('');

 const load=useCallback(async()=>{
  setError('');
  try{
   const session=await getClientSession();
   if(!session?.access_token){await router.replace('/login');return}
   const response=await fetch('/api/care-oversight',{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});
   const body=await response.json().catch(()=>({}));
   if(response.status===403){await router.replace('/');return}
   if(!response.ok)throw new Error(body.error||'Care Oversight could not be loaded.');
   setData(body);
   setChampionDraft(body.operator_champion?.id||'');
  }catch(e){setError(e.message||'Care Oversight could not be loaded.')}
  finally{setLoading(false)}
 },[router]);

 useEffect(()=>{load()},[load]);

 const acknowledge=async id=>{
  if(busy)return;
  setBusy('support:'+id);setNotice('');setError('');
  try{
   const session=await getClientSession();
   const response=await fetch('/api/care-oversight/acknowledge',{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},
    body:JSON.stringify({message_id:id})
   });
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(body.error||'Could not acknowledge the request.');
   setNotice('The request is marked as acknowledged. Follow through with the person who asked for help.');
   await load();
  }catch(e){setError(e.message||'Could not acknowledge the request.')}
  finally{setBusy('')}
 };

 const reassign=async item=>{
  const target=targetByItem[item.queue_item_id];
  if(!target){setError('Choose an operator before reassigning.');return}
  if(busy)return;
  setBusy('reassign:'+item.queue_item_id);setNotice('');setError('');
  try{
   const session=await getClientSession();
   const response=await fetch('/api/care-oversight/reassign',{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},
    body:JSON.stringify({queue_item_id:item.queue_item_id,target_user_id:target,reason:'Leadership balanced the responsibility through Care Oversight.'})
   });
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(body.error||'Could not reassign this responsibility.');
   setNotice('Responsibility reassigned. The original care record was not changed.');
   await load();
  }catch(e){setError(e.message||'Could not reassign this responsibility.')}
  finally{setBusy('')}
 };

 const saveChampion=async()=>{
  if(busy)return;
  setBusy('champion');setNotice('');setError('');
  try{
   const session=await getClientSession();
   const response=await fetch('/api/care-oversight',{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},
    body:JSON.stringify({action:'set_champion',user_id:championDraft||null})
   });
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(body.error||'Could not save the operator champion.');
   setNotice(championDraft?'Operator champion updated. This is a support contact, not a new permission role.':'Operator champion cleared.');
   await load();
  }catch(e){setError(e.message||'Could not save the operator champion.')}
  finally{setBusy('')}
 };

 if(loading)return <Layout><main className="coShell"><div className="coLoading"/></main><style jsx>{`.coShell{max-width:1040px;margin:0 auto;padding:28px 20px}.coLoading{height:280px;border-radius:24px;background:rgba(255,255,255,.035)}`}</style></Layout>;
 if(!data)return <Layout><main className="coShell"><h1>Care Oversight</h1><p>{error||'This view could not be loaded.'}</p><button onClick={load}>Try again</button></main><style jsx>{`.coShell{max-width:1040px;margin:0 auto;padding:28px 20px;color:var(--ny-text)}`}</style></Layout>;

 const summary=data.summary||{},adoption=data.adoption||{},careLoop=data.care_loop||{},pulse=data.operator_pulse||{};
 const activeOperators=Number(adoption.active_operators)||0;
 const firstValue=Number(adoption.first_value_operators)||0;
 const supportRequests=data.support_requests||[],assignments=data.assignments||[],workloads=data.workloads||[],candidates=data.operator_candidates||[];

 return <Layout>
  <main className="coShell">
   <header className="coHeader">
    <button className="coBack" onClick={()=>router.push('/')}>‹ NYEOCARE</button>
    <div className="coEyebrow">LEADERSHIP VIEW</div>
    <h1>Care Oversight</h1>
    <p className="coIntro">Understand what the organization is carrying, where care is progressing, and where your team needs support.</p>
    <p className="coTrust">This view is for supportive accountability. It shows responsibilities, support requests and recorded outcomes—not login streaks, screen visits or operator rankings.</p>
   </header>

   {data.director?.primary_focus&&<section className="coFocus">
    <div className="coSectionEyebrow">ARIA'S CURRENT ORGANIZATIONAL FOCUS</div>
    <h2>{data.director.primary_focus.title}</h2>
    <p>{data.director.primary_focus.summary||data.director.primary_focus.reason||'ARIA is keeping the organization’s current evidence and responsibilities connected.'}</p>
   </section>}

   <section className="coMetrics" aria-label="Organizational care summary">
    <div className="coMetric"><span>Open responsibilities</span><strong>{metricValue(summary.open_responsibilities)}</strong><small>{metricValue(summary.due_today)} due today</small></div>
    <div className="coMetric"><span>Need leadership attention</span><strong>{metricValue(summary.support_requests)}</strong><small>{metricValue(summary.overdue)} overdue · {metricValue(summary.reviews)} review items also need review</small></div>
    <div className="coMetric"><span>Outcomes recorded</span><strong>{metricValue(summary.outcomes_recorded_7d)}</strong><small>Human-reported care outcomes · last 7 days</small></div>
    <div className="coMetric"><span>Follow-up completion</span><strong>{careLoop.rate===null?'—':careLoop.rate+'%'}</strong><small>{careLoop.due?metricValue(careLoop.completed_with_outcome)+' of '+metricValue(careLoop.due)+' due with an outcome':'No eligible follow-ups due this week'}</small></div>
   </section>

   {notice&&<div className="coNotice" role="status">{notice}</div>}
   {error&&<div className="coError" role="alert">{error}</div>}

   <section className="coSection">
    <div className="coSectionTop"><div><div className="coSectionEyebrow">WHEN PEOPLE ASK FOR SUPPORT</div><h2>Requests that need a response</h2></div><span className="coCount">{supportRequests.filter(x=>!x.support_acknowledged_at).length} new</span></div>
    {supportRequests.length===0?<div className="coEmpty">No support requests are waiting right now. Keep the route open for the moment someone needs another pair of hands.</div>:<div className="coStack">
     {supportRequests.map(request=><article className="coRequest" key={request.id}>
      <div className="coRequestTop"><div><strong>{request.sender?.name||'An operator'}</strong><span>{request.sender?.role||'operator'} · {fmtDate(request.sent_at)}</span></div><span className={request.support_acknowledged_at?'coStatusSeen':'coStatusNew'}>{request.support_acknowledged_at?'Acknowledged':'Needs acknowledgement'}</span></div>
      <div className="coRequestTask">{request.task_title}</div>
      <p>{request.body}</p>
      <div className="coRequestFoot"><span>Sent to {request.recipient?.name||'support contact'}</span>{!request.seen_at&&<button disabled={busy==='support:'+request.id} onClick={()=>acknowledge(request.id)}>{busy==='support:'+request.id?'Saving…':'Acknowledge'}</button>}</div>
     </article>)}
    </div>}
    <p className="coFootnote">Acknowledging means a leader has seen the request. It does not mark the underlying responsibility complete; the team still needs to agree and record the real next step.</p>
   </section>

   <section className="coSection">
    <div className="coSectionTop"><div><div className="coSectionEyebrow">MAKE WORK EASIER TO COMPLETE</div><h2>Responsibilities needing coordination</h2></div><span className="coCount">{assignments.length} shown</span></div>
    {assignments.length===0?<div className="coEmpty">No due responsibilities need rebalancing right now. ARIA will surface them here when they do.</div>:<div className="coStack">
     {assignments.map(item=><article className="coAssignment" key={item.queue_item_id}>
      <div className="coAssignmentTop"><span className="coKind">{String(item.task_kind||'action').replace(/_/g,' ')}</span><span className={item.queue_date<data.today?'coOverdue':'coDate'}>{item.queue_date<data.today?'Overdue':'Due '+item.queue_date}</span></div>
      <strong>{item.title}</strong>
      {item.message&&<p>{item.message}</p>}
      <div className="coAssignmentBottom"><span>Currently with <b>{item.assigned_to_name||'An operator'}</b></span>
       <div className="coReassign">
        <select aria-label={'Reassign '+item.title} value={targetByItem[item.queue_item_id]||''} onChange={e=>setTargetByItem(v=>({...v,[item.queue_item_id]:e.target.value}))}>
         <option value="">Choose operator</option>
         {candidates.filter(candidate=>candidate.id!==item.assigned_user_id).map(candidate=><option key={candidate.id} value={candidate.id}>{candidate.name||'Operator'}</option>)}
        </select>
        <button disabled={!targetByItem[item.queue_item_id]||busy==='reassign:'+item.queue_item_id} onClick={()=>reassign(item)}>{busy==='reassign:'+item.queue_item_id?'Moving…':'Reassign'}</button>
       </div>
      </div>
     </article>)}
    </div>}
    <p className="coFootnote">Reassignment changes who carries the queue responsibility. It does not rewrite a person’s record, change an ARIA decision or claim that the work has been completed.</p>
    <div className="coWorkloadTitle">Current workload</div>
    <p className="coFootnote">Use this view to start a capacity conversation. It is not a ranking or an operator performance score.</p>
    <div className="coWorkloads">{(data.workloads||[]).map(person=><div className="coWorkload" key={person.id}><div><strong>{person.name||'Operator'}</strong><span>{person.role==='user'?'Operator':person.role}</span></div><div className="coWorkloadCounts"><b>{Number(person.due_count)||0} due</b><span>{Number(person.open_count)||0} open · {Number(person.overdue_count)||0} overdue</span></div></div>)}</div>
   </section>

   <section className="coSection">
    <div className="coSectionTop"><div><div className="coSectionEyebrow">A TRUSTED HUMAN POINT OF CONTACT</div><h2>Operator champion</h2></div></div>
    <p className="coBody">Choose a respected colleague who can help people get comfortable, answer simple questions and bring workflow difficulties back to leadership. This is a small support role—not another permission level or an unpaid technical support department.</p>
    <div className="coChampionRow">
     <div><span className="coMiniLabel">CURRENT CONTACT</span><strong>{data.operator_champion?.name||'Not appointed'}</strong></div>
     <div className="coChampionEdit">
      <select value={championDraft} onChange={e=>setChampionDraft(e.target.value)} aria-label="Choose operator champion">
       <option value="">No champion selected</option>
       {candidates.map(candidate=><option key={candidate.id} value={candidate.id}>{candidate.name||'Operator'}</option>)}
      </select>
      <button disabled={busy==='champion'||championDraft===(data.operator_champion?.id||'')} onClick={saveChampion}>{busy==='champion'?'Saving…':'Save'}</button>
     </div>
    </div>
    {candidates.length===0&&<p className="coFootnote">No active user-role operators are available to appoint yet. Owners and admins remain the fallback support contacts.</p>}
   </section>

   <section className="coSection">
    <div className="coSectionTop"><div><div className="coSectionEyebrow">TEAM HEALTH, NOT INDIVIDUAL SCORES</div><h2>Is the experience getting easier?</h2></div></div>
    <div className="coAdoptionGrid">
     <div className="coAdoptionStat"><span>First Value</span><strong>{activeOperators?firstValue+' / '+activeOperators:'—'}</strong><small>Active operators who have completed a meaningful task at least once.</small></div>
     <div className="coAdoptionStat"><span>Meaningful return</span><strong>{activeOperators?metricValue(adoption.repeat_operators):'—'}</strong><small>Operators with completed work on 2+ different days in the last 30 days—not app opens.</small></div>
    </div>
    <div className="coPulse">
     <div><span className="coMiniLabel">WEEKLY OPERATOR PULSE</span><strong>{pulse.current?.sufficient_sample?pulse.current.responses+' responses this week':'Team averages appear after at least three responses'}</strong><p>Scores are shown only after at least three operators respond. Individual answers are never shown in Care Oversight.</p></div>
     {pulse.current?.sufficient_sample&&<div className="coAverages">
      <span>Ease <b>{pulse.current.ease}/5</b></span><span>Clarity <b>{pulse.current.clarity}/5</b></span><span>Confidence <b>{pulse.current.confidence}/5</b></span>
     </div>}
    </div>
   </section>

   <section className="coSection">
    <div className="coSectionEyebrow">A TEN-MINUTE LEADERSHIP RITUAL</div>
    <h2>Make space for the people doing the work.</h2>
    <div className="coRitual">
     <p><b>What moved forward?</b><span>Recognize genuine outcomes—not app activity.</span></p>
     <p><b>What remains unresolved?</b><span>Agree the next human action instead of pretending it is complete.</span></p>
     <p><b>Where is someone stuck?</b><span>Offer capacity, context or a better owner for the responsibility.</span></p>
     <p><b>What should be easier next week?</b><span>Fix the workflow friction rather than demanding more effort.</span></p>
    </div>
   </section>
   <footer className="coFooter"><span>NYEOCARE · Accountability without intimidation. Visibility without surveillance.</span><button onClick={load} disabled={loading}>Refresh view</button></footer>
  </main>
  <style jsx>{`
   .coShell{max-width:980px;margin:0 auto;padding:22px 22px calc(38px + env(safe-area-inset-bottom));color:var(--ny-text)}
   .coHeader{padding:8px 0 24px}
   .coBack{border:0;background:transparent;color:var(--ny-text-muted);font-size:11px;padding:0;margin:0 0 23px;cursor:pointer}
   .coEyebrow,.coSectionEyebrow,.coMiniLabel{font-size:9px;letter-spacing:.2em;color:var(--ny-gold);font-weight:700}
   h1{margin:8px 0 8px;font-size:clamp(32px,7vw,48px);line-height:1;letter-spacing:-.045em;font-weight:620}
   .coIntro{max-width:650px;margin:0;color:var(--ny-text-secondary);font-size:14px;line-height:1.6}
   .coTrust{max-width:720px;margin:13px 0 0;padding-left:11px;border-left:2px solid rgba(214,184,106,.4);color:var(--ny-text-whisper);font-size:10px;line-height:1.5}
   .coFocus{padding:17px 18px;margin:0 0 16px;border:1px solid rgba(214,184,106,.20);border-radius:19px;background:linear-gradient(140deg,rgba(214,184,106,.09),rgba(255,255,255,.018))}
   .coFocus h2{margin:6px 0 5px;font-size:18px;line-height:1.3;color:var(--ny-text)}
   .coFocus p{margin:0;color:var(--ny-text-muted);font-size:12px;line-height:1.55}
   .coMetrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px;margin:16px 0 22px}
   .coMetric{min-width:0;padding:13px 13px 12px;border:1px solid var(--ny-border-subtle);border-radius:16px;background:rgba(255,255,255,.026)}
   .coMetric span{display:block;color:var(--ny-text-muted);font-size:9px;line-height:1.4;min-height:25px}
   .coMetric strong{display:block;margin:5px 0;font-size:25px;line-height:1;color:var(--ny-text);letter-spacing:-.04em;font-variant-numeric:tabular-nums}
   .coMetric small{display:block;color:var(--ny-text-whisper);font-size:8px;line-height:1.45}
   .coNotice,.coError{padding:11px 13px;margin:10px 0;border-radius:12px;font-size:11px;line-height:1.5}
   .coNotice{border:1px solid rgba(127,191,154,.2);background:rgba(127,191,154,.06);color:var(--ny-success)}
   .coError{border:1px solid rgba(239,68,68,.18);background:rgba(239,68,68,.07);color:#fca5a5}
   .coSection{padding:21px 0;border-top:1px solid var(--ny-border-subtle)}
   .coWorkloadTitle{margin-top:18px;color:var(--ny-text-secondary);font-size:11px;font-weight:650}
   .coWorkloads{display:grid;gap:6px;margin-top:9px}
   .coWorkload{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--ny-border-subtle);border-radius:12px;background:rgba(255,255,255,.018)}
   .coWorkload>div:first-child{display:grid;gap:2px}
   .coWorkload strong{color:var(--ny-text-secondary);font-size:10px;font-weight:600}
   .coWorkload span{color:var(--ny-text-whisper);font-size:8px}
   .coWorkloadCounts{display:grid;gap:2px;text-align:right;white-space:nowrap}
   .coWorkloadCounts b{color:var(--ny-text);font-size:10px;font-weight:650}
   .coWorkloadCounts span{color:var(--ny-text-whisper);font-size:8px}
   .coSectionTop{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:12px}
   .coSection h2{margin:5px 0 0;font-size:18px;letter-spacing:-.025em;color:var(--ny-text);font-weight:620}
   .coCount{color:var(--ny-text-whisper);font-size:9px;white-space:nowrap}
   .coEmpty{padding:15px 16px;border:1px solid var(--ny-border-subtle);border-radius:15px;background:rgba(255,255,255,.02);color:var(--ny-text-muted);font-size:12px;line-height:1.55}
   .coStack{display:grid;gap:9px}
   .coRequest,.coAssignment{padding:14px;border:1px solid var(--ny-border-subtle);border-radius:16px;background:rgba(255,255,255,.025)}
   .coRequestTop,.coRequestFoot,.coAssignmentTop,.coAssignmentBottom{display:flex;align-items:center;justify-content:space-between;gap:10px}
   .coRequestTop>div{display:grid;gap:3px}
   .coRequestTop strong,.coAssignment>strong{color:var(--ny-text);font-size:12px;font-weight:650}
   .coRequestTop span,.coRequestFoot span,.coAssignmentBottom span{color:var(--ny-text-whisper);font-size:9px}
   .coStatusNew,.coStatusSeen{padding:4px 7px;border-radius:999px;font-size:8px!important}
   .coStatusNew{border:1px solid rgba(214,184,106,.22);color:var(--ny-gold-soft)!important;background:rgba(214,184,106,.07)}
   .coStatusSeen{border:1px solid rgba(127,191,154,.16);color:var(--ny-success)!important;background:rgba(127,191,154,.045)}
   .coRequestTask{margin-top:11px;color:var(--ny-text);font-size:12px;font-weight:620}
   .coRequest p,.coAssignment p{margin:5px 0 10px;color:var(--ny-text-secondary);font-size:11px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}
   .coRequestFoot{padding-top:10px;border-top:1px solid var(--ny-border-subtle)}
   .coRequestFoot button,.coReassign button,.coChampionEdit button{padding:8px 11px;border:1px solid rgba(214,184,106,.24);border-radius:999px;background:rgba(214,184,106,.08);color:var(--ny-gold-soft);font-size:10px;font-weight:650;cursor:pointer}
   .coRequestFoot button:disabled,.coReassign button:disabled,.coChampionEdit button:disabled{opacity:.45;cursor:default}
   .coFootnote{margin:9px 0 0;color:var(--ny-text-whisper);font-size:9px;line-height:1.5}
   .coKind{font-size:8px;letter-spacing:.08em;text-transform:uppercase;color:var(--ny-aria)}
   .coDate{font-size:9px;color:var(--ny-text-whisper)}
   .coOverdue{font-size:9px;color:#e8b57b}
   .coAssignment>strong{display:block;margin-top:8px}
   .coAssignmentBottom{align-items:flex-start;padding-top:10px;border-top:1px solid var(--ny-border-subtle)}
   .coAssignmentBottom b{color:var(--ny-text-secondary);font-weight:600}
   .coReassign{display:flex;align-items:center;gap:6px}
   select{max-width:165px;min-width:0;padding:8px 9px;border:1px solid var(--ny-border);border-radius:10px;background:rgba(5,12,24,.8);color:var(--ny-text);font:inherit;font-size:10px}
   .coBody{margin:9px 0 13px;color:var(--ny-text-muted);font-size:12px;line-height:1.6;max-width:720px}
   .coChampionRow{display:flex;align-items:center;justify-content:space-between;gap:15px;padding:13px 14px;border:1px solid var(--ny-border-subtle);border-radius:15px;background:rgba(255,255,255,.025)}
   .coChampionRow>div:first-child{display:grid;gap:5px}
   .coChampionRow strong{font-size:13px;color:var(--ny-text)}
   .coChampionEdit{display:flex;gap:7px;align-items:center}
   .coAdoptionGrid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:13px 0}
   .coAdoptionStat{padding:13px;border:1px solid var(--ny-border-subtle);border-radius:15px;background:rgba(255,255,255,.025)}
   .coAdoptionStat span{display:block;color:var(--ny-text-muted);font-size:10px}
   .coAdoptionStat strong{display:block;margin:4px 0;color:var(--ny-text);font-size:23px;font-variant-numeric:tabular-nums}
   .coAdoptionStat small{display:block;color:var(--ny-text-whisper);font-size:9px;line-height:1.5}
   .coPulse{display:flex;justify-content:space-between;gap:15px;padding:14px;border:1px solid rgba(143,175,214,.15);border-radius:15px;background:rgba(143,175,214,.04)}
   .coPulse>div:first-child{display:grid;gap:5px}
   .coPulse strong{font-size:12px;color:var(--ny-text)}
   .coPulse p{margin:0;color:var(--ny-text-whisper);font-size:9px;line-height:1.5}
   .coAverages{display:grid;gap:6px;align-content:center;min-width:120px}
   .coAverages span{display:flex;justify-content:space-between;gap:12px;color:var(--ny-text-muted);font-size:10px}
   .coAverages b{color:var(--ny-aria);font-variant-numeric:tabular-nums}
   .coRitual{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:13px}
   .coRitual p{margin:0;padding:12px;border:1px solid var(--ny-border-subtle);border-radius:14px;background:rgba(255,255,255,.022);display:grid;gap:4px}
   .coRitual b{font-size:11px;color:var(--ny-text);font-weight:650}
   .coRitual span{font-size:9px;line-height:1.45;color:var(--ny-text-muted)}
   .coFooter{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:16px;border-top:1px solid var(--ny-border-subtle);color:var(--ny-text-whisper);font-size:9px}
   .coFooter button,.coBack{font:inherit;cursor:pointer}
   .coFooter button{border:0;background:transparent;color:var(--ny-aria);font-size:10px}
   @media(max-width:700px){.coShell{padding:16px 15px calc(30px + env(safe-area-inset-bottom))}.coMetrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.coMetric{padding:11px}.coSection{padding:17px 0}.coReassign{width:100%;margin-top:8px}.coAssignmentBottom{display:block}.coReassign select{flex:1;max-width:none}.coChampionRow{align-items:flex-start;flex-direction:column}.coChampionEdit{width:100%}.coChampionEdit select{flex:1;max-width:none}.coPulse{flex-direction:column}.coAverages{grid-template-columns:repeat(3,1fr);min-width:0}.coRitual{grid-template-columns:1fr 1fr}}
   @media(max-width:400px){.coRitual{grid-template-columns:1fr}.coRequestTop{align-items:flex-start}.coStatusNew,.coStatusSeen{white-space:nowrap}.coFooter{align-items:flex-start;flex-direction:column}}
  `}</style>
 </Layout>;
}

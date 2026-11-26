// components/CareIntakeReview.js
import { useCallback,useEffect,useMemo,useState } from 'react';
import { getClientSession } from '../lib/clientSession';

const uuid = () => globalThis.crypto?.randomUUID?.() ||
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r=Math.random()*16|0;
    return (c==='x'?r:(r&3|8)).toString(16);
  });
const categoryLabel=value=>({
  first_visit:'First visit',prayer_request:'Prayer request',personal_need:'Personal need',
  practical_support:'Practical support',relationship_request:'Relationship request',
  complaint:'Concern or complaint',check_in:'Check-in',general:'General'
})[value]||'Care signal';
const addDay=value=>{
  const date=new Date((value||new Date().toISOString().slice(0,10))+'T12:00:00');
  date.setDate(date.getDate()+1);
  return date.toISOString().slice(0,10);
};

export default function CareIntakeReview() {
  const [items,setItems]=useState([]);
  const [showAll,setShowAll]=useState(false);
  const [candidates,setCandidates]=useState([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [drafts,setDrafts]=useState({});
  const [matches,setMatches]=useState({});
  const [searching,setSearching]=useState('');

  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{
      const session=await getClientSession();
      if(!session?.access_token)throw new Error('Sign in again to review care signals.');
      const response=await fetch('/api/aria/intake?status=pending&limit=30',{
        headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'
      });
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.error||'Care signals could not be loaded.');
      setItems(Array.isArray(body.items)?body.items:[]);
      setCandidates(Array.isArray(body.review_operators)?body.review_operators:[]);
    }catch(e){setError(e.message||'Care signals could not be loaded.')}
    finally{setLoading(false)}
  },[]);

  useEffect(()=>{
    load();
    const refresh=()=>load();
    window.addEventListener('nyeocare:care-intake-created',refresh);
    return()=>window.removeEventListener('nyeocare:care-intake-created',refresh);
  },[load]);

  const update=(id,patch)=>setDrafts(current=>({
    ...current,[id]:{...(current[id]||{}),...patch}
  }));
  const getDraft=item=>{
    const role=String(item.privacy_class||'sensitive');
    const allowed=candidates.filter(candidate=>
      role==='restricted'?['owner','admin'].includes(String(candidate.role).toLowerCase()):
      role==='sensitive'?['owner','admin','leader'].includes(String(candidate.role).toLowerCase()):
      true
    );
    const existing=drafts[item.id]||{};
    const due=existing.due_date||today||new Date().toISOString().slice(0,10);
    return {
      ...existing,
      title:existing.title||'Review care request',
      due_date:due,
      defer_until:existing.defer_until||addDay(due),
      assigned_user_id:existing.assigned_user_id||allowed[0]?.id||'',
      resolved_person_id:existing.resolved_person_id||'',
      contact_permission:existing.contact_permission||item.intake?.contact_permission||'unknown'
    };
  };

  const searchPeople=async item=>{
    const d=getDraft(item);
    if(!d.person_search?.trim())return;
    setSearching(item.id);setError('');
    try{
      const session=await getClientSession();
      const response=await fetch('/api/people?search='+encodeURIComponent(d.person_search.trim())+'&limit=6',{
        headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'
      });
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.error||'People search failed.');
      setMatches(current=>({...current,[item.id]:Array.isArray(body.items)?body.items:[]}));
    }catch(e){setError(e.message||'People search failed.')}
    finally{setSearching('')}
  };

  const decide=async(item,decision)=>{
    const d=getDraft(item);
    if(busy)return;
    if(decision==='approved'&&!d.assigned_user_id){
      setError('Choose an authorized accountable operator first.');return;
    }
    if(decision==='approved'&&!item.person_id&&!d.resolved_person_id){
      setError('Link this signal to the correct person before approving it.');return;
    }
    setBusy(item.id+':'+decision);setError('');setNotice('');
    try{
      const session=await getClientSession();
      const body={
        intake_event_id:item.id,
        idempotency_key:uuid(),
        decision,
        reason:decision==='dismissed'?'Reviewed by an authorized leader.':''
      };
      if(decision==='approved'){
        body.assigned_user_id=d.assigned_user_id;
        body.due_date=d.due_date;
        body.title=d.title;
        body.contact_permission=d.contact_permission;
        body.resolved_person_id=d.resolved_person_id||undefined;
      }
      if(decision==='deferred')body.defer_until=d.defer_until;
      const response=await fetch('/api/aria/intake-review',{
        method:'POST',
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},
        body:JSON.stringify(body)
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error||'The review decision could not be saved.');
      setNotice(decision==='approved'?'Care responsibility approved and assigned.':decision==='dismissed'?'Care signal dismissed with an audit record.':'Care signal deferred with a review date.');
      await load();
      if(typeof window!=='undefined')window.dispatchEvent(new Event('nyeocare:care-intake-reviewed'));
    }catch(e){setError(e.message||'The review decision could not be saved.')}
    finally{setBusy('')}
  };

  return <section className="intakeReview" aria-label="Care signal review">
    <header><div><h3>Care signals to review</h3><p>Reports are not tasks until a leader decides the next step.</p></div><button type="button" onClick={load} aria-label="Refresh care signals">↻</button></header>
    {(error||notice)&&<div className={error?'reviewError':'reviewNotice'} role="status">{error||notice}</div>}
    {loading?<div className="reviewEmpty">Loading care signals…</div>:items.length===0?<div className="reviewEmpty">No care signals waiting for review.</div>:
      (showAll?items:items.slice(0,3)).map(item=>{
        const d=getDraft(item);
        const allowed=candidates.filter(candidate=>
          item.privacy_class==='restricted'?['owner','admin'].includes(String(candidate.role).toLowerCase()):
          item.privacy_class==='sensitive'?['owner','admin','leader'].includes(String(candidate.role).toLowerCase()):
          true
        );
        return <article className="reviewCard" key={item.id}>
          <div className="reviewTop"><strong>{categoryLabel(item.intake?.category)}</strong><span>{item.privacy_class||'sensitive'}</span></div>
          <div className="reviewPerson">{item.display_name||item.person_name||(item.person_id?'Linked person':'Person not linked yet')}</div>
          {(item.intake?.summary||item.intake?.statement)&&<p className="reviewStatement">{item.intake.summary||item.intake.statement}</p>}
          <p className="reviewMeta">{item.intake?.channel||'operator note'} · {item.consent_status||'unknown'} consent · Contact: {item.intake?.contact_permission||'unknown'} · Reported {new Date(item.occurred_at).toLocaleDateString()}</p>
          {!item.person_id&&<div className="reviewLink">
            <div className="reviewSearch"><input value={d.person_search||''} placeholder="Search to link the right person" onChange={e=>update(item.id,{person_search:e.target.value})}/><button type="button" disabled={searching===item.id} onClick={()=>searchPeople(item)}>{searching===item.id?'Searching…':'Search'}</button></div>
            {(matches[item.id]||[]).map(person=><button type="button" className="reviewMatch" key={person.id} onClick={()=>{update(item.id,{resolved_person_id:person.id,person_search:person.display_name||person.first_name});setMatches(current=>({...current,[item.id]:[]}))}}>{person.display_name||[person.first_name,person.last_name].filter(Boolean).join(' ')}{person.phone?' · '+person.phone:''}</button>)}
            {d.resolved_person_id&&<small>Person link selected. It will be recorded as a human review decision.</small>}
          </div>}
          {item.consent_status!=='granted'&&<small className="reviewConsent">Consent must be explicitly confirmed before this signal can become an identifiable care responsibility. Record a new signal with the person's consent first.</small>}
          <div className="reviewFields">
            <label>Contact permission verified<select value={d.contact_permission} onChange={e=>update(item.id,{contact_permission:e.target.value})}>
              <option value="unknown">Not confirmed</option>
              <option value="allowed">Person confirmed contact is okay</option>
            </select></label>
            <label>Accountable person<select value={d.assigned_user_id} onChange={e=>update(item.id,{assigned_user_id:e.target.value})}>
              <option value="">Choose an operator</option>{allowed.map(person=><option key={person.id} value={person.id}>{person.name} · {person.role}</option>)}
            </select></label>
            <label>Due date<input type="date" value={d.due_date} onChange={e=>update(item.id,{due_date:e.target.value})}/></label>
            <label>Task title<input value={d.title} onChange={e=>update(item.id,{title:e.target.value})}/></label>
            <label>Defer until<input type="date" value={d.defer_until} min={addDay(today||d.due_date)} onChange={e=>update(item.id,{defer_until:e.target.value})}/></label>
          </div>
          <div className="reviewActions">
            <button type="button" className="reviewDismiss" disabled={!!busy} onClick={()=>decide(item,'dismissed')}>Dismiss</button>
            <button type="button" className="reviewDefer" disabled={!!busy} onClick={()=>decide(item,'deferred')}>Defer</button>
            <button type="button" className="reviewApprove" disabled={!!busy||!allowed.length||item.consent_status!=='granted'} onClick={()=>decide(item,'approved')}>{busy===item.id+':approved'?'Saving…':'Approve & assign'}</button>
          </div>
        </article>;
      })
    }
    {!loading&&items.length>3&&<button type="button" className="reviewShowAll" onClick={()=>setShowAll(v=>!v)}>{showAll?'Show less':'Show all '+items.length+' signals'}</button>}
    <style jsx>{`
      .intakeReview{display:grid;gap:9px;padding:12px;border:1px solid var(--ny-border-subtle);border-radius:14px;background:rgba(255,255,255,.02)}
      .intakeReview>header{display:flex;justify-content:space-between;align-items:center;gap:8px}
      h3{margin:0;font-size:12px;font-weight:650;color:var(--ny-text)}
      .intakeReview header p{margin:3px 0 0;color:var(--ny-text-muted);font-size:9px;line-height:1.4}
      .intakeReview header button{border:0;background:transparent;color:var(--ny-gold-soft);font-size:17px}
      .reviewEmpty{padding:8px 0;color:var(--ny-text-muted);font-size:10px}
      .reviewCard{display:grid;gap:8px;padding:10px;border:1px solid var(--ny-border-subtle);border-radius:11px;background:rgba(255,255,255,.025)}
      .reviewTop{display:flex;align-items:center;justify-content:space-between;gap:8px}
      .reviewTop strong{font-size:11px}.reviewTop span{font-size:9px;color:var(--ny-text-muted);text-transform:capitalize}
      .reviewPerson{font-size:11px;font-weight:600;color:var(--ny-text)}
      .reviewStatement{margin:0;color:var(--ny-text-muted);font-size:10px;line-height:1.4;overflow-wrap:anywhere}
      .reviewMeta{margin:0;color:var(--ny-text-muted);font-size:9px}
      .reviewFields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
      label{display:grid;gap:4px;font-size:9px;color:var(--ny-text-muted)}
      input,select{width:100%;min-width:0;min-height:34px;border:1px solid var(--ny-border-subtle);border-radius:8px;background:#0B1326;color:var(--ny-text);padding:6px;font:inherit;font-size:10px}
      .reviewSearch{display:flex;gap:6px}.reviewSearch input{flex:1}.reviewSearch button{border:1px solid var(--ny-border-subtle);border-radius:8px;background:rgba(255,255,255,.04);color:var(--ny-text);padding:0 9px;font-size:10px}
      .reviewMatch{width:100%;margin-top:4px;text-align:left;min-height:32px;border:1px solid var(--ny-border-subtle);border-radius:8px;background:rgba(255,255,255,.03);color:var(--ny-text);font-size:10px;padding:6px}
      .reviewLink small{display:block;margin-top:5px;color:var(--ny-text-muted);font-size:9px}.reviewConsent{color:var(--ny-text-muted);font-size:9px;line-height:1.4}
      .reviewShowAll{justify-self:start;border:0;background:transparent;color:var(--ny-gold-soft);font-size:10px;padding:4px 0}
      .reviewActions{display:flex;justify-content:flex-end;gap:6px;flex-wrap:wrap}
      .reviewActions button{min-height:34px;padding:0 10px;border-radius:9px;font-size:9px}
      .reviewDismiss{border:1px solid var(--ny-border-subtle);background:transparent;color:var(--ny-text-muted)}
      .reviewDefer{border:1px solid var(--ny-border-subtle);background:rgba(255,255,255,.04);color:var(--ny-text)}
      .reviewApprove{border:1px solid rgba(214,184,106,.25);background:rgba(214,184,106,.1);color:var(--ny-gold-soft);font-weight:650}
      .reviewError{padding:8px;border-radius:8px;background:rgba(215,123,123,.08);color:#F2AAAA;font-size:10px}
      .reviewNotice{padding:8px;border-radius:8px;background:rgba(143,175,214,.08);color:var(--ny-text);font-size:10px}
      button:disabled{opacity:.45}
      @media(max-width:390px){.reviewFields{gap:6px}.reviewActions button{padding:0 8px}}
    `}</style>
  </section>;
}

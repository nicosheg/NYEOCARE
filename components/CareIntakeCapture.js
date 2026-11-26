// components/CareIntakeCapture.js
import { useRef, useState } from 'react';
import { getClientSession } from '../lib/clientSession';

const CATEGORIES = [
  ['first_visit','First visit'],
  ['prayer_request','Prayer request'],
  ['personal_need','Personal need'],
  ['practical_support','Practical support'],
  ['relationship_request','Relationship request'],
  ['complaint','Concern or complaint'],
  ['check_in','Check-in'],
  ['general','General care signal']
];

const uuid = () => globalThis.crypto?.randomUUID?.() ||
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 3 | 8)).toString(16);
  });

export default function CareIntakeCapture() {
  const [open,setOpen] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [category,setCategory] = useState('general');
  const [channel,setChannel] = useState('in_person');
  const [consent,setConsent] = useState('unknown');
  const [contact,setContact] = useState('unknown');
  const [statement,setStatement] = useState('');
  const [personQuery,setPersonQuery] = useState('');
  const [matches,setMatches] = useState([]);
  const [person,setPerson] = useState(null);
  const [searching,setSearching] = useState(false);
  const submissionRef = useRef({ fingerprint: null, key: null });

  const findPerson = async () => {
    if(!personQuery.trim())return;
    setSearching(true);setError('');
    try {
      const session=await getClientSession();
      if(!session?.access_token)throw new Error('Sign in again to search people.');
      const response=await fetch('/api/people?search='+encodeURIComponent(personQuery.trim())+'&limit=8',{
        headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'
      });
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.error||'People search failed.');
      setMatches(Array.isArray(body.items)?body.items:[]);
      if(!body.items?.length)setError('No matching active person was found. You can record this signal without a person link.');
    } catch(e){setError(e.message||'People search failed.')}
    finally{setSearching(false)}
  };

  const submit = async event => {
    event.preventDefault();
    if(busy)return;
    if(contact==='do_not_contact'&&!person){
      setError('Select the person before recording a no-contact request.');
      return;
    }
    setBusy(true);setError('');setNotice('');
    try{
      const session=await getClientSession();
      if(!session?.access_token)throw new Error('Sign in again to record this care signal.');
      const response=await fetch('/api/aria/intake',{
        method:'POST',
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},
        body:JSON.stringify((() => {
          const payload = {
            category,
            person_id:person?.id||null,
            consent_status:consent,
            contact_permission:contact,
            channel,
            statement:consent==='granted'||(!person&&consent==='not_required')?statement:'',
            summary:consent==='granted'||(!person&&consent==='not_required')?statement.slice(0,240):''
          };
          const fingerprint = JSON.stringify(payload);
          if(submissionRef.current.fingerprint !== fingerprint){
            submissionRef.current = { fingerprint, key: uuid() };
          }
          return { ...payload, idempotency_key: submissionRef.current.key };
        })())
      });
      const body=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(body.error||'The care signal could not be saved.');
      setNotice(body.duplicate?'This signal was already recorded.':'Signal saved for human review. No task or message was created.');
      submissionRef.current = { fingerprint: null, key: null };
      setStatement('');
      setPerson(null);setPersonQuery('');setMatches([]);
      setConsent('unknown');setContact('unknown');setCategory('general');
      if(typeof window!=='undefined')window.dispatchEvent(new Event('nyeocare:care-intake-created'));
    }catch(e){setError(e.message||'The care signal could not be saved.')}
    finally{setBusy(false)}
  };

  return <section className="careCapture">
    <button type="button" className="captureToggle" onClick={()=>{setOpen(v=>!v);setError('');setNotice('')}} aria-expanded={open}>
      <span aria-hidden="true">＋</span> Record a care signal
    </button>
    {open&&<form className="captureForm" onSubmit={submit}>
      <div className="captureHeading"><strong>Record what someone shared</strong><span>Human review required</span></div>
      <label>What is this about?
        <select value={category} onChange={e=>setCategory(e.target.value)}>
          {CATEGORIES.map(([value,label])=><option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label>Person (optional)
        {person?<div className="selectedPerson"><span>{person.display_name||[person.first_name,person.last_name].filter(Boolean).join(' ')}</span><button type="button" onClick={()=>setPerson(null)}>Change</button></div>:<div className="personSearch"><input value={personQuery} onChange={e=>setPersonQuery(e.target.value)} placeholder="Search name or phone"/><button type="button" disabled={searching||!personQuery.trim()} onClick={findPerson}>{searching?'Searching…':'Search'}</button></div>}
      </label>
      {!person&&matches.length>0&&<div className="personMatches">{matches.map(item=><button type="button" key={item.id} onClick={()=>{setPerson(item);setMatches([]);setError('')}}>{item.display_name||[item.first_name,item.last_name].filter(Boolean).join(' ')}{item.phone?' · '+item.phone:''}</button>)}</div>}
      <div className="captureGrid">
        <label>Consent
          <select value={consent} onChange={e=>setConsent(e.target.value)}>
            <option value="unknown">Not confirmed</option>
            <option value="granted">Granted</option>
            <option value="declined">Declined</option>
            <option value="withdrawn">Withdrawn</option>
            {!person&&<option value="not_required">Not required (anonymous)</option>}
          </select>
        </label>
        <label>Contact preference
          <select value={contact} onChange={e=>setContact(e.target.value)}>
            <option value="unknown">Not known</option>
            <option value="allowed">Person said contact is okay</option>
            <option value="do_not_contact">Do not contact</option>
          </select>
        </label>
      </div>
      <label>How was this received?
        <select value={channel} onChange={e=>setChannel(e.target.value)}>
          <option value="in_person">In person</option>
          <option value="phone">Phone</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="email">Email</option>
          <option value="form">Form</option>
          <option value="operator_note">Operator note</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label>Brief note
        <textarea value={statement} onChange={e=>setStatement(e.target.value)} maxLength={1800} rows={3}
          placeholder={consent==='granted'||(!person&&consent==='not_required')?'Record only what is needed for the next human decision.':'Details are withheld until consent is confirmed.'}
          disabled={!(consent==='granted'||(!person&&consent==='not_required'))}/>
      </label>
      <p className="capturePrivacy">Private by default. Unknown consent stores the signal category and source, not the narrative. Prayer requests, personal needs and complaints receive restricted access.</p>
      {(error||notice)&&<div className={error?'captureError':'captureNotice'} role="status">{error||notice}</div>}
      <div className="captureActions"><button type="button" className="captureCancel" onClick={()=>setOpen(false)}>Close</button><button type="submit" className="captureSave" disabled={busy}>{busy?'Saving…':'Save for review'}</button></div>
    </form>}
    <style jsx>{`
      .careCapture{min-width:0}
      .captureToggle{min-height:35px;padding:0 12px;border:1px solid rgba(214,184,106,.28);border-radius:11px;background:rgba(214,184,106,.08);color:var(--ny-gold-soft);font-size:11px;font-weight:650}
      .captureToggle span{font-size:15px;margin-right:4px}
      .captureForm{display:grid;gap:10px;margin-top:8px;padding:12px;border:1px solid var(--ny-border-subtle);border-radius:13px;background:rgba(255,255,255,.025)}
      .captureHeading{display:flex;justify-content:space-between;gap:8px;align-items:center}
      .captureHeading strong{font-size:12px}.captureHeading span{font-size:9px;color:var(--ny-text-muted)}
      label{display:grid;gap:5px;color:var(--ny-text-muted);font-size:10px}
      select,input,textarea{width:100%;min-width:0;min-height:38px;border:1px solid var(--ny-border-subtle);border-radius:9px;background:#0B1326;color:var(--ny-text);padding:8px;font:inherit;font-size:11px}
      textarea{resize:vertical;line-height:1.4}textarea:disabled{opacity:.55}
      .personSearch{display:flex;gap:6px}.personSearch input{flex:1}.personSearch button,.selectedPerson button{flex-shrink:0;border:1px solid var(--ny-border-subtle);border-radius:9px;background:rgba(255,255,255,.04);color:var(--ny-text);padding:0 10px;font-size:10px}
      .selectedPerson{display:flex;justify-content:space-between;gap:8px;align-items:center;min-height:38px;padding:5px 8px;border-radius:9px;background:rgba(255,255,255,.04);font-size:11px;color:var(--ny-text)}
      .personMatches{display:grid;gap:4px}.personMatches button{text-align:left;min-height:34px;padding:6px 9px;border:1px solid var(--ny-border-subtle);border-radius:8px;background:rgba(255,255,255,.03);color:var(--ny-text);font-size:10px}
      .captureGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
      .capturePrivacy{margin:0;color:var(--ny-text-muted);font-size:9px;line-height:1.4}
      .captureError,.captureNotice{padding:8px;border-radius:8px;background:rgba(215,123,123,.08);color:#F2AAAA;font-size:10px}
      .captureNotice{background:rgba(143,175,214,.08);color:var(--ny-text)}
      .captureActions{display:flex;justify-content:flex-end;gap:7px}
      .captureActions button{min-height:36px;padding:0 12px;border-radius:9px;font-size:10px}
      .captureCancel{border:1px solid var(--ny-border-subtle);background:transparent;color:var(--ny-text-muted)}
      .captureSave{border:1px solid rgba(214,184,106,.24);background:rgba(214,184,106,.12);color:var(--ny-gold-soft);font-weight:650}
      button:disabled{opacity:.5}
    `}</style>
  </section>;
}

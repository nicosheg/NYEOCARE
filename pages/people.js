// pages/people.js
import{useState,useEffect,useRef,useCallback}from'react';
import Link from'next/link';
import{useRouter}from'next/router';
import Layout from'../components/Layout';
import FirstExperience from'../components/FirstExperience';
import BirthdayPicker from'../components/BirthdayPicker';
import{supabase}from'../lib/supabaseClient';
import{useOnboarding}from'../components/OnboardingProvider';

const ICONS={
visitor:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-7 8-7s8 3 8 7"/></svg>,
phone:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12" y2="18.01" stroke="currentColor" strokeWidth="3"/></svg>,
calendar:<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
mail:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 7l10 7 10-7"/></svg>,
note:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l1-4L16.5 3.5z"/></svg>,
importIcon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
check:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="2"><path d="M20 6L9 17l-5-5"/></svg>,
trash:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>,
edit:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l1-4L16.5 3.5z"/></svg>,
chevron:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 6 15 12 9 18"/></svg>
};

const getNextBirthday=b=>{
if(!b)return null;
const today=new Date(),d=new Date(`${b}T00:00:00`);
d.setFullYear(today.getFullYear());
if(d<today)d.setFullYear(today.getFullYear()+1);
return Math.max(0,Math.ceil((d-today)/86400000));
};

const statusColor=s=>s==='alive'?'#8FB7FF':s==='needs_decision'?'#D4AF37':s==='conflict'?'#8FB7FF':'rgba(255,255,255,.4)';
const statusLabel=s=>s==='alive'?'Stable Truth':s==='needs_decision'?'Needs Evidence':s==='conflict'?'Human Review Required':'';
const statusExplanation=(s,c)=>s==='alive'?`ARIA is highly confident this identity is correct. (Confidence: ${c||90}%)`:s==='needs_decision'?'ARIA needs more evidence before confirming this identity.':s==='conflict'?'ARIA found multiple possible identities and requires human review.':null;
const inputStyle={padding:'10px 12px',borderRadius:10,border:'1px solid rgba(255,255,255,.06)',background:'rgba(20,25,40,.6)',color:'#fff',outline:'none',width:'100%'};
const labelStyle={display:'block',fontSize:13,color:'rgba(255,255,255,.5)',marginBottom:4};
const birthdayButtonStyle=value=>({width:'100%',padding:'12px 16px',borderRadius:10,border:'1px solid rgba(255,255,255,.06)',background:'rgba(20,25,40,.6)',color:value?'#f0f0f0':'rgba(255,255,255,.3)',fontSize:15,textAlign:'left',cursor:'pointer',outline:'none'});
const panelStyle={marginTop:12,background:'rgba(20,25,40,.9)',borderRadius:12,padding:12,border:'1px solid rgba(255,255,255,.05)'};

function LoadingSkeleton(){
return <div style={{maxWidth:1100,margin:'0 auto',padding:20}}>
<div style={{height:36,width:'30%',borderRadius:8,marginBottom:25,background:'rgba(255,255,255,.04)'}}/>
<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(270px,1fr))',gap:12}}>
{[1,2,3,4,5,6].map(i=><div key={i} className="fiducia-card shimmer" style={{padding:24,height:180}}/>)}
</div>
</div>;
}

export default function PeoplePage(){
const router=useRouter();
const onboarding=useOnboarding();
const[people,setPeople]=useState([]);
const[search,setSearch]=useState('');
const[roleFilter,setRoleFilter]=useState('all');
const[showLivingTruthOnly,setShowLivingTruthOnly]=useState(false);
const[msg,setMsg]=useState('');
const[loading,setLoading]=useState(true);
const[showAdd,setShowAdd]=useState(false);
const[form,setForm]=useState({full_name:'',phone:'',email:'',type:'visitor',birthday:''});
const[expandedId,setExpandedId]=useState(null);
const[addingNote,setAddingNote]=useState(false);
const[noteText,setNoteText]=useState('');
const[importingConv,setImportingConv]=useState(false);
const[convText,setConvText]=useState('');
const[showPicker,setShowPicker]=useState(false);
const[pickerTarget,setPickerTarget]=useState(null);
const[editingId,setEditingId]=useState(null);
const[editName,setEditName]=useState('');
const[editPhone,setEditPhone]=useState('');
const[editEmail,setEditEmail]=useState('');
const[editBirthday,setEditBirthday]=useState('');
const[selectMode,setSelectMode]=useState(false);
const[selectedIds,setSelectedIds]=useState(new Set());
const[reviewItems,setReviewItems]=useState([]);
const[showReviewPanel,setShowReviewPanel]=useState(false);
const[accessToken,setAccessToken]=useState(null);
const longPressTimer=useRef(null);
const longPressTriggered=useRef(false);

const flash=useCallback(text=>{
setMsg(text);
window.setTimeout(()=>setMsg(''),3000);
},[]);

const fetchPeople=useCallback(async token=>{
try{
const res=await fetch('/api/people',{headers:{Authorization:`Bearer ${token}`}});
const data=await res.json();
if(!res.ok)throw new Error(data.error||'Unable to load people');
setPeople(Array.isArray(data)?data:[]);
}catch(err){flash(err.message||'Unable to load people')}
finally{setLoading(false)}
},[flash]);

useEffect(()=>{
let mounted=true;
supabase.auth.getSession().then(({data:{session}})=>{
if(!mounted)return;
if(session){
setAccessToken(session.access_token);
fetchPeople(session.access_token);
fetch('/api/aria/initialize',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},body:'{}'}).catch(()=>{});
}else setLoading(false);
});
return()=>{
mounted=false;
if(longPressTimer.current)window.clearTimeout(longPressTimer.current);
};
},[fetchPeople]);

useEffect(()=>{
setReviewItems(people.filter(p=>p.living_truth&&(p.living_truth.status==='needs_decision'||p.living_truth.status==='conflict')).map(p=>({
person_id:p.id,
extracted_name:p.display_name||[p.first_name,p.last_name].filter(Boolean).join(' ')||p.first_name||'Unknown',
extracted_phone:p.phone,
status:p.living_truth.status,
confidence:p.living_truth.confidence||70,
candidates:Array.isArray(p.living_truth.candidate_ids)?p.living_truth.candidate_ids:[],
resolved:false
})));
},[people]);

const filtered=people.filter(p=>{
if(roleFilter!=='all'&&p.type!==roleFilter)return false;
if(showLivingTruthOnly&&!(p.living_truth&&(p.living_truth.status==='needs_decision'||p.living_truth.status==='conflict')))return false;
const q=search.trim().toLowerCase();
if(!q)return true;
const name=[p.display_name,p.first_name,p.last_name].filter(Boolean).join(' ').toLowerCase();
return name.includes(q)||(p.phone||'').toLowerCase().includes(q)||(p.email||'').toLowerCase().includes(q);
});

const beginLongPress=id=>{
longPressTriggered.current=false;
if(longPressTimer.current)window.clearTimeout(longPressTimer.current);
longPressTimer.current=window.setTimeout(()=>{
longPressTriggered.current=true;
setSelectMode(true);
setSelectedIds(prev=>new Set(prev).add(id));
setExpandedId(null);
if(navigator.vibrate)navigator.vibrate(50);
},650);
};

const endLongPress=()=>{
if(longPressTimer.current){
window.clearTimeout(longPressTimer.current);
longPressTimer.current=null;
}
};

const handleCardClick=id=>{
if(longPressTriggered.current){
longPressTriggered.current=false;
return;
}
if(selectMode){
setSelectedIds(prev=>{
const next=new Set(prev);
if(next.has(id))next.delete(id);else next.add(id);
return next;
});
return;
}
if(editingId===id)return;
setExpandedId(null);
setAddingNote(false);
setImportingConv(false);
setNoteText('');
setConvText('');
router.push(`/person/${id}`);
};

const selectAll=()=>setSelectedIds(new Set(filtered.map(p=>p.id)));
const cancelSelect=()=>{
setSelectMode(false);
setSelectedIds(new Set());
longPressTriggered.current=false;
};

const startEdit=person=>{
setExpandedId(person.id);
setEditingId(person.id);
setEditName([person.first_name,person.last_name].filter(Boolean).join(' ')||person.display_name||'');
setEditPhone(person.phone||'');
setEditEmail(person.email||'');
setEditBirthday(person.birthday||'');
setAddingNote(false);
setImportingConv(false);
};

const cancelEdit=()=>{
setEditingId(null);
setEditName('');
setEditPhone('');
setEditEmail('');
setEditBirthday('');
};
const addPerson=async e=>{
e.preventDefault();
if(!form.full_name.trim()||!accessToken)return;
try{
const res=await fetch('/api/people',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${accessToken}`},body:JSON.stringify(form)});
const data=await res.json();
if(!res.ok||!data.id)throw new Error(data.error||'Could not add person');
setPeople(prev=>[data,...prev]);
setForm({full_name:'',phone:'',email:'',type:'visitor',birthday:''});
setShowAdd(false);
flash('Person added');
}catch(err){flash(err.message||'Error adding person')}
};

const saveEdit=async id=>{
if(!editName.trim()||!accessToken)return;
try{
const res=await fetch('/api/people',{method:'PUT',headers:{'Content-Type':'application/json',Authorization:`Bearer ${accessToken}`},body:JSON.stringify({id,full_name:editName.trim(),phone:editPhone,email:editEmail,type:people.find(p=>p.id===id)?.type||'visitor',birthday:editBirthday||null})});
const data=await res.json();
if(!res.ok||!data.id)throw new Error(data.error||'Update failed');
setPeople(prev=>prev.map(p=>p.id===id?{...data,last_attended_date:p.last_attended_date,last_contacted:p.last_contacted}:p));
cancelEdit();
flash('Person updated');
}catch(err){flash(err.message||'Error updating person')}
};

const deletePerson=async(id,e)=>{
if(e)e.stopPropagation();
if(!accessToken||!window.confirm('Remove this person?'))return;
try{
const res=await fetch('/api/people/delete',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${accessToken}`},body:JSON.stringify({id})});
const data=await res.json();
if(!res.ok||!data.success)throw new Error(data.error||'Remove failed');
setPeople(prev=>prev.filter(p=>!data.deleted_ids.includes(p.id)));
if(expandedId===id)setExpandedId(null);
flash('Person removed');
}catch(err){flash(err.message||'Error removing person')}
};

const bulkDelete=async()=>{
if(!selectedIds.size||!accessToken||!window.confirm(`Remove ${selectedIds.size} selected people?`))return;
try{
const res=await fetch('/api/people/delete',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${accessToken}`},body:JSON.stringify({ids:[...selectedIds]})});
const data=await res.json();
if(!res.ok||!data.success)throw new Error(data.error||'Remove failed');
setPeople(prev=>prev.filter(p=>!data.deleted_ids.includes(p.id)));
flash(`Removed ${data.deleted} people`);
cancelSelect();
}catch(err){flash(err.message||'Error removing people')}
};

const generateDraft=async id=>{
if(!accessToken)return;
try{
const res=await fetch('/api/presence/draft',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${accessToken}`},body:JSON.stringify({person_id:id})});
const data=await res.json();
if(!res.ok||!data.message)throw new Error(data.error||'Draft failed');
if(window.confirm(`${data.message}\n\nOpen WhatsApp to send?`)){
const person=people.find(p=>p.id===id);
if(!person?.phone)throw new Error('This person has no phone number.');
const phone=person.phone.startsWith('+')?person.phone.slice(1):person.phone;
window.open(`https://wa.me/${phone}?text=${encodeURIComponent(data.message)}`,'_blank');
await fetch('/api/timeline',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${accessToken}`},body:JSON.stringify({person_id:id,event_type:'message_sent',title:'WhatsApp message prepared',description:data.message.substring(0,1000),source:'human',metadata:{channel:'whatsapp',type:'manual_send'}})});
flash('Message opened in WhatsApp');
}
}catch(err){flash(err.message||'Error creating message')}
};

const saveNote=async person=>{
if(!noteText.trim()||!accessToken)return;
try{
const res=await fetch('/api/timeline',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${accessToken}`},body:JSON.stringify({person_id:person.id,event_type:'note',title:'Pastoral note',description:noteText.trim(),source:'human',metadata:{type:'pastoral_note'}})});
if(!res.ok){const d=await res.json();throw new Error(d.error||'Could not save note')}
setNoteText('');
setAddingNote(false);
flash('Note saved');
}catch(err){flash(err.message||'Error saving note')}
};

const importConversation=async person=>{
if(!convText.trim()||!accessToken)return;
try{
const res=await fetch('/api/conversation/import',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${accessToken}`},body:JSON.stringify({person_id:person.id,text:convText.trim()})});
const data=await res.json();
if(!res.ok||!data.success)throw new Error(data.error||'Import failed');
setConvText('');
setImportingConv(false);
flash(`Conversation imported · ${data.extracted||0} key events extracted`);
}catch(err){flash(err.message||'Error importing conversation')}
};

const resolveReview=async(item,action,targetId=null)=>{
if(!accessToken)return;
try{
const body={person_id:item.person_id||null,scan_job_id:item.scan_job_id||null,extracted_name:item.extracted_name||null,action,target_person_id:targetId||null};
const res=await fetch('/api/identity/resolve',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${accessToken}`},body:JSON.stringify(body)});
const data=await res.json();
if(!res.ok||!data.success)throw new Error(data.error||'Resolution failed');
await fetchPeople(accessToken);
setShowReviewPanel(false);
flash('Identity resolved');
}catch(err){flash(err.message||'Error resolving identity')}
};

if(loading)return <Layout><LoadingSkeleton/></Layout>;

const reviewStats={
total:reviewItems.length,
needs_decision:reviewItems.filter(i=>i.status==='needs_decision').length,
conflict:reviewItems.filter(i=>i.status==='conflict').length
};

const showPeopleExperience=onboarding?.loaded&&onboarding.enabled&&!onboarding.isExperienced('people');

return <Layout>
<div style={{maxWidth:1100,margin:'0 auto',padding:20}}>
{showPeopleExperience&&<FirstExperience experience="people" onComplete={()=>onboarding.completeExperience('people')}/>}

<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:16,marginBottom:25}}>
<div>
<h1 style={{fontSize:28,fontWeight:600,color:'#f0f0f0',margin:0}}>{people.length} lives remembered</h1>
<p style={{fontSize:13,color:'rgba(255,255,255,.35)',margin:'7px 0 0'}}>Everyone your organization knows.</p>
</div>
{selectMode&&<div style={{display:'flex',gap:8,flexWrap:'wrap',justifyContent:'flex-end'}}>
<button onClick={selectAll} className="fiducia-button fiducia-button-ghost" style={{padding:'7px 12px',fontSize:13}}>Select all</button>
<button onClick={cancelSelect} className="fiducia-button fiducia-button-ghost" style={{padding:'7px 12px',fontSize:13}}>Cancel</button>
{selectedIds.size>0&&<button onClick={bulkDelete} className="fiducia-button fiducia-button-ghost danger-button" style={{padding:'7px 12px',fontSize:13}}>Remove {selectedIds.size}</button>}
</div>}
</div>

<div style={{marginBottom:20}}>
{reviewStats.total===0?<div style={{display:'flex',alignItems:'center',gap:10,color:'rgba(255,255,255,.3)'}}><div style={{width:8,height:8,borderRadius:'50%',background:'rgba(255,255,255,.1)'}}/><span style={{fontSize:14}}>Living Truth · Everything is settled</span></div>:<div className="living-truth-banner" onClick={()=>setShowReviewPanel(true)} style={{display:'flex',alignItems:'center',gap:12,cursor:'pointer',padding:'8px 0',borderBottom:'1px solid rgba(143,183,255,.1)'}}><div style={{width:8,height:8,borderRadius:'50%',background:'#8FB7FF',animation:'pulse 4s ease-in-out infinite'}}/><span style={{color:'#8FB7FF',fontWeight:500}}>Living Truth · {reviewStats.total} identities need attention</span><span style={{marginLeft:'auto',color:'rgba(255,255,255,.3)',fontSize:12}}>{reviewStats.needs_decision>0&&`${reviewStats.needs_decision} need decision `}{reviewStats.conflict>0&&`${reviewStats.conflict} conflict`}</span></div>}
</div>

{showReviewPanel&&<div className="review-panel-overlay" onClick={()=>setShowReviewPanel(false)}>
<div className="review-panel" onClick={e=>e.stopPropagation()}>
<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
<h3 style={{color:'#f0f0f0',margin:0}}>Review Needed</h3>
<button onClick={()=>setShowReviewPanel(false)} className="fiducia-button fiducia-button-ghost">Close</button>
</div>
{reviewItems.length===0?<p style={{color:'rgba(255,255,255,.5)'}}>No unresolved identities.</p>:<div style={{display:'flex',flexDirection:'column',gap:12}}>
{reviewItems.map(item=><div key={`${item.person_id}-${item.extracted_name}`} className="review-item">
<div>
<span style={{color:'#f0f0f0',fontWeight:500}}>{item.extracted_name}</span>
{item.extracted_phone&&<span style={{color:'rgba(255,255,255,.4)',marginLeft:8}}>{item.extracted_phone}</span>}
<span style={{marginLeft:12,fontSize:12,color:statusColor(item.status)}}>{statusLabel(item.status)}</span>
</div>
<div style={{display:'flex',gap:8}}>
{item.candidates?.length>0&&<button className="fiducia-button fiducia-button-primary" style={{padding:'4px 12px',fontSize:12}} onClick={()=>resolveReview(item,'confirm',item.candidates[0])}>Confirm</button>}
<button className="fiducia-button fiducia-button-secondary" style={{padding:'4px 12px',fontSize:12}} onClick={()=>resolveReview(item,'keep_new')}>Keep as New</button>
</div>
</div>)}
</div>}
</div>
</div>}

<div style={{display:'flex',gap:12,marginBottom:24,flexWrap:'wrap',alignItems:'center'}}>
<input type="text" placeholder="Search by name, phone or email" value={search} onChange={e=>setSearch(e.target.value)} style={{flex:1,minWidth:200,padding:'10px 14px',borderRadius:12,border:'1px solid rgba(255,255,255,.06)',background:'rgba(20,25,40,.8)',color:'#fff',outline:'none'}}/>
<select value={roleFilter} onChange={e=>setRoleFilter(e.target.value)} style={{padding:'10px 14px',borderRadius:12,border:'1px solid rgba(255,255,255,.06)',background:'rgba(20,25,40,.8)',color:'#fff',outline:'none',width:120}}>
<option value="all">All</option>
<option value="visitor">Visitor</option>
<option value="member">Member</option>
</select>
<button className={`fiducia-button ${showLivingTruthOnly?'fiducia-button-primary':'fiducia-button-ghost'}`} style={{padding:'6px 12px',fontSize:12}} onClick={()=>setShowLivingTruthOnly(v=>!v)}>{showLivingTruthOnly?'All':'Living Truth'}</button>
<button onClick={()=>setShowAdd(v=>!v)} className="fiducia-button fiducia-button-primary">Add Person</button>
</div>

{showAdd&&<form onSubmit={addPerson} className="fiducia-card add-form" style={{display:'grid',gap:10,marginBottom:20}}>
<input placeholder="Full Name" value={form.full_name} onChange={e=>setForm({...form,full_name:e.target.value})} required style={inputStyle}/>
<input placeholder="Phone" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} style={inputStyle}/>
<input type="email" placeholder="Email (optional)" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} style={inputStyle}/>
<div>
<label style={labelStyle}><span style={{color:'#D4AF37',marginRight:6}}>●</span>Birthday <span style={{fontSize:12,color:'rgba(255,255,255,.3)',marginLeft:6}}>When should ARIA celebrate?</span></label>
<button type="button" onClick={()=>{setPickerTarget('add');setShowPicker(true)}} style={birthdayButtonStyle(form.birthday)}>{form.birthday?new Date(`${form.birthday}T00:00:00`).toLocaleDateString():'Add birthday'}</button>
{form.birthday&&<div style={{fontSize:12,color:'rgba(255,255,255,.3)',marginTop:4}}>Next birthday in {getNextBirthday(form.birthday)} days</div>}
</div>
<select value={form.type} onChange={e=>setForm({...form,type:e.target.value})} style={inputStyle}>
<option value="visitor">Visitor</option>
<option value="member">Member</option>
</select>
<div style={{display:'flex',gap:8}}>
<button type="submit" className="fiducia-button fiducia-button-primary">Save</button>
<button type="button" onClick={()=>setShowAdd(false)} className="fiducia-button fiducia-button-ghost">Cancel</button>
</div>
</form>}

{msg&&<div className="fiducia-card" style={{padding:10,marginBottom:15,color:'#34D399',textAlign:'center'}}>{msg}</div>}

<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(270px,1fr))',gap:12}}>
{filtered.length===0?<div className="empty-state"><div style={{fontSize:18,color:'#f0f0f0',marginBottom:8}}>{search||roleFilter!=='all'?'No people found':'No people yet'}</div><div style={{fontSize:13,color:'rgba(255,255,255,.35)',maxWidth:420}}>{search||roleFilter!=='all'?'Try a different search or filter.':'Add your first person or use Scan to begin building the people your organization knows.'}</div></div>:filtered.map(person=>{
const truth=person.living_truth;
const status=truth?.status||null;
const label=statusLabel(status);
const explanation=statusExplanation(status,truth?.confidence);
const expanded=false;
const editing=editingId===person.id;
const fullName=[person.first_name,person.last_name].filter(Boolean).join(' ')||person.display_name||'Unnamed person';
return <div key={person.id} className="fiducia-card person-card" onPointerDown={()=>beginLongPress(person.id)} onPointerUp={endLongPress} onPointerCancel={endLongPress} onPointerLeave={endLongPress} onClick={()=>handleCardClick(person.id)} style={{cursor:'pointer',border:selectedIds.has(person.id)?'1px solid #D4AF37':undefined,background:selectedIds.has(person.id)?'rgba(212,175,55,.08)':undefined,userSelect:'none',WebkitUserSelect:'none',position:'relative'}}>
{selectMode&&<div style={{position:'absolute',top:12,right:12,width:22,height:22,borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center',background:selectedIds.has(person.id)?'rgba(212,175,55,.12)':'rgba(255,255,255,.03)',border:selectedIds.has(person.id)?'1px solid rgba(212,175,55,.4)':'1px solid rgba(255,255,255,.18)'}}>{selectedIds.has(person.id)?ICONS.check:null}</div>}
{editing?<div onClick={e=>e.stopPropagation()} style={{display:'flex',flexDirection:'column',gap:8}}>
<input value={editName} onChange={e=>setEditName(e.target.value)} style={inputStyle} placeholder="Full Name"/>
<input value={editPhone} onChange={e=>setEditPhone(e.target.value)} style={inputStyle} placeholder="Phone"/>
<input type="email" value={editEmail} onChange={e=>setEditEmail(e.target.value)} style={inputStyle} placeholder="Email"/>
<div>
<label style={labelStyle}>Birthday</label>
<button type="button" onClick={()=>{setPickerTarget('edit');setShowPicker(true)}} style={birthdayButtonStyle(editBirthday)}>{editBirthday?new Date(`${editBirthday}T00:00:00`).toLocaleDateString():'Add birthday'}</button>
</div>
<div style={{display:'flex',gap:8}}>
<button onClick={e=>{e.stopPropagation();saveEdit(person.id)}} className="fiducia-button fiducia-button-primary" style={{padding:'6px 12px',fontSize:13}}>Save</button>
<button onClick={e=>{e.stopPropagation();cancelEdit()}} className="fiducia-button fiducia-button-ghost" style={{padding:'6px 12px',fontSize:13}}>Cancel</button>
</div>
</div>:<>
<div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:10}}>
<div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',minWidth:0}}>
<span style={{fontWeight:600,fontSize:17,color:'#f0f0f0',overflow:'hidden',textOverflow:'ellipsis'}}>{fullName}</span>
{status&&<span style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:11,padding:'2px 10px 2px 6px',borderRadius:20,background:'rgba(255,255,255,.04)',border:'1px solid rgba(255,255,255,.08)',fontWeight:500,color:status==='alive'||status==='conflict'?'#8FB7FF':'#D4AF37'}}><span style={{display:'inline-block',width:9,height:9,borderRadius:'50%',background:statusColor(status),animation:'pulse 2.5s ease-in-out infinite'}}/>{label}</span>}
</div>
<div style={{display:'flex',alignItems:'center',gap:7,flexShrink:0}}>
<span style={{fontSize:11,padding:'2px 8px',borderRadius:20,background:'rgba(212,175,55,.15)',color:'#D4AF37',display:'flex',alignItems:'center',gap:4}}>{ICONS.visitor}{person.type||'visitor'}</span>
<span style={{color:'rgba(255,255,255,.35)',display:'flex'}}>{ICONS.chevron}</span>
</div>
</div>
<div style={{color:'rgba(255,255,255,.5)',fontSize:13,marginTop:10,display:'flex',alignItems:'center',gap:4}}>{ICONS.phone}{person.phone||'No phone'}</div>
{person.email&&<div style={{color:'rgba(255,255,255,.35)',fontSize:12,marginTop:6,display:'flex',alignItems:'center',gap:4}}>{ICONS.mail}{person.email}</div>}
{person.last_attended_date&&<div style={{color:'rgba(255,255,255,.35)',fontSize:12,marginTop:6,display:'flex',alignItems:'center',gap:4}}>{ICONS.calendar}Last attended: {new Date(person.last_attended_date).toLocaleDateString()}</div>}
{explanation&&<div style={{fontSize:11,color:'rgba(255,255,255,.38)',marginTop:9,lineHeight:1.45}}>{explanation}</div>}
</>}
</div>
})}
</div>

{showPicker&&<BirthdayPicker isOpen={showPicker} value={pickerTarget==='add'?form.birthday:editBirthday} onSave={value=>{if(pickerTarget==='add')setForm(f=>({...f,birthday:value||''}));else setEditBirthday(value||'');setShowPicker(false)}} onCancel={()=>setShowPicker(false)}/>}
</div>
</Layout>;
  }

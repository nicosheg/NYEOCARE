// pages/people.js
import{useState,useEffect,useRef,useCallback}from'react';
import{useRouter}from'next/router';import dynamic from'next/dynamic';
import Layout from'../components/Layout';
const ReviewCenterTab=dynamic(()=>import('../components/ReviewCenterTab'),{ssr:false,loading:()=>null});
import FirstExperience from'../components/FirstExperience';
const BirthdayPicker=dynamic(()=>import('../components/BirthdayPicker'),{ssr:false,loading:()=>null});
import{getClientSession,refreshClientSession}from'../lib/clientSession';import{publishDataChange}from'../lib/appData';import{primaryPhone}from'../lib/phoneUtils';
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
edit:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l1-4L16.5 3.5z"/></svg>
};

function bulkIdentityReviewKey(row){return String(row?.full_name||'').trim().toLowerCase()+'|'+String(row?.phone||'').trim()}

function createPersonCreateRequestId(){
 const c=typeof window!=='undefined'?window.crypto:null;
 if(c?.randomUUID)return c.randomUUID().toLowerCase();
 const bytes=new Uint8Array(16);
 if(c?.getRandomValues)c.getRandomValues(bytes);
 else for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256);
 bytes[6]=(bytes[6]&0x0f)|0x40;
 bytes[8]=(bytes[8]&0x3f)|0x80;
 const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
 return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20);
}

const getNextBirthday=b=>{
if(!b)return null;
const today=new Date(),d=new Date(`${b}T00:00:00`);
d.setFullYear(today.getFullYear());
if(d<today)d.setFullYear(today.getFullYear()+1);
return Math.max(0,Math.ceil((d-today)/86400000));
};

const statusColor=s=>s==='alive'?'#8FB7FF':s==='needs_decision'?'#D4AF37':s==='conflict'?'#8FB7FF':'rgba(255,255,255,.4)';
const statusLabel=s=>s==='alive'?'Living Truth':s==='needs_decision'?'Needs Evidence':s==='conflict'?'Human Review Required':'';
const statusExplanation=(s,c)=>s==='alive'?`ARIA is highly confident this identity is correct. (Confidence: ${c||90}%)`:s==='needs_decision'?'ARIA needs more evidence before confirming this identity.':s==='conflict'?'ARIA found multiple possible identities and requires human review.':null;
const personDisplayName=p=>{const display=String(p?.display_name||'').trim(),core=[p?.first_name,p?.last_name].filter(Boolean).join(' ').trim(),prefix=String(p?.honorific||p?.prefix||p?.metadata?.honorific||'').trim();if(display)return display;if(prefix)return `${prefix} ${core||'Unnamed person'}`;return core||'Unnamed person'};
const personCardPhone=person=>{const normalized=primaryPhone(person);if(normalized)return normalized;const entries=Array.isArray(person?.phone_numbers)?person.phone_numbers:[];const values=[person?.phone,...entries.flatMap(entry=>typeof entry==='string'?[entry]:[entry?.normalized,entry?.raw,entry?.phone])];return values.map(value=>String(value||'').trim()).find(Boolean)||'No phone'};
const formatLastSeen=value=>{if(!value)return'Last seen · —';const d=new Date(value);if(Number.isNaN(d.getTime()))return'Last seen · —';const label=new Intl.DateTimeFormat('en-NG',{month:'short',day:'numeric',timeZone:'Africa/Lagos'}).format(d);return`Last seen · ${label}`};const inputStyle={padding:'10px 12px',borderRadius:10,border:'1px solid rgba(255,255,255,.06)',background:'rgba(20,25,40,.6)',color:'#fff',outline:'none',width:'100%'};
const labelStyle={display:'block',fontSize:13,color:'rgba(255,255,255,.5)',marginBottom:4};
const birthdayButtonStyle=value=>({width:'100%',padding:'12px 16px',borderRadius:10,border:'1px solid rgba(255,255,255,.06)',background:'rgba(20,25,40,.6)',color:value?'#f0f0f0':'rgba(255,255,255,.3)',fontSize:15,textAlign:'left',cursor:'pointer',outline:'none'});

function parseBulkPeopleRows(text, defaultType='visitor'){
  const lines=String(text||'').split(/\r?\n/);
  const prepared=[];
  for(let index=0;index<lines.length;index++){
    const line=lines[index].trim();
    if(!line||line.startsWith('#'))continue;
    const phoneOnly=line.match(/^(?:\+?234\d{10}|0\d{10}|\d{10})$/);
    if(phoneOnly){
      const previous=prepared[prepared.length-1];
      if(previous&&!previous.delimited&&!previous.phone&&!/(?:\+?234\d{10}|0\d{10}|\b\d{10}\b)\s*$/.test(previous.line)){
        previous.phone=phoneOnly[0];
        previous.source_line_numbers.push(index+1);
      }else{
        prepared.push({line:'',phone:phoneOnly[0],row_number:index+1,source_line_numbers:[index+1],delimited:false});
      }
      continue;
    }
    prepared.push({
      line,
      phone:'',
      row_number:index+1,
      source_line_numbers:[index+1],
      delimited:line.includes('\t')||line.includes('|')||line.includes(',')
    });
  }
  return prepared.flatMap(item=>{
    const line=item.line.trim();
    if(!line)return [];
    let columns;
    if(line.includes('\t'))columns=line.split('\t');
    else if(line.includes('|'))columns=line.split('|');
    else if(line.includes(','))columns=line.split(',');
    else{
      let remainder=line,type=defaultType;
      const typeMatch=remainder.match(/\s+(member|visitor)\s*$/i);
      if(typeMatch){type=typeMatch[1].toLowerCase();remainder=remainder.slice(0,typeMatch.index).trim()}
      let phone=item.phone||'';
      if(!phone){
        const phoneMatch=remainder.match(/(?:\+?234\d{10}|0\d{10}|\b\d{10}\b)\s*$/);
        if(phoneMatch){phone=phoneMatch[0].trim();remainder=remainder.slice(0,phoneMatch.index).replace(/[\s|,;:-]+$/,'').trim()}
      }
      const name=remainder;
      if(/^(full\s+name|name|person)$/i.test(name))return [];
      return [{full_name:name,phone,type,email:'',row_number:item.row_number,source_line_numbers:item.source_line_numbers}];
    }
    const name=String(columns[0]||'').trim();
    const phone=String(columns[1]||'').trim();
    const typeText=String(columns[2]||'').trim().toLowerCase();
    const email=String(columns[3]||'').trim();
    if(/^(full\s+name|name|person)$/i.test(name)&&/phone/i.test(phone))return [];
    return [{full_name:name,phone,type:typeText||defaultType,email,row_number:item.row_number,source_line_numbers:item.source_line_numbers}];
  });
}

function LoadingSkeleton(){
return <><div style={{maxWidth:1100,margin:'0 auto',padding:20}}><div className="people-skeleton-title"/><div className="people-skeleton-grid">{[1,2,3,4,5,6].map(i=><div key={i} className="fiducia-card people-skeleton-card"/>)}</div></div><style jsx global>{` .people-skeleton-title{height:32px;width:30%;min-width:150px;border-radius:9px;margin-bottom:20px;background:rgba(255,255,255,.045);background-image:linear-gradient(105deg,rgba(255,255,255,.045) 0%,rgba(210,232,255,.08) 45%,rgba(255,255,255,.045) 70%);background-size:220% 100%;animation:peopleSoftBreeze 3.6s ease-in-out infinite}.people-skeleton-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:12px}.people-skeleton-card{height:104px!important;min-height:0!important;padding:0!important;background-image:linear-gradient(105deg,rgba(255,255,255,.045) 0%,rgba(210,232,255,.075) 45%,rgba(255,255,255,.045) 70%);background-size:220% 100%;animation:peopleSoftBreeze 3.6s ease-in-out infinite;animation-delay:120ms}@keyframes peopleSoftBreeze{0%,100%{background-position:100% 0}50%{background-position:0 0}}@media(prefers-reduced-motion:reduce){.people-skeleton-title,.people-skeleton-card{animation:none!important}} `}</style></>;
}

export default function PeoplePage(){
const router=useRouter();const onboarding=useOnboarding();const[people,setPeople]=useState([]);const[search,setSearch]=useState('');const[roleFilter,setRoleFilter]=useState('all');const[showLivingTruthOnly,setShowLivingTruthOnly]=useState(false);const[msg,setMsg]=useState('');const[msgKind,setMsgKind]=useState('success');const[loading,setLoading]=useState(true);const[showAdd,setShowAdd]=useState(false);const[showBulkAdd,setShowBulkAdd]=useState(false);const[showFilters,setShowFilters]=useState(false);const[showAddMenu,setShowAddMenu]=useState(false);const[bulkText,setBulkText]=useState('');const[bulkDefaultType,setBulkDefaultType]=useState('visitor');const[bulkBusy,setBulkBusy]=useState(false);const[bulkResult,setBulkResult]=useState(null);const[bulkIdentityReviews,setBulkIdentityReviews]=useState({});const[form,setForm]=useState({full_name:'',phone:'',email:'',type:'visitor',birthday:''});const[showPicker,setShowPicker]=useState(false);const[pickerTarget,setPickerTarget]=useState(null);const[editingId,setEditingId]=useState(null);const[savingEditId,setSavingEditId]=useState(null);const[editName,setEditName]=useState('');const[editPhone,setEditPhone]=useState('');const[editEmail,setEditEmail]=useState('');const[editBirthday,setEditBirthday]=useState('');const[editType,setEditType]=useState('visitor');const[editStatus,setEditStatus]=useState('active');const[personStatusFilter,setPersonStatusFilter]=useState('active');const[selectMode,setSelectMode]=useState(false);const[selectedIds,setSelectedIds]=useState(new Set());const[reviewCount,setReviewCount]=useState(0);const[totalPeople,setTotalPeople]=useState(0);const[nextCursor,setNextCursor]=useState(null);const[loadingMore,setLoadingMore]=useState(false);const abortRef=useRef(null);const addRequestRef=useRef(null);const addMenuRef=useRef(null);const addMenuButtonRef=useRef(null);const firstLoadRef=useRef(false);const[seenScanIds,setSeenScanIds]=useState(()=>new Set());const scanTimers=useRef(new Map());const[showReviewPanel,setShowReviewPanel]=useState(false);const[accessToken,setAccessToken]=useState(null);const[duplicateReview,setDuplicateReview]=useState(null);const[editIdentityReview,setEditIdentityReview]=useState(null);const longPressTimer=useRef(null);const longPressTriggered=useRef(false);const scrollRestoreRef=useRef(false);const PEOPLE_SCROLL_KEY='nyeocare:people-scroll:v1';
const flash=useCallback((text,kind='success')=>{setMsgKind(kind);setMsg(text);if(typeof window!=='undefined')window.setTimeout(()=>setMsg(''),4000)},[]);
const fetchPeople=useCallback(async({token,reset=true,cursor=null,searchValue=search,typeValue=roleFilter,livingValue=showLivingTruthOnly,statusValue=personStatusFilter,background=false}={})=>{
 if(!token)return;
 if(abortRef.current)abortRef.current.abort();
 const controller=new AbortController();abortRef.current=controller;
 if(reset&&!background)setLoading(true);else if(!reset)setLoadingMore(true);
 try{
  const params=new URLSearchParams({limit:'60'});
  if(searchValue.trim())params.set('search',searchValue.trim());
  if(typeValue!=='all')params.set('type',typeValue);
  if(statusValue!=='active')params.set('include_inactive','1');
  if(statusValue!=='all')params.set('person_status',statusValue);
  if(livingValue)params.set('living_truth','1');
  if(cursor)params.set('cursor',cursor);
  let activeToken=token;
  let res=await fetch('/api/people?'+params.toString(),{headers:{Authorization:`Bearer ${activeToken}`},cache:'no-store',signal:controller.signal});
  if(res.status===401){const refreshed=await refreshClientSession().catch(()=>null);if(refreshed?.access_token){activeToken=refreshed.access_token;setAccessToken(activeToken);res=await fetch('/api/people?'+params.toString(),{headers:{Authorization:`Bearer ${activeToken}`},cache:'no-store',signal:controller.signal})}}
  const data=await res.json().catch(()=>({error:`Unable to read People response (${res.status}).`}));
  if(!res.ok)throw new Error(data.error||'Unable to load people');
  if(reset)setPeople(Array.isArray(data.items)?data.items:[]);else setPeople(prev=>[...prev,...(Array.isArray(data.items)?data.items:[])]);
  setNextCursor(data.next_cursor||null);
  if(data.total_count!==null&&data.total_count!==undefined)setTotalPeople(Number(data.total_count)||0);
 }catch(err){if(err?.name!=='AbortError'&&!background)flash(err.message||'Unable to load people')}finally{if(!controller.signal.aborted){if(reset&&!background)setLoading(false);else if(!reset)setLoadingMore(false)}}
},[flash,search,roleFilter,showLivingTruthOnly,personStatusFilter]);
useEffect(()=>{try{const raw=localStorage.getItem('nyeocare:seen-scan-cards:v1');if(raw)setSeenScanIds(new Set(JSON.parse(raw)))}catch{}},[]);
useEffect(()=>{let mounted=true;getClientSession().then(session=>{if(!mounted)return;if(session){setAccessToken(session.access_token);firstLoadRef.current=true}else setLoading(false)}).catch(()=>{if(mounted)setLoading(false)});return()=>{mounted=false;if(longPressTimer.current)window.clearTimeout(longPressTimer.current);if(abortRef.current)abortRef.current.abort()}},[]);

useEffect(()=>{if(!accessToken||!firstLoadRef.current)return;setSelectedIds(new Set());const timer=window.setTimeout(()=>fetchPeople({token:accessToken,reset:true}),250);return()=>window.clearTimeout(timer)},[search,roleFilter,showLivingTruthOnly,personStatusFilter,accessToken,fetchPeople]);

const loadMore=useCallback(()=>{if(!nextCursor||loadingMore||!accessToken)return;fetchPeople({token:accessToken,reset:false,cursor:nextCursor})},[nextCursor,loadingMore,accessToken,fetchPeople]);

useEffect(()=>{let cancelled=false;if(!accessToken)return;fetch('/api/review?summary=1',{cache:'no-store',headers:{Authorization:'Bearer '+accessToken}}).then(r=>r.ok?r.json():null).then(d=>{if(cancelled||!d)return;setReviewCount(Number(d.pending_count)||0)}).catch(()=>{});return()=>{cancelled=true}},[accessToken]);
useEffect(()=>{if(!accessToken)return;let cancelled=false;const refresh=async()=>{if(cancelled||document.visibilityState==='hidden'||editingId||showAdd||selectMode)return;try{const session=await getClientSession();if(!session||cancelled)return;await fetchPeople({token:session.access_token,reset:true,background:true});const r=await fetch('/api/review?summary=1',{cache:'no-store',headers:{Authorization:'Bearer '+session.access_token}});const d=await r.json().catch(()=>null);if(!cancelled&&d)setReviewCount(Number(d.pending_count)||0)}catch{}};const onRefresh=()=>refresh();window.addEventListener('nyeocare:app-refresh',onRefresh);return()=>{cancelled=true;window.removeEventListener('nyeocare:app-refresh',onRefresh)}},[accessToken,fetchPeople,editingId,showAdd,selectMode]);
useEffect(()=>{if(router.query.review==='1'&&accessToken)setShowReviewPanel(true)},[router.query.review,accessToken]);
useEffect(()=>{if(!showAddMenu)return;const closeIfOutside=e=>{if(!addMenuRef.current?.contains(e.target))setShowAddMenu(false)};const closeOnEscape=e=>{if(e.key==='Escape'){setShowAddMenu(false);addMenuButtonRef.current?.focus()}};document.addEventListener('pointerdown',closeIfOutside);document.addEventListener('keydown',closeOnEscape);return()=>{document.removeEventListener('pointerdown',closeIfOutside);document.removeEventListener('keydown',closeOnEscape)}},[showAddMenu]);
useEffect(()=>{if(loading||!people.length||scrollRestoreRef.current)return;try{const raw=sessionStorage.getItem(PEOPLE_SCROLL_KEY);if(!raw)return;const saved=JSON.parse(raw);if(saved?.pathname&&saved.pathname!==router.asPath)return;const y=Math.max(0,Number(saved?.y)||0);scrollRestoreRef.current=true;sessionStorage.removeItem(PEOPLE_SCROLL_KEY);requestAnimationFrame(()=>requestAnimationFrame(()=>window.scrollTo(0,y)))}catch{}},[loading,people.length,router.asPath]);
const filtered=people;const orderedFiltered=people;
const markScanSeen=useCallback(id=>{if(!id)return;setSeenScanIds(prev=>{if(prev.has(id))return prev;const next=new Set(prev);next.add(id);try{localStorage.setItem('nyeocare:seen-scan-cards:v1',JSON.stringify([...next]))}catch{}return next})},[]);useEffect(()=>{const nodes=[...document.querySelectorAll('.person-card.new-scan-card:not([data-scan-seen="true"])')];if(!nodes.length||typeof IntersectionObserver==='undefined')return;const timers=scanTimers.current;const observer=new IntersectionObserver(entries=>{for(const entry of entries){const id=entry.target.getAttribute('data-person-id');if(!id)continue;if(entry.isIntersecting&&entry.intersectionRatio>=.55){if(timers.has(id))continue;timers.set(id,window.setTimeout(()=>{markScanSeen(id);timers.delete(id)},5000))}else if(timers.has(id)){window.clearTimeout(timers.get(id));timers.delete(id)}}},{threshold:[.55]});nodes.forEach(n=>observer.observe(n));return()=>{observer.disconnect();timers.forEach(t=>window.clearTimeout(t));timers.clear()}},[orderedFiltered,markScanSeen,seenScanIds]);const prefetchPerson=useCallback(id=>{if(!id||selectMode)return;router.prefetch(`/person/${id}`).catch(()=>{})},[router,selectMode]);
const beginLongPress=id=>{longPressTriggered.current=false;prefetchPerson(id);if(longPressTimer.current)window.clearTimeout(longPressTimer.current);longPressTimer.current=window.setTimeout(()=>{longPressTriggered.current=true;setSelectMode(true);setSelectedIds(prev=>new Set(prev).add(id));if(navigator.vibrate)navigator.vibrate(50)},650)};
const endLongPress=()=>{if(longPressTimer.current){window.clearTimeout(longPressTimer.current);longPressTimer.current=null}};
const enterSelectMode=()=>{setSelectMode(true);setEditingId(null)};
const toggleSelected=id=>setSelectedIds(prev=>{const next=new Set(prev);if(next.has(id))next.delete(id);else next.add(id);return next});
const rememberPeopleScroll=useCallback(()=>{try{sessionStorage.setItem(PEOPLE_SCROLL_KEY,JSON.stringify({y:window.scrollY,pathname:router.asPath}))}catch{}},[router.asPath]);
const handleCardClick=id=>{if(longPressTriggered.current){longPressTriggered.current=false;return}if(selectMode){toggleSelected(id);return}if(editingId===id)return;rememberPeopleScroll();router.push(`/person/${id}?return_to=${encodeURIComponent(router.asPath)}`)};
const selectAll=()=>setSelectedIds(new Set(filtered.map(p=>p.id)));const clearSelection=()=>setSelectedIds(new Set());const cancelSelect=()=>{setSelectMode(false);setSelectedIds(new Set());longPressTriggered.current=false};
const startEdit=person=>{setEditingId(person.id);setEditName(personDisplayName(person));setEditPhone(person.phone||'');setEditEmail(person.email||'');setEditBirthday(person.birthday||'');setEditType(person.type==='member'?'member':'visitor');setEditStatus(person.status==='inactive'?'inactive':'active');setEditIdentityReview(null)};
const cancelEdit=()=>{setEditingId(null);setEditName('');setEditPhone('');setEditEmail('');setEditBirthday('');setEditType('visitor');setEditStatus('active');setEditIdentityReview(null)};
const addPerson=async(e,identityReview=null)=>{
 if(e?.preventDefault)e.preventDefault();
 if(!form.full_name.trim()||!accessToken)return;
 try{
  const requestPayload={...form,full_name:form.full_name.trim()};
  const signature=JSON.stringify({
   full_name:requestPayload.full_name,
   phone:String(requestPayload.phone||'').trim(),
   email:String(requestPayload.email||'').trim().toLowerCase(),
   type:requestPayload.type,
   birthday:requestPayload.birthday||null
  });
  if(!addRequestRef.current||addRequestRef.current.signature!==signature){
   addRequestRef.current={signature,id:createPersonCreateRequestId()};
  }
  const requestId=addRequestRef.current.id;
  const res=await fetch('/api/people',{
   method:'POST',
   headers:{'Content-Type':'application/json',Authorization:`Bearer ${accessToken}`},
   body:JSON.stringify({...requestPayload,client_request_id:requestId,...(identityReview?{identity_review:identityReview}:{})})
  });
  const data=await res.json().catch(()=>({}));
  if(!res.ok||!data.id){
   if(res.status===409&&['PERSON_IDENTITY_REVIEW_REQUIRED','PERSON_IDENTITY_REVIEW_STALE','DUPLICATE_IDENTITY_NOT_DISTINCT'].includes(data.code)){
    const candidates=Array.isArray(data.candidates)?data.candidates:[];
    setDuplicateReview({code:data.code,message:data.error||'Review possible matches before saving.',candidates,request_id:data.request_id||null});
    const organizationName=candidates.find(candidate=>candidate.organization_name)?.organization_name||'this organization';
    const message=data.code==='DUPLICATE_IDENTITY_NOT_DISTINCT'
     ? 'Not saved: this exact identity already exists in '+organizationName+'. Open the existing record; records in other organizations are excluded.'
     : 'Not saved: a possible match inside '+organizationName+' needs review. Records in other organizations are excluded. Review the highlighted panel.';
    flash(message+(data.request_id?' (Reference: '+data.request_id+')':''),'error');
    if(typeof window!=='undefined')window.requestAnimationFrame(()=>document.querySelector('[data-person-create-identity-review]')?.scrollIntoView({behavior:'smooth',block:'nearest'}));
    return;
   }
   throw new Error(data.error||'Could not add person');
  }
  setPeople(prev=>[data,...prev.filter(p=>p.id!==data.id)]);
  if(data.created!==false&&!data.idempotent_replay)setTotalPeople(v=>v+1);
  publishDataChange('people');
  setForm({full_name:'',phone:'',email:'',type:'visitor',birthday:''});
  setShowAdd(false);
  setDuplicateReview(null);
  addRequestRef.current=null;
  flash(data.identity_review_confirmed?'Person added after identity review. ARIA’s decision was recorded.':data.idempotent_replay?'Person was already saved. Recovered the existing record.':'Person added');
 }catch(err){flash(err.message||'Error adding person','error')}
};
const saveEdit=async(id,identityReview=null)=>{
 if(savingEditId===String(id))return;
 if(!editName.trim()){flash('Enter a name before saving this person.','error');return}
 const current=people.find(p=>String(p.id)===String(id));
 if(!current){flash('This person is no longer in the loaded list. Refresh People and try again.','error');return}
 // The Save button can remain visible while session hydration is finishing.
 // Recover the existing session instead of silently returning without a request.
 let activeToken=accessToken;
 if(!activeToken){
  const session=await getClientSession().catch(()=>null);
  activeToken=session?.access_token||null;
  if(activeToken)setAccessToken(activeToken);
 }
 if(!activeToken){flash('Your session is not ready or has expired. Sign in again before saving. No changes were sent.','error');return}
 const body={id};
 const originalName=personDisplayName(current),nextName=editName.trim();
 const originalPhone=String(current.phone||'').trim(),nextPhone=String(editPhone||'').trim();
 const originalEmail=String(current.email||'').trim().toLowerCase(),nextEmail=String(editEmail||'').trim().toLowerCase();
 const originalBirthday=String(current.birthday||'').slice(0,10),nextBirthday=String(editBirthday||'').slice(0,10);
 const originalType=current.type==='member'?'member':'visitor';
 const originalStatus=current.status==='inactive'?'inactive':'active';
 if(nextName!==originalName)body.full_name=nextName;
 if(nextPhone!==originalPhone)body.phone=nextPhone;
 if(nextEmail!==originalEmail)body.email=nextEmail;
 if(nextBirthday!==originalBirthday)body.birthday=nextBirthday||null;
 if(editType!==originalType)body.type=editType;
 if(editStatus!==originalStatus)body.status=editStatus;
 const editableFields=['full_name','phone','email','birthday','type','status'];
 if(!editableFields.some(key=>Object.prototype.hasOwnProperty.call(body,key))){
  cancelEdit();flash('No changes to save.');return;
 }
 if(identityReview)body.identity_review=identityReview;
 setSavingEditId(String(id));
 try{
  const sendUpdate=token=>fetch('/api/people',{method:'PUT',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body),cache:'no-store'});
  let res=await sendUpdate(activeToken);
  if(res.status===401){
   const refreshed=await refreshClientSession().catch(()=>null);
   if(refreshed?.access_token){
    activeToken=refreshed.access_token;setAccessToken(activeToken);
    res=await sendUpdate(activeToken);
   }
  }
  const data=await res.json().catch(()=>({}));
  if(!res.ok||String(data.id||'')!==String(id)){
   if(res.status===409&&['PERSON_IDENTITY_REVIEW_REQUIRED','PERSON_IDENTITY_REVIEW_STALE','DUPLICATE_IDENTITY_NOT_DISTINCT'].includes(data.code)){
    const candidates=Array.isArray(data.candidates)?data.candidates:[];
    setEditIdentityReview({code:data.code,message:data.error||'Review possible identity matches before saving.',candidates,request_id:data.request_id||null});
    const organizationName=candidates.find(candidate=>candidate.organization_name)?.organization_name||'this organization';
    const message=data.code==='DUPLICATE_IDENTITY_NOT_DISTINCT'
     ? 'Not saved: this exact identity already exists in '+organizationName+'. Open the existing record to edit it; records in other organizations are excluded.'
     : 'Not saved: a possible match inside '+organizationName+' needs review. Records in other organizations are excluded. Review the highlighted panel.';
    flash(message+(data.request_id?' (Reference: '+data.request_id+')':''),'error');
    if(typeof window!=='undefined')window.requestAnimationFrame(()=>document.querySelector('[data-person-edit-identity-review]')?.scrollIntoView({behavior:'smooth',block:'nearest'}));
    return;
   }
   throw new Error(data.error||'Update failed');
  }
  // Render the exact canonical row returned by the committed database mutation.
  // String comparisons avoid UUID string/type mismatches leaving stale card data behind.
  setPeople(prev=>prev.map(p=>String(p.id)===String(id)?{...data,last_seen:p.last_seen,last_attended_date:p.last_attended_date,last_contacted:p.last_contacted}:p));
  cancelEdit();
  publishDataChange('people',{source:'people-card-edit',personId:String(id)});
  flash(identityReview?'Person updated after identity review. ARIA’s decision was recorded.':data.no_changes?'No changes to save.':'Person updated');
  await fetchPeople({token:activeToken,reset:true,background:true});
 }catch(err){flash(err.message||'Error updating person','error')}
 finally{setSavingEditId(null)}
};
const bulkAddPeople=async()=>{
 if(!accessToken||bulkBusy)return;
 const parsedRows=parseBulkPeopleRows(bulkText,bulkDefaultType);
 const rows=parsedRows.map(row=>{const review=bulkIdentityReviews[bulkIdentityReviewKey(row)];return review?{...row,identity_review:review}:row});
 if(!rows.length){flash('Paste at least one person row first.','error');return}
 if(rows.length>200){flash('Add up to 200 people per batch.','error');return}
 setBulkBusy(true);setBulkResult(null);
 try{
  const res=await fetch('/api/people/bulk-create',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+accessToken},body:JSON.stringify({rows,default_type:bulkDefaultType})});
  const data=await res.json().catch(()=>({error:'Could not read the bulk-add response.'}));
  if(!res.ok||!data.success)throw new Error(data.error||'Could not add people.');
  setBulkResult(data);
  setBulkIdentityReviews(prev=>{const next={...prev};for(const row of data.results||[])if(row.status==='needs_review')delete next[row.review_key];for(const row of data.results||[])if(row.status==='created')delete next[row.review_key];return next});
  const skippedRows=new Set((data.results||[]).filter(row=>row.status!=='created').flatMap(row=>Array.isArray(row.source_line_numbers)?row.source_line_numbers:[row.row]).map(Number));
  const sourceLines=bulkText.split(/\r?\n/);
  setBulkText(skippedRows.size?sourceLines.filter((line,index)=>skippedRows.has(index+1)).join('\n'):'');
  if(data.created>0){
   publishDataChange('people');
   await fetchPeople({token:accessToken,reset:true,searchValue:search,typeValue:roleFilter,livingValue:showLivingTruthOnly});
  }
  if(data.created>0&&data.skipped===0){setShowBulkAdd(false);flash('Added '+data.created+' people.')}
  else if(data.created>0)flash('Added '+data.created+'. '+data.skipped+' row(s) need attention; only skipped rows remain in the box.','error');
  else flash('No people were added. Review the '+(data.skipped||rows.length)+' skipped row(s) below.','error');
 }catch(err){flash(err.message||'Bulk add failed.','error')}
 finally{setBulkBusy(false)}
};
const bulkDelete=async()=>{if(!selectedIds.size||!accessToken||!window.confirm(`Remove ${selectedIds.size} selected people?`))return;try{const res=await fetch('/api/people/delete',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${accessToken}`},body:JSON.stringify({ids:[...selectedIds]})});const data=await res.json();if(!res.ok||!data.success)throw new Error(data.error||'Remove failed');setPeople(prev=>{const next=prev.filter(p=>!data.deleted_ids.includes(p.id));return next});setTotalPeople(v=>Math.max(0,v-(Number(data.deleted)||0)));publishDataChange('people');flash(`Removed ${data.deleted} people`);cancelSelect()}catch(err){flash(err.message||'Error removing people')}};
if(loading&&people.length===0)return <Layout><LoadingSkeleton/></Layout>;
const reviewStats={total:reviewCount};const activeFilterCount=(roleFilter!=='all'?1:0)+(personStatusFilter!=='active'?1:0)+(showLivingTruthOnly?1:0);const bulkPreviewRows=parseBulkPeopleRows(bulkText,bulkDefaultType);const showPeopleExperience=onboarding?.loaded&&onboarding.enabled&&!onboarding.isExperienced('people');const allFilteredSelected=filtered.length>0&&filtered.every(p=>selectedIds.has(p.id));
return <Layout><div style={{maxWidth:1100,margin:'0 auto',padding:20,paddingBottom:selectMode?100:20}}>{showPeopleExperience&&<FirstExperience experience="people" onComplete={()=>onboarding.completeExperience('people')}/>}<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:16,marginBottom:25,flexWrap:'wrap'}}><div><h1 style={{fontSize:28,fontWeight:600,color:'#f0f0f0',margin:0}}>{totalPeople||people.length} lives remembered</h1><p style={{fontSize:13,color:'rgba(255,255,255,.35)',margin:'7px 0 0'}}>Everyone your organization knows.</p></div></div>
<div style={{marginBottom:20}}>{reviewStats.total===0?<div style={{display:'flex',alignItems:'center',gap:10,color:'rgba(255,255,255,.3)'}}><div style={{width:8,height:8,borderRadius:'50%',background:'rgba(255,255,255,.1)'}}/><span style={{fontSize:14}}>Living Truth · Everything is settled</span></div>:<div className="living-truth-banner" onClick={()=>setShowReviewPanel(true)} style={{display:'flex',alignItems:'center',gap:12,cursor:'pointer',padding:'8px 0',borderBottom:'1px solid rgba(143,183,255,.1)'}}><div style={{width:8,height:8,borderRadius:'50%',background:'#8FB7FF',animation:'pulse 4s ease-in-out infinite'}}/><span style={{color:'#8FB7FF',fontWeight:500}}>Living Truth · {reviewStats.total} identities need attention</span><span style={{marginLeft:'auto',color:'rgba(255,255,255,.3)',fontSize:12}}>Open Review Center</span></div>}</div>
{showReviewPanel&&<ReviewCenterTab modal onClose={()=>{setShowReviewPanel(false);publishDataChange('review');getClientSession().then(s=>s&&fetchPeople({token:s.access_token,reset:true})).catch(()=>{})}}/>}<div className="people-toolbar">
 <div className="people-toolbar-primary">
  <div className="people-search-wrap">
   <span className="people-search-icon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg></span>
   <input type="search" aria-label="Search people by name, phone, or email" className="people-search-input" placeholder="Search names, phone or email" value={search} onChange={e=>setSearch(e.target.value)} enterKeyHint="search" autoComplete="off" style={{...inputStyle,padding:'8px 34px',minWidth:0,height:38,boxSizing:'border-box'}}/>
   {search&&<button type="button" aria-label="Clear search" className="people-search-clear" onClick={()=>setSearch('')}>×</button>}
  </div>
  <button type="button" className={showFilters||activeFilterCount?'fiducia-button fiducia-button-primary people-control-button':'fiducia-button fiducia-button-ghost people-control-button'} onClick={()=>setShowFilters(v=>!v)} aria-expanded={showFilters} aria-controls="people-filter-panel">
   <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg><span>Filters</span>{activeFilterCount>0&&<span className="people-filter-count">{activeFilterCount}</span>}
  </button>
  <div className="people-add-menu-wrap" ref={addMenuRef}>
   <button ref={addMenuButtonRef} type="button" className="fiducia-button fiducia-button-primary people-control-button people-add-button" onClick={()=>setShowAddMenu(v=>!v)} aria-expanded={showAddMenu} aria-controls="people-add-menu">
    <span aria-hidden="true">+</span><span>Add people</span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
   </button>
   <div id="people-add-menu" className="people-add-menu" role="group" aria-label="Choose how to add people" hidden={!showAddMenu}>
    <button type="button" onClick={()=>{setShowAdd(true);setShowBulkAdd(false);setShowAddMenu(false);setBulkResult(null)}}><strong>Add one person</strong><span>Enter one person's details</span></button>
    <button type="button" onClick={()=>{setShowBulkAdd(true);setShowAdd(false);setShowAddMenu(false);setBulkResult(null)}}><strong>Add multiple people</strong><span>Bulk add from a list</span></button>
   </div>
  </div>
 </div>
 <div id="people-filter-panel" className="people-filter-panel" hidden={!showFilters}>
  <label className="people-filter-field"><span>Person type</span><select aria-label="Filter by person type" value={roleFilter} onChange={e=>setRoleFilter(e.target.value)} className="people-filter-select"><option value="all">All types</option><option value="visitor">Visitor</option><option value="member">Member</option></select></label>
  <label className="people-filter-field"><span>Organization status</span><select aria-label="Filter by organization status" value={personStatusFilter} onChange={e=>setPersonStatusFilter(e.target.value)} className="people-filter-select"><option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All statuses</option></select></label>
  <button type="button" className="people-filter-toggle" aria-pressed={showLivingTruthOnly} onClick={()=>setShowLivingTruthOnly(v=>!v)}><span className="people-filter-check">{showLivingTruthOnly?'✓':''}</span><span>Living Truth only</span></button>
  {activeFilterCount>0&&<button type="button" className="people-filter-reset" onClick={()=>{setRoleFilter('all');setPersonStatusFilter('active');setShowLivingTruthOnly(false)}}>Reset filters</button>}
 </div>
</div>
<style jsx global>{`
.people-toolbar{display:flex;flex-direction:column;gap:7px;margin-bottom:15px;width:100%}
.people-toolbar-primary{display:grid;grid-template-columns:minmax(160px,1fr) auto auto;align-items:center;gap:7px;width:100%}
.people-search-wrap{position:relative;min-width:0}
.people-search-input{width:100%;min-width:0;font-size:13px!important}
.people-search-input::-webkit-search-cancel-button{-webkit-appearance:none}
.people-search-icon{position:absolute;left:11px;top:50%;transform:translateY(-50%);display:flex;align-items:center;color:rgba(245,247,250,.42);pointer-events:none}
.people-search-icon svg{width:14px;height:14px}
.people-search-clear{position:absolute;right:6px;top:50%;transform:translateY(-50%);display:flex;align-items:center;justify-content:center;width:24px;height:24px;border:0;border-radius:7px;background:rgba(255,255,255,.055);color:rgba(245,247,250,.72);font-size:18px;line-height:1;cursor:pointer}
.people-control-button{min-height:36px;padding:0 10px!important;display:inline-flex;align-items:center;justify-content:center;gap:5px;white-space:nowrap;border-radius:10px!important;font-size:12px!important;line-height:1.1}
.people-control-button svg{width:13px;height:13px;flex:0 0 auto}
.people-filter-count{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:rgba(255,255,255,.14);font-size:9px;font-weight:700}
.people-add-menu-wrap{position:relative;min-width:0}
.people-add-button{gap:5px}
.people-add-menu{position:absolute;z-index:1100;right:0;top:calc(100% + 7px);width:min(270px,calc(100vw - 40px));padding:6px;border:1px solid rgba(255,255,255,.11);border-radius:12px;background:rgba(10,16,30,.98);box-shadow:0 18px 44px rgba(0,0,0,.38);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}
.people-add-menu[hidden],.people-filter-panel[hidden]{display:none}
.people-add-menu button{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:3px;width:100%;min-height:48px;padding:8px 10px;border:0;border-radius:8px;background:transparent;color:#f5f7fa;text-align:left;cursor:pointer}
.people-add-menu button:hover,.people-add-menu button:focus-visible{background:rgba(255,255,255,.06);outline:none}
.people-add-menu button+button{margin-top:3px;border-top:1px solid rgba(255,255,255,.055)}
.people-add-menu strong{font-size:12px;font-weight:600}
.people-add-menu span{font-size:10px;color:rgba(245,247,250,.54)}
.people-filter-panel{display:grid;grid-template-columns:repeat(2,minmax(0,1fr)) auto auto;align-items:end;gap:8px;padding:9px;border:1px solid rgba(255,255,255,.07);border-radius:12px;background:rgba(255,255,255,.025)}
.people-filter-field{display:flex;flex-direction:column;gap:4px;min-width:0;color:rgba(245,247,250,.56);font-size:10px}
.people-filter-select{width:100%;min-width:0;box-sizing:border-box;padding:7px 8px;min-height:34px;border:1px solid rgba(255,255,255,.09);border-radius:9px;background:#101a31;color:#f5f7fa;outline:none;font-size:12px}
.people-filter-select:focus-visible,.people-search-input:focus-visible{border-color:rgba(214,184,106,.65);box-shadow:0 0 0 2px rgba(214,184,106,.12)}
.people-filter-toggle{display:inline-flex;align-items:center;gap:7px;min-height:34px;padding:0 8px;border:1px solid rgba(255,255,255,.08);border-radius:9px;background:rgba(255,255,255,.025);color:rgba(245,247,250,.72);font-size:11px;white-space:nowrap;cursor:pointer}
.people-filter-toggle[aria-pressed="true"]{border-color:rgba(214,184,106,.38);background:rgba(214,184,106,.09);color:#e8d49a}
.people-filter-check{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border:1px solid currentColor;border-radius:4px;font-size:10px;line-height:1}
.people-filter-reset{min-height:34px;padding:0 6px;border:0;background:transparent;color:rgba(245,247,250,.55);font-size:10px;white-space:nowrap;cursor:pointer}
.people-filter-reset:hover{text-decoration:underline;color:#f5f7fa}
.people-control-button:focus-visible,.people-filter-toggle:focus-visible,.people-filter-reset:focus-visible,.people-search-clear:focus-visible,.people-add-menu button:focus-visible{outline:2px solid rgba(232,212,154,.75);outline-offset:2px}
@media(max-width:640px){.people-toolbar-primary{grid-template-columns:minmax(0,1fr) auto;gap:7px}.people-search-wrap{grid-column:1 / -1}.people-filter-panel{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.people-filter-toggle,.people-filter-reset{grid-column:1 / -1;justify-self:start}.people-add-menu{right:0}}
@media(max-width:360px){.people-control-button{padding:0 8px!important;gap:4px;font-size:11px!important}.people-filter-panel{padding:8px}.people-add-button{gap:4px}}
@media(prefers-reduced-transparency:reduce){.people-add-menu{backdrop-filter:none;-webkit-backdrop-filter:none}}
`}</style>
{showAdd&&<form onSubmit={addPerson} className="fiducia-card add-form" style={{display:'grid',gap:10,marginBottom:20}}><input placeholder="Full Name" value={form.full_name} onChange={e=>setForm({...form,full_name:e.target.value})} required style={inputStyle}/><input placeholder="Phone" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} style={inputStyle}/><input type="email" placeholder="Email (optional)" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} style={inputStyle}/><div><label style={labelStyle}><span style={{color:'#D4AF37',marginRight:6}}>●</span>Birthday <span style={{fontSize:12,color:'rgba(255,255,255,.3)',marginLeft:6}}>When should ARIA celebrate?</span></label><button type="button" onClick={()=>{setPickerTarget('add');setShowPicker(true)}} style={birthdayButtonStyle(form.birthday)}>{form.birthday?new Date(`${form.birthday}T00:00:00`).toLocaleDateString():'Add birthday'}</button>{form.birthday&&<div style={{fontSize:12,color:'rgba(255,255,255,.3)',marginTop:4}}>Next birthday in {getNextBirthday(form.birthday)} days</div>}</div><select value={form.type} onChange={e=>setForm({...form,type:e.target.value})} style={inputStyle}><option value="visitor">Visitor</option><option value="member">Member</option></select>{duplicateReview&&<div role="alert" data-person-create-identity-review className="fiducia-card" style={{padding:14,border:'1px solid rgba(212,175,55,.35)',background:'rgba(212,175,55,.06)',display:'grid',gap:8}}><strong style={{color:'#f3df9c'}}>{duplicateReview.code==='DUPLICATE_IDENTITY_NOT_DISTINCT'?'Same identity already exists':'Review possible identity matches'}</strong><p style={{margin:0,fontSize:13,lineHeight:1.5,color:'rgba(255,255,255,.72)'}}>{duplicateReview.message}</p>{duplicateReview.candidates.map(candidate=><div key={candidate.id} style={{padding:'9px 10px',borderRadius:10,background:'rgba(255,255,255,.035)',display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}><div><strong style={{display:'block',color:'#f2f4f8',fontSize:13}}>{candidate.display_name||[candidate.first_name,candidate.last_name].filter(Boolean).join(' ')||'Unnamed person'}</strong><span style={{display:'block',fontSize:12,color:'rgba(255,255,255,.48)',marginTop:3}}>{candidate.phone||'No phone recorded'}{candidate.status?' · '+candidate.status:''}</span><span style={{display:'block',fontSize:10,color:'rgba(255,255,255,.32)',marginTop:2}}>Organization: {candidate.organization_name||'Current organization'}</span><span style={{display:'block',fontSize:10,color:'rgba(255,255,255,.32)',marginTop:2}}>Organization: {candidate.organization_name||'Current organization'}</span><span style={{display:'block',fontSize:11,color:'rgba(255,255,255,.38)',marginTop:2}}>{candidate.name_match?'Same normalized name · ':candidate.similar_name?'Similar name · ':''}{candidate.phone_match?'Same phone number':''}</span></div><button type="button" className="fiducia-button fiducia-button-ghost" onClick={()=>router.push('/person/'+candidate.id)}>Open record</button></div>)}{duplicateReview.code!=='DUPLICATE_IDENTITY_NOT_DISTINCT'&&<button type="button" className="fiducia-button fiducia-button-primary" onClick={()=>addPerson(null,{confirmed:true,candidate_ids:duplicateReview.candidates.map(candidate=>candidate.id)})}>Verified: these are separate people</button>}<button type="button" className="fiducia-button fiducia-button-ghost" onClick={()=>setDuplicateReview(null)}>Close review</button></div>}<div style={{display:'flex',gap:8}}><button type="submit" className="fiducia-button fiducia-button-primary">Save</button><button type="button" onClick={()=>setShowAdd(false)} className="fiducia-button fiducia-button-ghost">Cancel</button></div></form>}
{showBulkAdd&&<form onSubmit={e=>{e.preventDefault();bulkAddPeople()}} className="fiducia-card add-form" style={{display:'grid',gap:12,marginBottom:20}}>
 <div><strong style={{fontSize:17,color:'#f0f0f0'}}>Add many people at once</strong><p style={{fontSize:12,lineHeight:1.6,color:'rgba(255,255,255,.48)',margin:'5px 0 0'}}>Paste rows from Excel/Google Sheets, one person per line, or alternating name-then-phone lines. Phone and email are optional. You can add up to 200 people at a time.</p></div>
 <div><label style={labelStyle}>Default type for rows without a type</label><select value={bulkDefaultType} onChange={e=>setBulkDefaultType(e.target.value)} style={inputStyle}><option value="visitor">Visitor</option><option value="member">Member</option></select></div>
 <label style={labelStyle}>People list <span style={{fontWeight:400,color:'rgba(255,255,255,.3)'}}>· Name, Phone, Type, Email (optional)</span></label>
 <textarea value={bulkText} onChange={e=>{setBulkText(e.target.value);setBulkResult(null)}} rows={8} placeholder={'Mummy Christiana, 08022597401, visitor\nSIS Sandra Isiocha, 08039579758, member\nBro John Doe, , member\nJane Example'} style={{...inputStyle,minHeight:170,resize:'vertical',fontFamily:'ui-monospace,SFMono-Regular,monospace',fontSize:13,lineHeight:1.6}}/>
 <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'center',flexWrap:'wrap'}}><span style={{fontSize:12,color:bulkPreviewRows.length>200?'#FCA5A5':'rgba(255,255,255,.48)'}}>{bulkPreviewRows.length} row(s) detected{bulkPreviewRows.length>200?' · exceeds 200-row limit':''}</span><span style={{fontSize:11,color:'rgba(255,255,255,.28)'}}>Tab, comma, or | separated · name-only rows supported</span></div>
 {bulkPreviewRows.length>0&&<div style={{fontSize:12,color:'rgba(255,255,255,.42)'}}>Preview: {bulkPreviewRows.slice(0,3).map(row=>row.full_name||'Unnamed row').join(' · ')}{bulkPreviewRows.length>3?' …':''}</div>}
 {bulkResult&&<div role="status" style={{padding:12,borderRadius:10,background:'rgba(255,255,255,.035)',border:'1px solid rgba(255,255,255,.08)',fontSize:13,color:bulkResult.skipped?'#FCA5A5':'#6EE7B7'}}><strong>{bulkResult.created} added · {bulkResult.skipped} skipped</strong>{bulkResult.skipped>0&&<ul style={{margin:'8px 0 0',paddingLeft:20,color:'rgba(255,255,255,.7)'}}>{bulkResult.results.filter(row=>row.status!=='created').slice(0,10).map((row,index)=><li key={String(row.row)+'-'+index} style={{marginBottom:row.candidates?.length?8:0}}>Row {row.row}: {row.name||'Unnamed'} — {row.reason||'Check this row'}{row.candidates?.map(candidate=><div key={candidate.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,marginTop:6,padding:'7px 8px',borderRadius:8,background:'rgba(255,255,255,.035)'}}><div><strong style={{display:'block',fontSize:12}}>{candidate.display_name||[candidate.first_name,candidate.last_name].filter(Boolean).join(' ')||'Unnamed person'}</strong><span style={{display:'block',fontSize:11,opacity:.65}}>{candidate.phone||'No phone recorded'}{candidate.status?' · '+candidate.status:''}</span><span style={{display:'block',fontSize:10,opacity:.55}}>{candidate.name_match?'Same normalized name · ':candidate.similar_name?'Similar name · ':''}{candidate.phone_match?'Same phone number':''}</span></div><button type="button" className="fiducia-button fiducia-button-ghost" onClick={()=>router.push('/person/'+candidate.id)}>Open record</button></div>)}{row.status==='needs_review'&&row.candidates?.length>0&&<button type="button" className="fiducia-button fiducia-button-primary" style={{marginTop:6,padding:'6px 10px',fontSize:11}} onClick={()=>setBulkIdentityReviews(prev=>({...prev,[row.review_key]:{confirmed:true,candidate_ids:row.candidates.map(candidate=>candidate.id)}}))}>{bulkIdentityReviews[row.review_key]?'Confirmed — submit to save':'Verified: this is a separate person'}</button>}</li>)}</ul>}{bulkResult.skipped>10&&<div style={{marginTop:6}}>Showing the first 10 skipped rows. Fix the remaining rows in the box and submit again.</div>}</div>}
 <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button type="submit" disabled={bulkBusy||!accessToken||!bulkPreviewRows.length||bulkPreviewRows.length>200} className="fiducia-button fiducia-button-primary" style={{opacity:bulkBusy||!accessToken||!bulkPreviewRows.length||bulkPreviewRows.length>200?0.55:1}}>{bulkBusy?'Adding people…':'Add '+bulkPreviewRows.length+' people'}</button><button type="button" onClick={()=>{setShowBulkAdd(false);setBulkResult(null);setBulkIdentityReviews({})}} className="fiducia-button fiducia-button-ghost">Close</button></div>
 </form>}
{loading&&people.length>0&&<div role="status" style={{margin:'-10px 0 12px',padding:'7px 10px',borderRadius:10,background:'rgba(143,175,214,.05)',border:'1px solid rgba(143,175,214,.08)',color:'rgba(245,247,250,.42)',fontSize:10}}>Updating the people you’re viewing…</div>}{msg&&<div className="fiducia-card" style={{padding:10,marginBottom:15,color:msgKind==='error'?'#FCA5A5':'#34D399',textAlign:'center'}}>{msg}</div>}
<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(270px,1fr))',gap:12}}>{orderedFiltered.length===0?<div className="empty-state"><div style={{fontSize:18,color:'#f0f0f0',marginBottom:8}}>{search||activeFilterCount>0?'No people found':'No people yet'}</div><div style={{fontSize:13,color:'rgba(255,255,255,.35)',maxWidth:420}}>{search||activeFilterCount>0?'Try a different search or filter.':'Add your first person or use Scan to begin building the people your organization knows.'}</div></div>:orderedFiltered.map(person=>{const truth=person.living_truth;const status=truth?.status||null;const label=statusLabel(status);const editing=editingId===person.id;const fullName=personDisplayName(person);return <div key={person.id} data-person-id={person.id} data-scan-seen={seenScanIds.has(person.id)?'true':'false'} className={`fiducia-card person-card ${person.new_from_latest_scan&&!seenScanIds.has(person.id)?'new-scan-card':''}`} onPointerDown={e=>{if(editing||e.target?.closest?.('button,input,select,textarea,[contenteditable="true"]')){endLongPress();return}beginLongPress(person.id)}} onPointerEnter={()=>prefetchPerson(person.id)} onPointerUp={endLongPress} onPointerCancel={endLongPress} onPointerLeave={endLongPress} onClick={()=>handleCardClick(person.id)} style={{cursor:editing?'default':'pointer',border:selectedIds.has(person.id)?'1px solid #D4AF37':undefined,background:selectedIds.has(person.id)?'rgba(212,175,55,.08)':undefined,userSelect:editing?'text':'none',WebkitUserSelect:editing?'text':'none',position:'relative'}}>{selectMode&&<button type="button" aria-label={selectedIds.has(person.id)?`Deselect ${fullName}`:`Select ${fullName}`} onClick={e=>{e.stopPropagation();toggleSelected(person.id)}} style={{position:'absolute',top:12,right:12,width:28,height:28,borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',background:selectedIds.has(person.id)?'rgba(212,175,55,.16)':'rgba(255,255,255,.04)',border:selectedIds.has(person.id)?'1px solid rgba(212,175,55,.5)':'1px solid rgba(255,255,255,.18)',color:'#fff',cursor:'pointer'}}>{selectedIds.has(person.id)?ICONS.check:null}</button>}
{editing?<div onClick={e=>e.stopPropagation()} style={{display:'flex',flexDirection:'column',gap:8}}><div style={{fontSize:12,color:'rgba(255,255,255,.45)',marginBottom:2}}>Edit person</div><input value={editName} onChange={e=>{setEditIdentityReview(null);setEditName(e.target.value)}} style={inputStyle} placeholder="Full Name" autoFocus/><input value={editPhone} onChange={e=>{setEditIdentityReview(null);setEditPhone(e.target.value)}} style={inputStyle} placeholder="Phone" inputMode="tel"/><input type="email" value={editEmail} onChange={e=>setEditEmail(e.target.value)} style={inputStyle} placeholder="Email"/><div><label style={labelStyle}>Person type</label><select value={editType} onChange={e=>setEditType(e.target.value)} style={inputStyle}><option value="visitor">Visitor</option><option value="member">Member</option></select></div><div><label style={labelStyle}>Organization status</label><select value={editStatus} onChange={e=>setEditStatus(e.target.value)} style={inputStyle}><option value="active">Active — eligible for current care follow-ups</option><option value="inactive">Inactive — excluded from current follow-up suggestions</option></select></div><div><label style={labelStyle}>Date of birth</label><button type="button" onClick={()=>{setPickerTarget('edit');setShowPicker(true)}} style={birthdayButtonStyle(editBirthday)}>{editBirthday?new Date(`${editBirthday}T00:00:00`).toLocaleDateString():'Add date of birth'}</button>{editBirthday&&<div style={{fontSize:12,color:'rgba(255,255,255,.3)',marginTop:4}}>Next birthday in {getNextBirthday(editBirthday)} days</div>}</div>{editIdentityReview&&<div role="alert" data-person-edit-identity-review className="fiducia-card" style={{padding:12,border:'1px solid rgba(212,175,55,.35)',background:'rgba(212,175,55,.06)',display:'grid',gap:8}}><strong style={{color:'#f3df9c'}}>{editIdentityReview.code==='DUPLICATE_IDENTITY_NOT_DISTINCT'?'Same identity already exists':'Review possible identity matches'}</strong><p style={{margin:0,fontSize:12,lineHeight:1.5,color:'rgba(255,255,255,.72)'}}>{editIdentityReview.message}</p><p style={{margin:0,fontSize:11,lineHeight:1.5,color:'rgba(255,255,255,.58)'}}>Your edit has not been saved yet. After checking the candidates, use the confirmation below only when you know they are different people; NYEOCARE will then save these changes to this same record.</p>{editIdentityReview.candidates.map(candidate=><div key={candidate.id} style={{padding:'8px',borderRadius:9,background:'rgba(255,255,255,.035)',display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}><div><strong style={{display:'block',fontSize:12,color:'#f2f4f8'}}>{candidate.display_name||[candidate.first_name,candidate.last_name].filter(Boolean).join(' ')||'Unnamed person'}</strong><span style={{display:'block',fontSize:11,color:'rgba(255,255,255,.45)',marginTop:3}}>{candidate.phone||'No phone recorded'}{candidate.status?' · '+candidate.status:''}</span><span style={{display:'block',fontSize:10,color:'rgba(255,255,255,.35)',marginTop:2}}>{candidate.name_match?'Same normalized name · ':candidate.similar_name?'Similar name · ':''}{candidate.phone_match?'Same phone number':''}</span></div><button type="button" className="fiducia-button fiducia-button-ghost" onClick={()=>router.push('/person/'+candidate.id)}>Open record</button></div>)}{editIdentityReview.code!=='DUPLICATE_IDENTITY_NOT_DISTINCT'&&<button type="button" className="fiducia-button fiducia-button-primary" onClick={e=>{e.stopPropagation();saveEdit(person.id,{confirmed:true,candidate_ids:editIdentityReview.candidates.map(candidate=>candidate.id)})}}>Confirm separate identities & save changes</button>}<button type="button" className="fiducia-button fiducia-button-ghost" onClick={()=>setEditIdentityReview(null)}>Close review</button></div>}<div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button type="button" disabled={savingEditId===String(person.id)} onClick={e=>{e.preventDefault();e.stopPropagation();saveEdit(person.id)}} className="fiducia-button fiducia-button-primary" style={{padding:'6px 12px',fontSize:13,opacity:savingEditId===String(person.id)?0.65:1}}>{savingEditId===String(person.id)?'Saving…':'Save changes'}</button><button type="button" onClick={e=>{e.stopPropagation();cancelEdit()}} className="fiducia-button fiducia-button-ghost" style={{padding:'6px 12px',fontSize:13}}>Cancel</button></div></div>:<><div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:10}}><div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',minWidth:0,paddingRight:selectMode?34:0}}><span style={{fontWeight:600,fontSize:17,color:'#f0f0f0',overflow:'hidden',textOverflow:'ellipsis'}}>{fullName}</span>{status&&<span className='livingTruthDot' role='img' aria-label={statusLabel(status)||'Living Truth'} title={statusLabel(status)||'Living Truth'} style={{display:'inline-block',width:9,height:9,borderRadius:'50%',flexShrink:0,background:statusColor(status)}}/>}</div><div style={{display:'flex',alignItems:'center',gap:7,flexShrink:0}}><span style={{fontSize:11,padding:'2px 8px',borderRadius:20,background:'rgba(212,175,55,.15)',color:'#D4AF37',display:'flex',alignItems:'center',gap:4}}>{ICONS.visitor}{person.type||'visitor'}</span>{person.status==='inactive'&&<span style={{fontSize:10,padding:'3px 7px',borderRadius:20,background:'rgba(255,255,255,.06)',color:'rgba(255,255,255,.58)',border:'1px solid rgba(255,255,255,.08)'}}>Inactive</span>}</div></div><div className="ny-last-seen" aria-label={formatLastSeen(person.last_seen||person.last_seen_at)}>{ICONS.calendar}<span>{formatLastSeen(person.last_seen||person.last_seen_at)}</span></div><div className="ny-phone-row">{ICONS.phone}{personCardPhone(person)}</div>
</>}</div>})}</div>{nextCursor&&<div style={{display:'flex',justifyContent:'center',marginTop:18}}><button type="button" onClick={loadMore} disabled={loadingMore} className="fiducia-button fiducia-button-ghost" style={{padding:'9px 16px',fontSize:12}}>{loadingMore?'Loading more…':'Load more people'}</button></div>
}<style jsx global>{`.person-card{transition:box-shadow .18s ease,border-color .18s ease}.livingTruthDot{animation:pulse 2.5s ease-in-out infinite}.person-card:active{transform:translateY(0) scale(.994)}@media(hover:hover) and (pointer:fine){.person-card:hover{transform:translateY(-1px);box-shadow:0 12px 28px rgba(0,0,0,.16)}}@media(hover:none) and (pointer:coarse){.pagePeople .person-card{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}.livingTruthDot,.person-card.new-scan-card::after{animation:none!important}}.person-card.new-scan-card{box-shadow:0 0 0 1px rgba(212,175,55,.5),0 0 24px rgba(212,175,55,.10);overflow:hidden}.person-card.new-scan-card::after{content:"";position:absolute;inset:0;border-radius:inherit;padding:1px;background:conic-gradient(from 0deg,transparent 0deg,transparent 285deg,rgba(212,175,55,.98) 325deg,rgba(255,235,150,.95) 345deg,transparent 360deg);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);mask-composite:exclude;pointer-events:none;animation:nyeocareScanRing 2.2s linear infinite}@keyframes nyeocareScanRing{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.person-card{transition:none!important}.person-card.new-scan-card::after{animation:none!important}} `}</style>
{selectMode&&<div style={{position:'fixed',left:12,right:12,bottom:'calc(12px + env(safe-area-inset-bottom))',zIndex:1000,display:'flex',alignItems:'center',gap:8,padding:10,borderRadius:16,background:'rgba(12,16,28,.96)',border:'1px solid rgba(212,175,55,.22)',boxShadow:'0 12px 40px rgba(0,0,0,.35)',backdropFilter:'blur(18px)',WebkitBackdropFilter:'blur(18px)',flexWrap:'wrap'}}><div style={{fontSize:13,color:'#f0f0f0',fontWeight:600,marginRight:'auto'}}>{selectedIds.size} selected</div>{filtered.length>0&&<button onClick={allFilteredSelected?clearSelection:selectAll} className="fiducia-button fiducia-button-ghost" style={{padding:'7px 11px',fontSize:12}}>{allFilteredSelected?'Clear all':'Select all'}</button>}{selectedIds.size>0&&<button onClick={bulkDelete} className="fiducia-button fiducia-button-ghost danger-button" style={{padding:'7px 11px',fontSize:12,display:'inline-flex',alignItems:'center',gap:5}}>{ICONS.trash}Delete {selectedIds.size}</button>}<button onClick={cancelSelect} className="fiducia-button fiducia-button-ghost" style={{padding:'7px 11px',fontSize:12}}>Cancel</button></div>}
{showPicker&&<BirthdayPicker isOpen={showPicker} value={pickerTarget==='add'?form.birthday:editBirthday} onSave={value=>{if(pickerTarget==='add')setForm(f=>({...f,birthday:value||''}));else setEditBirthday(value||'');setShowPicker(false)}} onCancel={()=>setShowPicker(false)}/>}</div></Layout>;
}
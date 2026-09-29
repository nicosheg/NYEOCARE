// pages/aria.js
import{useCallback,useEffect,useRef,useState}from'react';
import{useRouter}from'next/router';
import Layout from'../components/Layout';
import{getClientSession,refreshClientSession}from'../lib/clientSession';

const ORG_PROMPTS=['What changed today?','Who needs attention?','What should I do next?','How is the organization doing?'];
const PERSON_PROMPTS=['What should I understand about this person?','What changed recently?','Is there anything I should do next?','What does ARIA remember?'];
const personName=p=>p?.display_name||[p?.first_name,p?.last_name].filter(Boolean).join(' ')||'This person';
const WHATSAPP_SESSION_KEY='nyeocare:aria:whatsapp-session:v1';
const WHATSAPP_LAUNCH_KEY='nyeocare:aria:whatsapp-launch:v1';
const readWhatsAppSession=()=>{
 try{
  const raw=localStorage.getItem(WHATSAPP_SESSION_KEY);
  if(!raw)return null;
  const value=JSON.parse(raw);
  if(!value||value.version!==1||!Array.isArray(value.items)||!value.items.length)return null;
  const items=value.items.filter(x=>x?.whatsappUrl&&x?.message&&x?.person_id);
  if(!items.length)return null;
  return Object.assign({},value,{items,nextIndex:Math.min(Math.max(Number(value.nextIndex)||0,0),items.length),autoAdvance:value.autoAdvance!==false,pendingReturn:Boolean(value.pendingReturn)});
 }catch{return null}
};


function inlineMarkdown(value){
 const source=String(value??'');
 const pattern=/(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|`[^`]+`)/g;
 const parts=[];let last=0,key=0,match;
 while((match=pattern.exec(source))){
  if(match.index>last)parts.push(source.slice(last,match.index));
  const token=match[0];
  if(token.startsWith('**')&&token.endsWith('**'))parts.push(<strong key={key++}>{token.slice(2,-2)}</strong>);
  else if(token.startsWith('__')&&token.endsWith('__'))parts.push(<strong key={key++}>{token.slice(2,-2)}</strong>);
  else if(token.startsWith('*')&&token.endsWith('*'))parts.push(<em key={key++}>{token.slice(1,-1)}</em>);
  else if(token.startsWith('_')&&token.endsWith('_'))parts.push(<em key={key++}>{token.slice(1,-1)}</em>);
  else parts.push(<code key={key++}>{token.slice(1,-1)}</code>);
  last=match.index+token.length;
 }
 if(last<source.length)parts.push(source.slice(last));
 return parts;
}

function MarkdownMessage({content}){
 const lines=String(content??'').replace(/\r\n?/g,'\n').split('\n');
 const nodes=[];let paragraph=[];let listItems=[];let ordered=false;
 const flushParagraph=()=>{if(!paragraph.length)return;nodes.push(<p key={'p'+nodes.length}>{paragraph.map((line,i)=><span key={i}>{i>0&&<br/>}{inlineMarkdown(line)}</span>)}</p>);paragraph=[]};
 const flushList=()=>{if(!listItems.length)return;const Tag=ordered?'ol':'ul';nodes.push(<Tag key={'l'+nodes.length}>{listItems.map((item,i)=><li key={i}>{inlineMarkdown(item)}</li>)}</Tag>);listItems=[];ordered=false};
 lines.forEach(line=>{
  const t=line.trim();
  const bullet=/^[-*+]\s+(.+)$/.exec(t);
  const number=/^\d+[.)]\s+(.+)$/.exec(t);
  const heading=/^#{1,6}\s+(.+)$/.exec(t);
  if(heading){flushParagraph();flushList();nodes.push(<h3 key={'h'+nodes.length}>{inlineMarkdown(heading[1])}</h3>);return}
  if(bullet||number){flushParagraph();const nextOrdered=Boolean(number);if(listItems.length&&ordered!==nextOrdered)flushList();ordered=nextOrdered;listItems.push((bullet||number)[1]);return}
  if(!t){flushParagraph();flushList();return}
  flushList();paragraph.push(line);
 });
 flushParagraph();flushList();
 return <div className='ariaMarkdown'>{nodes}</div>;
}

export default function AriaPage(){
 const router=useRouter(),threadRef=useRef(null),inputRef=useRef(null),mounted=useRef(true);
 const[ready,setReady]=useState(false),[sessionError,setSessionError]=useState('');
 const[personId,setPersonId]=useState(null),[person,setPerson]=useState(null),[search,setSearch]=useState(''),[matches,setMatches]=useState([]);
 const[messages,setMessages]=useState([]),[conversationId,setConversationId]=useState(null),[input,setInput]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const[suggestion,setSuggestion]=useState(null),[draft,setDraft]=useState(null),[daily,setDaily]=useState(null),[todayOpen,setTodayOpen]=useState(false);
 const[recent,setRecent]=useState([]),[recentOpen,setRecentOpen]=useState(false),[loadingRecent,setLoadingRecent]=useState(true);
 const[draftQueue,setDraftQueue]=useState([]),[draftQueueMeta,setDraftQueueMeta]=useState({needs_phone_review_count:0,needs_phone_review:[]}),[draftQueueOpen,setDraftQueueOpen]=useState(false),[loadingDraftQueue,setLoadingDraftQueue]=useState(false),[openedDrafts,setOpenedDrafts]=useState({});
 const[whatsappSession,setWhatsAppSession]=useState(null),[whatsAppAutoAdvance,setWhatsAppAutoAdvance]=useState(true);


 const resizeComposer=useCallback(el=>{
  if(!el)return;
  el.style.height='auto';
  el.style.height=Math.min(el.scrollHeight,180)+'px';
 },[]);


 const api=useCallback(async(url,init={})=>{
  let s=await getClientSession();if(!s)throw Error('Your session is not available. Please sign in again.');
  const base=Object.assign({},init.headers||{});
  const call=token=>fetch(url,Object.assign({},init,{headers:Object.assign({},base,{Authorization:'Bearer '+token})}));
  let r=await call(s.access_token);
  if(r.status===401){
   s=await refreshClientSession().catch(()=>null);
   if(!s)throw Error('Your session expired. Please sign in again.');
   r=await call(s.access_token);
  }
  return r;
 },[]);

 const loadDraftQueue=useCallback(async()=>{
  setLoadingDraftQueue(true);
  try{
   const r=await api('/api/aria/drafts?limit=100',{cache:'no-store'}),d=await r.json().catch(()=>({}));
   if(r.ok&&mounted.current){setDraftQueue(Array.isArray(d.drafts)?d.drafts:[]);setDraftQueueMeta({needs_phone_review_count:Number(d.needs_phone_review_count)||0,needs_phone_review:Array.isArray(d.needs_phone_review)?d.needs_phone_review:[]});}
  }catch{}finally{if(mounted.current)setLoadingDraftQueue(false)}
 },[api]);

 const loadRecent=useCallback(async()=>{
  try{
   const r=await api('/api/aria/conversations?limit=18',{cache:'no-store'}),d=await r.json().catch(()=>({}));
   if(r.ok)setRecent(Array.isArray(d.conversations)?d.conversations:[]);
  }catch{}finally{if(mounted.current)setLoadingRecent(false)}
 },[api]);

 const loadDaily=useCallback(async()=>{
  try{
   const r=await api('/api/aria/daily',{cache:'no-store'}),d=await r.json().catch(()=>({}));
   if(r.ok&&mounted.current)setDaily(d);
  }catch{}
 },[api]);

 const loadPerson=useCallback(async id=>{
  try{
   const r=await api('/api/person/journey?person_id='+encodeURIComponent(id),{cache:'no-store'}),d=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(d.error||'Unable to load this person.');
   if(mounted.current)setPerson(d.person||null);
  }catch(e){if(mounted.current)setError(e.message)}
 },[api]);

 const openConversation=useCallback(async id=>{
  if(!id)return;
  try{
   const r=await api('/api/aria/conversations?conversationId='+encodeURIComponent(id),{cache:'no-store'}),d=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(d.error||'Unable to open this conversation.');
   if(!mounted.current)return;
   setConversationId(d.conversation?.id||id);
   setPersonId(d.conversation?.person_id||null);
   setMessages((d.messages||[]).map(x=>({id:x.id,role:x.role,content:x.content,at:x.created_at||Date.now()})));
   const pending=d.pendingAction;
   setSuggestion(pending?{personId:pending.person_id||null,actionId:pending.id,actionType:pending.type,label:pending.type==='SEND_MESSAGE'?'Prepare WhatsApp message':'Prepare action',reason:pending.action_metadata?.reason||'ARIA has a pending action waiting for your confirmation.',approved:false,requiresApproval:true,status:'awaiting_confirmation'}:null);
   setDraft(null);setError('');setRecentOpen(false);
  }catch(e){if(mounted.current)setError(e.message)}
 },[api]);

 useEffect(()=>{
  mounted.current=true;
  (async()=>{
   try{
    const s=await getClientSession();
    if(!s){if(mounted.current){setSessionError('Your session is not available.');setReady(true)}return}
    if(mounted.current)setReady(true);
    const id=String(router.query.personId||'').trim()||null;
    const conversation=String(router.query.conversation||'').trim()||null;
    const prompt=String(router.query.prompt||'').trim();
    if(mounted.current){setPersonId(id);setInput(prompt.slice(0,4000))}
    if(id)await loadPerson(id);else if(mounted.current)setPerson(null);
    if(conversation)await openConversation(conversation);
    await Promise.all([loadRecent(),loadDaily(),loadDraftQueue()]);
   }catch(e){if(mounted.current){setSessionError(e.message);setReady(true)}}
  })();
  return()=>{mounted.current=false};
 },[]);

 useEffect(()=>{const el=threadRef.current;if(el)el.scrollTo({top:el.scrollHeight,behavior:'smooth'})},[messages,busy,suggestion,draft]);
 
 useEffect(()=>{
  const restore=()=>{
   const session=readWhatsAppSession();
   if(session&&mounted.current){setWhatsAppSession(session);setWhatsAppAutoAdvance(session.autoAdvance!==false);}
   try{
    const marker=JSON.parse(sessionStorage.getItem(WHATSAPP_LAUNCH_KEY)||'null');
    if(!marker?.at||(Date.now()-Number(marker.at)>10*60*1000))return;
    sessionStorage.removeItem(WHATSAPP_LAUNCH_KEY);
    if(!session?.pendingReturn)return;
    const resumed=Object.assign({},session,{pendingReturn:false});
    try{localStorage.setItem(WHATSAPP_SESSION_KEY,JSON.stringify(resumed))}catch{}
    if(mounted.current){setWhatsAppSession(resumed);setWhatsAppAutoAdvance(resumed.autoAdvance!==false);}
    if(resumed.autoAdvance!==false&&resumed.nextIndex<resumed.items.length){
     window.setTimeout(()=>{
      if(mounted.current)openWhatsAppFromSession(resumed,resumed.nextIndex);
     },420);
    }
   }catch{}
  };
  window.addEventListener('pageshow',restore);
  restore();
  return()=>window.removeEventListener('pageshow',restore);
 },[]);


 useEffect(()=>{
  const q=search.trim();
  if(!q){setMatches([]);return}
  let cancelled=false;
  const t=setTimeout(async()=>{
   try{
    const r=await api('/api/people?limit=8&search='+encodeURIComponent(q),{cache:'no-store'}),d=await r.json().catch(()=>({}));
    if(!cancelled&&r.ok)setMatches(Array.isArray(d.items)?d.items:[]);
   }catch{}
  },220);
  return()=>{cancelled=true;clearTimeout(t)};
 },[search,api]);

 const choosePerson=id=>{
  setSearch('');setMatches([]);setMessages([]);setConversationId(null);setSuggestion(null);setDraft(null);setError('');
  router.replace({pathname:'/aria',query:{personId:id}},undefined,{shallow:true});
  loadPerson(id);
 };
 const clearPerson=()=>{
  setPersonId(null);setPerson(null);setMessages([]);setConversationId(null);setSuggestion(null);setDraft(null);setError('');
  router.replace('/aria',undefined,{shallow:true});
 };
 const newConversation=()=>{
  setMessages([]);setConversationId(null);setSuggestion(null);setDraft(null);setError('');
  setInput('');requestAnimationFrame(()=>{if(inputRef.current){resizeComposer(inputRef.current);inputRef.current.focus()}});
 };
 const saveWhatsAppSession=useCallback(session=>{
  try{localStorage.setItem(WHATSAPP_SESSION_KEY,JSON.stringify(session))}catch{}
  if(mounted.current){setWhatsAppSession(session);setWhatsAppAutoAdvance(session.autoAdvance!==false);}
 },[]);
 const openWhatsAppFromSession=useCallback((session,index)=>{
  const target=session?.items?.[index];
  if(!target?.whatsappUrl)return;
  const next=Object.assign({},session,{nextIndex:index+1,openedCount:(Number(session.openedCount)||0)+1,pendingReturn:true,lastOpenedId:target.communication_id||target.person_id,lastOpenedAt:Date.now()});
  saveWhatsAppSession(next);
  try{sessionStorage.setItem(WHATSAPP_LAUNCH_KEY,JSON.stringify({at:Date.now()}))}catch{}
  window.location.assign(target.whatsappUrl);
 },[saveWhatsAppSession]);
 const startWhatsAppSession=useCallback(drafts=>{
  const items=[];
  const seen=new Set();
  for(const item of Array.isArray(drafts)?drafts:[]){
   const key=String(item.communication_id||item.person_id||'');
   if(!key||seen.has(key)||!item.whatsappUrl||!item.message)continue;
   seen.add(key);
   items.push({person_id:item.person_id,communication_id:item.communication_id||null,name:item.name||'Person',message:item.message,whatsappUrl:item.whatsappUrl});
  }
  if(!items.length){setError('There are no WhatsApp-ready drafts in this batch.');return;}
  const session={version:1,batchId: drafts?.batchId||null,items,nextIndex:0,openedCount:0,pendingReturn:false,autoAdvance:true,createdAt:Date.now()};
  saveWhatsAppSession(session);
  setError('');
  openWhatsAppFromSession(session,0);
 },[openWhatsAppFromSession,saveWhatsAppSession]);
 const finishWhatsAppSession=useCallback(()=>{
  try{localStorage.removeItem(WHATSAPP_SESSION_KEY);sessionStorage.removeItem(WHATSAPP_LAUNCH_KEY)}catch{}
  setWhatsAppSession(null);setWhatsAppAutoAdvance(true);
 },[]);
 const toggleWhatsAppAutoAdvance=useCallback(()=>{
  const next=!whatsAppAutoAdvance;
  setWhatsAppAutoAdvance(next);
  if(whatsappSession){
   const updated=Object.assign({},whatsappSession,{autoAdvance:next});
   try{localStorage.setItem(WHATSAPP_SESSION_KEY,JSON.stringify(updated))}catch{}
   setWhatsAppSession(updated);
  }
 },[whatsAppAutoAdvance,whatsappSession]);

 const send=async(value)=>{
  const message=String(value??input).trim();if(!message||busy)return;
  setInput('');setError('');setSuggestion(null);setDraft(null);setBusy(true);
  const optimistic={id:'local-'+Date.now(),role:'user',content:message,at:Date.now()};
  setMessages(v=>v.concat(optimistic));
  try{
   const body={message,conversationId:conversationId||null,timeZone:(typeof Intl!=='undefined'&&Intl.DateTimeFormat?Intl.DateTimeFormat().resolvedOptions().timeZone:null)};if(personId)body.personId=personId;
   const r=await api('/api/aria/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),d=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(d.error||'ARIA could not answer that right now.');
   if(mounted.current){
    setConversationId(d.conversationId||conversationId||null);
    setMessages(v=>v.filter(x=>x.id!==optimistic.id).concat([{id:'user-'+Date.now(),role:'user',content:message,at:Date.now()},{id:'aria-'+Date.now(),role:'assistant',content:d.text||'I checked the available context but do not have a useful answer yet.',at:Date.now()}]));
    setSuggestion(d.suggestedAction||null);
   const draftResult=d.draft||(Array.isArray(d.results)?d.results.find(x=>x?.capability==='draft_message_cohort'||x?.capability==='draft_message'):null);
   setDraft(draftResult?.drafts?draftResult:draftResult?.draft||draftResult||null);
   }
   loadRecent();loadDraftQueue();
  }catch(e){
   if(mounted.current){setMessages(v=>v.filter(x=>x.id!==optimistic.id));setError(e.message||'ARIA could not answer that right now.')}
  }finally{if(mounted.current)setBusy(false)}
 };
 const approve=async()=>{
  if(!suggestion?.personId||busy)return;
  setBusy(true);setError('');
  try{
   const payload=suggestion.actionId?{actionId:suggestion.actionId}:{personId:suggestion.personId,actionType:suggestion.actionType||'SEND_MESSAGE',metadata:{source:'aria_page',conversation_id:conversationId||null,reason:suggestion.reason||null}};
   const endpoint=suggestion.actionId?'/api/aria/action/approve':'/api/aria/action/prepare-approve';
   const r=await api(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),d=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(d.error||'Unable to approve the next action.');
   setSuggestion(v=>Object.assign({},v,{actionId:d.action?.id||v.actionId,status:'approved',approved:true}));
   loadRecent();
  }catch(e){setError(e.message)}
  finally{setBusy(false)}
 };
 const draftMessage=async()=>{
  if(suggestion?.approved!==true||suggestion?.actionId==null||suggestion?.actionType!=='SEND_MESSAGE'||busy)return;
  setBusy(true);setError('');
  try{
   const r=await api('/api/aria/draft',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({personId:suggestion.personId,actionId:suggestion.actionId,actionType:suggestion.actionType,approvedOnly:true})}),d=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(d.error||'Unable to draft the message.');
   setDraft(d);
  }catch(e){setError(e.message)}
  finally{setBusy(false)}
 };

 if(!ready)return <Layout><main className="ariaPage center"><span className="ariaOrb">A</span><span>Opening ARIA…</span></main></Layout>;
 if(sessionError)return <Layout><main className="ariaPage center"><span className="ariaOrb large">A</span><h1>ARIA is ready when you are.</h1><p>{sessionError}</p><button onClick={()=>router.replace('/login')}>Go to sign in</button></main></Layout>;

 const current=person?personName(person):'Your organization';
 const prompts=personId?PERSON_PROMPTS:ORG_PROMPTS;
 return <Layout><main className="ariaPage">
  <header className="ariaHead"><button className="round" onClick={()=>router.push(personId?'/people':'/')} aria-label="Back">‹</button><div className="headCopy"><span className="eyebrow">ARIA</span><h1>Talk to ARIA</h1><p>Ask. Explore. Remember. Decide what matters next.</p></div><div className="headTools"><button className="draftBtn" onClick={()=>{setDraftQueueOpen(v=>!v);if(!draftQueue.length)loadDraftQueue()}}>DRAFTS <b>{draftQueue.length}</b></button><button className="todayBtn" onClick={()=>setTodayOpen(v=>!v)}>TODAY <b>{todayOpen?'−':'+'}</b></button></div></header>

  <section className="context"><div><span className="label">CONTEXT</span><strong>{current}</strong><small>{personId?'Person journey, memory and recent signals':'Organization memory, people and today’s signals'}</small></div>{personId?<button onClick={clearPerson}>Organization</button>:<div className="finder"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Find a person…"/>{matches.length>0&&<div className="matches">{matches.map(p=><button key={p.id} onClick={()=>choosePerson(p.id)}><b>{personName(p)}</b><small>{p.phone||p.email||p.type||'Person'}</small></button>)}</div>}</div>}</section>

  {todayOpen&&<section className="todayPanel"><span className="label">ARIA · TODAY</span>{daily?<><strong>{daily.director?.primary_focus?.title||daily.nextAction}</strong><p>{daily.director?.primary_focus?.summary||daily.summary}</p>{daily.director?.intelligence?.insight?.title&&<small className="todayInsight">{daily.director.intelligence.insight.title}</small>}<div className="stats"><span><b>{daily.organization?.peopleCount||0}</b>People</span><span><b>{daily.organization?.sessionsLast30Days||0}</b>Sessions</span><span><b>{daily.organization?.activeAttendeesLast30Days||0}</b>Active</span></div><button onClick={()=>send('Walk me through today’s briefing, starting with what matters most.')}>Talk through it</button></>:<div className="quiet">Loading today’s intelligence…</div>}</section>}

  <section className="stage">
   {!messages.length&&!busy?<div className="welcome"><span className="welcomeOrb">A</span><span className="label">{personId?'PERSON JOURNEY':'ORGANIZATION MEMORY'}</span><h2>{personId?'What would you like to understand about '+current+'?':'What is on your mind?'}</h2><p>Talk naturally. ARIA keeps the thread, uses the context she can verify, and can turn a useful understanding into a human-reviewed next step.</p><div className="prompts">{prompts.map(x=><button key={x} onClick={()=>send(x)}>{x}<b>›</b></button>)}</div>{daily?.summary&&!todayOpen&&<button className="todayTeaser" onClick={()=>setTodayOpen(true)}><span><small>ARIA · TODAY</small><strong>{daily.summary}</strong></span><b>Open briefing ›</b></button>}</div>:null}
   <div className={"thread "+((messages.length||busy||error||suggestion||draft)?"interactive":"passive")} ref={threadRef}>{messages.map((m,i)=><article className={'message '+m.role} key={(m.id||m.at)+'-'+i}><small>{m.role==='assistant'?'ARIA':'YOU'}</small><div>{m.role==="assistant"?<MarkdownMessage content={m.content}/>:m.content}</div></article>)}{busy&&<div className="thinking"><span className="thinkingOrb">A</span><span>ARIA is thinking…<small>Using only the context needed for this question.</small></span></div>}{error&&<div className="error">{error}</div>}{suggestion&&<div className="next"><div><small>{suggestion.status==='awaiting_confirmation'?'CONFIRM WITH ARIA':'NEXT ACTION'}</small><strong>{suggestion.label||'ARIA suggests a next step'}</strong><span>{suggestion.reason||'Nothing happens without your approval.'}</span></div><div className="nextActions">{suggestion.status==='awaiting_confirmation'?<><button onClick={()=>send('Yes, prepare it.')} disabled={busy}>Prepare it</button><button onClick={()=>send('No, not now.')} disabled={busy}>Not now</button></>:suggestion.approved===true&&suggestion.actionId&&suggestion.actionType==='SEND_MESSAGE'?<button onClick={draftMessage} disabled={busy}>Draft message</button>:suggestion.personId?<button onClick={approve} disabled={busy}>{suggestion.actionId?'Approve action':'Approve next step'}</button>:null}</div></div>}{draft&&<div className="draft">{Array.isArray(draft.drafts)?<><small>MESSAGE DRAFTS · {draft.drafts.length}</small>{draft.whatsappNote&&<p className="draftNote">{draft.whatsappNote}</p>}<div className="waBatchStart"><div><strong>WhatsApp session ready</strong><span>{draft.drafts.filter(x=>x?.whatsappUrl&&x?.message).length} personalized chats are ready to open.</span></div><button type="button" onClick={()=>startWhatsAppSession(draft)} disabled={!draft.drafts.some(x=>x?.whatsappUrl&&x?.message)}>{whatsappSession?'Resume WhatsApp session':'Start WhatsApp'}</button></div><div className="draftList">{draft.drafts.map((item,i)=><article className="draftItem" key={item.communication_id||item.person_id||i}><div><b>{item.name||'Person'}</b>{item.message?<p>{item.message}</p>:<p className="draftError">{item.error||'This draft could not be prepared.'}</p>}</div><div className="draftActions">{item.whatsappUrl&&<a href={item.whatsappUrl} target="_self" rel="noreferrer" onClick={()=>setOpenedDrafts(v=>Object.assign({},v,{[item.communication_id||item.person_id||i]:true}))}>{openedDrafts[item.communication_id||item.person_id||i]?'Opened · Send ↗':'Open WhatsApp ↗'}</a>}{item.message&&<button onClick={()=>{navigator.clipboard?.writeText(item.message).catch(()=>{});setError('Draft copied to clipboard.')}}>Copy</button>}</div></article>)}</div></>:<><small>DRAFT MESSAGE</small><p>{draft.message}</p><div className="draftActions">{draft.whatsappUrl?<a href={draft.whatsappUrl} target="_self" rel="noreferrer">Review in WhatsApp ↗</a>:<span>No phone number is recorded for WhatsApp.</span>}<button onClick={()=>{navigator.clipboard?.writeText(draft.message||'').catch(()=>{});setError('Draft copied to clipboard.')}}>Copy</button></div></>}</div>}</div>
  </section>
  {whatsappSession&&<section className="whatsappSession"><header><div><span className="label">WHATSAPP SESSION</span><strong>{Math.max(whatsappSession.items.length-whatsappSession.nextIndex,0)} remaining</strong></div><button type="button" onClick={finishWhatsAppSession}>Finish</button></header>{whatsappSession.nextIndex<whatsappSession.items.length?<><div className="waCurrent"><small>NEXT CHAT</small><b>{whatsappSession.items[whatsappSession.nextIndex]?.name||'Next person'}</b><p>{whatsappSession.items[whatsappSession.nextIndex]?.message||''}</p></div><div className="waSessionActions"><button type="button" onClick={()=>openWhatsAppFromSession(whatsappSession,whatsappSession.nextIndex)}>Open next in WhatsApp</button><button type="button" className={whatsAppAutoAdvance?'activeToggle':''} onClick={toggleWhatsAppAutoAdvance}>{whatsAppAutoAdvance?'Auto-next ON':'Auto-next OFF'}</button></div><small className="waSessionNote">After you leave a WhatsApp chat and return to NYEOCARE, Auto-next can open the next prepared chat for you. You still press Send yourself.</small></>:<div className="waDone"><b>All WhatsApp-ready chats have been opened.</b><span>Return to this session only if you need to reopen one or finish the batch.</span></div>}</section>}

  <form className="composer" onSubmit={e=>e.preventDefault()}><button type="button" onClick={newConversation} aria-label="New conversation">＋</button><textarea ref={inputRef} value={input} onChange={e=>{setInput(e.target.value);resizeComposer(e.currentTarget)}} onKeyDown={e=>{if(e.key!=='Enter')return;e.preventDefault();const el=e.currentTarget,start=el.selectionStart??input.length,end=el.selectionEnd??start,next=input.slice(0,start)+'\n'+input.slice(end);setInput(next);requestAnimationFrame(()=>{try{el.selectionStart=el.selectionEnd=start+1}catch{};resizeComposer(el)})}} rows={1} maxLength={4000} placeholder={personId?'Talk about '+(person?.first_name||'this person')+'…':'Talk to ARIA about anything in NYEOCARE…'} disabled={busy}/><button type="button" onClick={()=>send()} disabled={!input.trim()||busy}>{busy?'…':'Send'}</button></form>

  <footer className="ariaFooter"><span>ARIA advises. You decide.</span><button onClick={()=>{setRecentOpen(v=>!v);if(!recent.length)loadRecent()}}>Recent conversations</button></footer>
  {draftQueueOpen&&<aside className="draftQueue"><header><span>WHATSAPP DRAFT QUEUE · {draftQueue.length}</span><button onClick={()=>setDraftQueueOpen(false)}>×</button></header>{loadingDraftQueue?<p>Loading drafts…</p>:<><p className="queueIntro">A WhatsApp session lets ARIA keep the batch in order. Start it from the message batch above; individual cards remain available as a manual fallback.</p>{draftQueueMeta.needs_phone_review_count>0&&<div className="queueReview"><strong>PHONE REVIEW · {draftQueueMeta.needs_phone_review_count}</strong>{draftQueueMeta.needs_phone_review.slice(0,8).map((item,i)=><div key={item.id||item.person_id||i}><b>{item.name}</b><small>{item.phone||'No safe phone number'} · held for review</small></div>)}</div>}{draftQueue.length?draftQueue.map(item=><article key={item.id} className="queueItem"><div className="queueCopy"><b>{item.name}</b><p>{item.message}</p><small>{item.message_purpose||'Message draft'} · {new Date(item.created_at).toLocaleString()}</small></div><div className="queueActions">{item.whatsappUrl?<a href={item.whatsappUrl} target="_self" rel="noreferrer" onClick={()=>setOpenedDrafts(v=>Object.assign({},v,{[item.id]:true}))}>{openedDrafts[item.id]?'Opened · Send ↗':'Open WhatsApp ↗'}</a>:<span>No safe WhatsApp number</span>}<button onClick={()=>{navigator.clipboard?.writeText(item.message||'').catch(()=>{});setError('Draft copied to clipboard.')}}>Copy</button></div></article>):<p>No WhatsApp-ready drafts are queued.</p>}<small className="queueFootnote">A valid phone format does not guarantee that the number has an active WhatsApp account; WhatsApp determines that when the chat opens. NYEOCARE never sends messages automatically.</small></>}</aside>}
  {recentOpen&&<aside className="recent"><header><span>CONVERSATIONS</span><button onClick={()=>setRecentOpen(false)}>×</button></header>{loadingRecent?<p>Loading…</p>:recent.length?recent.map(x=><button key={x.id} onClick={()=>openConversation(x.id)}><b>{x.person_name||'Organization'}</b><small>{x.preview||'Conversation with ARIA'}</small></button>):<p>No saved conversations yet.</p>}</aside>}

  <style jsx>{'.ariaPage{position:relative;z-index:3;width:min(100%,1000px);min-height:calc(100dvh - 108px);margin:0 auto;padding:8px 12px 28px;display:flex;flex-direction:column;gap:9px;color:#F5F7FA}.ariaHead{display:flex;align-items:center;gap:10px;min-height:52px}.ariaHead h1{margin:2px 0;font-size:25px;letter-spacing:-.04em}.ariaHead p{margin:0;color:rgba(245,247,250,.37);font-size:9.5px}.headCopy{min-width:0}.round{width:38px;height:38px;border:1px solid rgba(255,255,255,.09);background:rgba(8,15,28,.55);border-radius:13px;color:#fff;font-size:25px}.headTools{margin-left:auto;display:flex;align-items:center;gap:6px}.draftBtn{border:1px solid rgba(214,184,106,.16);background:rgba(214,184,106,.05);border-radius:12px;padding:7px 9px;color:#E8D49A;font-size:7px;letter-spacing:.12em}.draftBtn b{margin-left:4px;color:#fff}.todayBtn{border:1px solid rgba(255,255,255,.09);background:rgba(8,15,28,.55);border-radius:12px;padding:7px 9px;color:#8FAFD6;font-size:7px;letter-spacing:.16em}.todayBtn b{margin-left:6px;color:#D6B86A;font-size:13px}.eyebrow,.label{color:#8FAFD6;font-size:8px;letter-spacing:.18em}.context,.todayPanel,.stage{border:1px solid rgba(143,175,214,.1);background:linear-gradient(145deg,rgba(16,29,49,.64),rgba(5,11,22,.68));backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}.context{position:relative;z-index:20;display:flex;justify-content:space-between;align-items:center;gap:9px;padding:10px 11px;border-radius:18px}.context>div:first-child{min-width:0;flex:1}.context strong{display:block;margin-top:3px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.context small{display:block;margin-top:2px;color:rgba(245,247,250,.3);font-size:8px}.context>button{border:1px solid rgba(214,184,106,.16);background:rgba(214,184,106,.05);color:#E8D49A;border-radius:999px;padding:7px 9px;font-size:8px}.finder{position:relative;z-index:25}.finder input{width:155px;max-width:42vw;padding:8px 9px;border:1px solid rgba(255,255,255,.08);border-radius:999px;background:rgba(255,255,255,.03);color:#fff;outline:none;font-size:9px}.matches{position:absolute;z-index:1000;top:37px;right:0;width:min(290px,82vw);padding:5px;border:1px solid rgba(255,255,255,.1);border-radius:13px;background:#0B1424;box-shadow:0 22px 60px rgba(0,0,0,.45)}.matches button{width:100%;display:grid;gap:2px;padding:8px;border:0;border-radius:9px;background:transparent;color:#fff;text-align:left}.matches button:hover{background:rgba(143,175,214,.06)}.matches small{color:rgba(255,255,255,.3);font-size:8px}.todayPanel{padding:11px;border-radius:18px}.todayPanel>strong{display:block;margin-top:4px;font-size:10.5px}.todayPanel>p{margin:5px 0;color:rgba(245,247,250,.38);font-size:9px}.todayInsight{display:block;margin:5px 0;color:#D6B86A;font-size:7.5px;line-height:1.35}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin:7px 0}.stats span{padding:6px;border-radius:10px;background:rgba(255,255,255,.03);color:rgba(245,247,250,.3);font-size:7.5px}.stats b{display:block;color:#fff;font-size:13px}.todayPanel>button{border:0;border-radius:10px;background:#D6B86A;color:#07101F;padding:7px 9px;font-size:8.5px;font-weight:700}.stage{position:relative;flex:1;min-height:52vh;border-radius:21px;overflow:hidden}.welcome{min-height:100%;display:grid;align-content:center;justify-items:center;text-align:center;padding:28px 14px}.welcomeOrb{display:grid;place-items:center;width:46px;height:46px;border-radius:50%;background:radial-gradient(circle at 30% 18%,#fff,rgba(231,244,250,.92) 20%,rgba(143,175,214,.8) 56%,rgba(15,35,57,.98));color:#17334a;font-weight:800;box-shadow:inset 0 2px 5px rgba(255,255,255,.58),0 12px 30px rgba(0,0,0,.25);margin-bottom:8px}.welcome h2{max-width:620px;margin:7px 0 5px;font-size:20px;letter-spacing:-.025em}.welcome p{max-width:570px;margin:0;color:rgba(245,247,250,.36);font-size:9.5px;line-height:1.55}.prompts{width:min(100%,620px);display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:13px}.prompts button,.todayTeaser{border:1px solid rgba(143,175,214,.1);background:rgba(143,175,214,.04);border-radius:12px;color:rgba(245,247,250,.75);padding:9px;text-align:left;font-size:9px}.prompts button{cursor:pointer}.prompts b{float:right;color:#D6B86A}.todayTeaser{display:flex;justify-content:space-between;gap:7px;width:min(100%,620px);margin-top:7px;cursor:pointer}.todayTeaser span{display:grid;gap:2px}.todayTeaser small{color:#D6B86A;font-size:6px;letter-spacing:.15em}.todayTeaser strong{font-size:9px}.thread{position:absolute;inset:0;overflow:auto;padding:11px;display:flex;flex-direction:column;gap:7px;pointer-events:none}.thread.interactive{pointer-events:auto}.message{max-width:88%;padding:9px 10px;border-radius:13px;font-size:10.5px;line-height:1.55}.ariaMarkdown{white-space:normal}.ariaMarkdown p{margin:0 0 8px}.ariaMarkdown p:last-child{margin-bottom:0}.ariaMarkdown h3{margin:0 0 7px;line-height:1.3;font-size:inherit;font-weight:750}.ariaMarkdown ul,.ariaMarkdown ol{margin:5px 0 8px;padding-left:18px}.ariaMarkdown li{margin:3px 0;padding-left:2px}.ariaMarkdown strong{font-weight:750;color:#fff}.ariaMarkdown em{font-style:italic}.ariaMarkdown code{padding:1px 4px;border-radius:5px;background:rgba(255,255,255,.07);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em}.message.user{align-self:flex-end;background:rgba(214,184,106,.06);border:1px solid rgba(214,184,106,.1);border-bottom-right-radius:4px}.message.assistant{align-self:flex-start;background:rgba(143,175,214,.045);border:1px solid rgba(143,175,214,.09);border-bottom-left-radius:4px}.message small,.next small,.draft>small{display:block;margin-bottom:3px;font-size:6.5px;letter-spacing:.16em;opacity:.4}.thinking{display:flex;align-items:center;gap:7px;color:rgba(245,247,250,.5);font-size:9px}.thinkingOrb{width:27px;height:27px;display:grid;place-items:center;border-radius:50%;background:radial-gradient(circle at 30% 18%,#fff,rgba(143,175,214,.75) 55%,#0b1628);color:#17334a;font-size:8px;font-weight:800}.thinking small{display:block;margin-top:2px;color:rgba(245,247,250,.24);font-size:7px}.error{align-self:center;padding:7px 9px;border-radius:9px;background:rgba(215,123,123,.05);border:1px solid rgba(215,123,123,.15);color:#e4aaaa;font-size:8px}.next,.draft{padding:9px;border-top:1px solid rgba(255,255,255,.06);background:rgba(214,184,106,.035)}.next{display:flex;justify-content:space-between;gap:8px}.next strong{display:block;font-size:10px}.next span{display:block;margin-top:2px;color:rgba(245,247,250,.32);font-size:8px;line-height:1.35}.nextActions button,.draft a,.draftActions button{border:0;border-radius:9px;background:#D6B86A;color:#07101F;padding:7px 9px;font-size:8.5px;font-weight:700;text-decoration:none;white-space:nowrap}.queueIntro{margin:6px 2px 8px;color:rgba(245,247,250,.48);font-size:8px;line-height:1.45}.queueReview{padding:7px 8px;margin-bottom:6px;border-radius:10px;background:rgba(215,171,92,.05);border:1px solid rgba(215,171,92,.12)}.queueReview strong{display:block;color:#D6B86A;font-size:7px;letter-spacing:.13em;margin-bottom:5px}.queueReview>div{display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-top:1px solid rgba(255,255,255,.05)}.queueReview b{font-size:8px}.queueReview small{font-size:7px;color:rgba(245,247,250,.28)}.queueFootnote{display:block;margin:7px 2px 2px;color:rgba(245,247,250,.22);font-size:7px;line-height:1.4}.waBatchStart{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 0;padding:9px;border:1px solid rgba(214,184,106,.16);border-radius:11px;background:rgba(214,184,106,.045)}.waBatchStart div{min-width:0;display:grid;gap:3px}.waBatchStart strong{font-size:9.5px}.waBatchStart span{color:rgba(245,247,250,.36);font-size:7.5px}.waBatchStart button{border:0;border-radius:9px;background:#D6B86A;color:#07101F;padding:8px 10px;font-size:8px;font-weight:800;white-space:nowrap}.waBatchStart button:disabled{opacity:.35}.whatsappSession{border:1px solid rgba(214,184,106,.18);background:linear-gradient(145deg,rgba(25,30,44,.85),rgba(7,13,24,.9));border-radius:17px;padding:10px;box-shadow:0 16px 45px rgba(0,0,0,.2)}.whatsappSession header{display:flex;justify-content:space-between;align-items:center;gap:8px}.whatsappSession header>div{display:grid;gap:3px}.whatsappSession header strong{font-size:15px;letter-spacing:-.02em}.whatsappSession header button{border:0;background:transparent;color:rgba(245,247,250,.35);font-size:7px;letter-spacing:.12em}.waCurrent{margin-top:8px;padding:9px;border-radius:11px;background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.06)}.waCurrent small{font-size:6px;letter-spacing:.16em;color:#D6B86A}.waCurrent b{display:block;margin-top:3px;font-size:10px}.waCurrent p{margin:4px 0 0;color:rgba(245,247,250,.55);font-size:8.5px;line-height:1.45}.waSessionActions{display:flex;gap:6px;margin-top:8px}.waSessionActions button{flex:1;border:0;border-radius:9px;padding:8px 9px;background:#D6B86A;color:#07101F;font-size:8px;font-weight:800}.waSessionActions button.activeToggle{background:rgba(214,184,106,.11);border:1px solid rgba(214,184,106,.23);color:#E8D49A}.waSessionNote{display:block;margin-top:7px;color:rgba(245,247,250,.27);font-size:7px;line-height:1.45}.waDone{display:grid;gap:3px;padding:8px 0;color:rgba(245,247,250,.42);font-size:8px}.waDone b{color:#fff;font-size:9px}.draft p{margin:5px 0 8px;color:rgba(245,247,250,.78);font-size:9.5px;line-height:1.5}.draftNote{color:rgba(245,247,250,.42)!important}.draftList{display:grid;gap:7px;margin-top:7px}.draftItem{padding:8px;border:1px solid rgba(255,255,255,.07);border-radius:10px;background:rgba(255,255,255,.025)}.draftItem b{font-size:9px}.draftError{color:#e4aaaa!important}.draftActions{display:flex;gap:6px;align-items:center}.draftActions span{color:rgba(245,247,250,.3);font-size:8px}.composer{display:flex;align-items:flex-end;gap:5px;padding:6px 7px;border:1px solid rgba(255,255,255,.09);border-radius:16px;background:rgba(7,13,24,.8);backdrop-filter:blur(17px);-webkit-backdrop-filter:blur(17px)}.composer textarea{flex:1;min-height:37px;max-height:180px;resize:none;overflow-y:auto;padding:9px 3px;border:0;outline:none;background:transparent;color:#fff;font-size:11px;line-height:1.45;scrollbar-width:thin}.composer>button{height:37px;min-width:34px;border:1px solid rgba(255,255,255,.07);border-radius:10px;background:rgba(255,255,255,.035);color:#fff}.composer>button:last-child{min-width:58px;background:#D6B86A;color:#07101F;font-weight:700}.composer>button:disabled{opacity:.4}.ariaFooter{display:flex;justify-content:space-between;padding:0 3px;color:rgba(245,247,250,.2);font-size:7px}.ariaFooter button{border:0;background:none;color:rgba(245,247,250,.3);font-size:7px}.draftQueue{position:fixed;right:12px;bottom:75px;width:min(460px,calc(100vw - 24px));max-height:min(70vh,620px);overflow:auto;z-index:100000;padding:8px;border-radius:17px;background:#091321;border:1px solid rgba(255,255,255,.1);box-shadow:0 25px 70px rgba(0,0,0,.5)}.draftQueue header{display:flex;justify-content:space-between;padding:4px;color:#D6B86A;font-size:7px;letter-spacing:.18em}.draftQueue header button{border:0;background:none;color:#fff;font-size:17px}.queueItem{display:grid;gap:7px;padding:10px;border-top:1px solid rgba(255,255,255,.06)}.queueCopy b{font-size:9.5px}.queueCopy p{margin:4px 0;color:rgba(245,247,250,.78);font-size:9px;line-height:1.45}.queueCopy small,.draftQueue>p{color:rgba(245,247,250,.3);font-size:7.5px}.queueActions{display:flex;gap:6px}.queueActions a,.queueActions button{flex:1;text-align:center;border:0;border-radius:9px;background:#D6B86A;color:#07101F;padding:7px 9px;font-size:8px;font-weight:700;text-decoration:none}.queueActions span{flex:1;color:rgba(245,247,250,.3);font-size:8px;padding:7px 9px}.recent{position:fixed;right:12px;bottom:75px;width:min(350px,calc(100vw - 24px));z-index:100;padding:8px;border-radius:17px;background:#091321;border:1px solid rgba(255,255,255,.1);box-shadow:0 25px 70px rgba(0,0,0,.5)}.recent header{display:flex;justify-content:space-between;padding:4px;color:#8FAFD6;font-size:7px;letter-spacing:.18em}.recent header button{border:0;background:none;color:#fff;font-size:17px}.recent>button{width:100%;display:grid;gap:2px;padding:8px;border:0;background:transparent;color:#fff;text-align:left;border-radius:9px}.recent>button b{font-size:9.5px}.recent>button small,.recent>p{font-size:8px;color:rgba(245,247,250,.3)}.center{min-height:70vh;align-items:center;justify-content:center;text-align:center}.center h1{margin:0;font-size:21px}.center p{margin:0;color:rgba(245,247,250,.36);font-size:9.5px}.center button{border:0;border-radius:11px;background:#D6B86A;color:#07101F;padding:8px 11px;font-weight:700}.ariaOrb{width:38px;height:38px;display:grid;place-items:center;border-radius:50%;background:radial-gradient(circle at 30% 18%,#fff,rgba(143,175,214,.8) 55%,#0b1628);color:#17334a;font-weight:800}.ariaOrb.large{width:46px;height:46px}@media(max-width:580px){.waBatchStart{align-items:stretch;flex-direction:column}.waBatchStart button{width:100%}.waSessionActions{flex-direction:column}.headTools{gap:4px}.draftBtn{padding:7px 7px}.draftQueue{right:8px;bottom:68px;width:calc(100vw - 16px);max-height:72vh}.draftItem .draftActions{flex-wrap:wrap}.draftItem .draftActions a,.draftItem .draftActions button{flex:1;text-align:center}.ariaPage{padding-left:9px;padding-right:9px}.ariaHead h1{font-size:23px}.finder input{width:145px}.stage{min-height:55vh}.prompts{grid-template-columns:1fr}.message.user>div{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}.message{max-width:94%}.next{flex-direction:column}.nextActions{display:flex}.nextActions button{width:100%}.draftActions{flex-wrap:wrap}.draftActions a,.draftActions button{flex:1;text-align:center}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}'}</style>
 </main></Layout>;
}
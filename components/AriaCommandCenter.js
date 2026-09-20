// components/AriaCommandCenter.js
import{useEffect,useMemo,useRef,useState}from'react';
import{createPortal}from'react-dom';
import{useRouter}from'next/router';
import{getClientSession,refreshClientSession}from'../lib/clientSession';

export function openAria(detail={}){
 if(typeof window==='undefined')return;
 window.dispatchEvent(new CustomEvent('nyeocare:aria-open',{detail:detail||{}}));
}

const suggestions={
 home:['What should I do next?','How does NYEOCARE work?','What changed today?','Who created NYEOCARE?'],
 people:['How do I find a person?','Who needs attention?','Explain Living Truth to me.','What should I do next?'],
 profile:['Tell me about this organization.','What can ARIA do here?','How do I add another user?','What does NYEOCARE remember?'],
 person:['What should I know about this person?','What changed recently?','Is there anything I should do?','What does ARIA remember?']
};
const contextFor=p=>p.startsWith('/person/')?'person':p.startsWith('/people')?'people':p.startsWith('/profile')?'profile':'home';
const contextLabel=k=>k==='person'?'This person':k==='people'?'People':k==='profile'?'This organization':'NYEOCARE';

export default function AriaCommandCenter(){
 const router=useRouter(),inputRef=useRef(null),scrollRef=useRef(null),mounted=useRef(true);
 const[ready,setReady]=useState(false),[open,setOpen]=useState(false),[input,setInput]=useState(''),[messages,setMessages]=useState([]),[conversationId,setConversationId]=useState(null),[personId,setPersonId]=useState(null),[sending,setSending]=useState(false),[error,setError]=useState(''),[thinking,setThinking]=useState(0);
 const kind=useMemo(()=>contextFor(router.pathname||'/'),[router.pathname]);
 const context=personId?'person':kind,contextKey=personId?'person:'+personId:'global';
 const storageKey=id=>'nyeocare:aria-conversation:v2:'+id+':'+contextKey;

 useEffect(()=>{setReady(true);return()=>{mounted.current=false}},[]);
 useEffect(()=>{
  const onOpen=e=>{const d=e?.detail||{};setPersonId(d.personId?String(d.personId):null);setOpen(true);setError('');if(typeof d.prompt==='string'&&d.prompt.trim())setInput(d.prompt.trim())};
  const onClose=()=>setOpen(false);
  const onKey=e=>{if(e.key==='Escape'&&open){setOpen(false);return}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setOpen(v=>!v)}};
  window.addEventListener('nyeocare:aria-open',onOpen);window.addEventListener('nyeocare:aria-close',onClose);window.addEventListener('keydown',onKey);
  return()=>{window.removeEventListener('nyeocare:aria-open',onOpen);window.removeEventListener('nyeocare:aria-close',onClose);window.removeEventListener('keydown',onKey)};
 },[open]);
 useEffect(()=>{
  if(!open)return;
  let dead=false;const previous=document.body.style.overflow;document.body.style.overflow='hidden';
  requestAnimationFrame(()=>inputRef.current?.focus());
  getClientSession().then(s=>{if(dead||!s)return;try{const id=localStorage.getItem(storageKey(s.user.id));if(id)setConversationId(id)}catch{}}).catch(()=>{});
  return()=>{dead=true;document.body.style.overflow=previous};
 },[open,contextKey]);
 useEffect(()=>{if(scrollRef.current)scrollRef.current.scrollTop=scrollRef.current.scrollHeight},[messages,sending]);
 useEffect(()=>{if(!sending)return;const t=window.setInterval(()=>setThinking(v=>Math.min(2,v+1)),900);return()=>window.clearInterval(t)},[sending]);

 const send=async(value)=>{
  const message=String(value??input).trim();if(!message||sending)return;
  setInput('');setError('');setSending(true);setThinking(0);setMessages(v=>[...v,{role:'user',content:message,at:Date.now()}]);
  const controller=new AbortController(),timeout=window.setTimeout(()=>controller.abort(),35000);
  try{
   let session=await getClientSession();if(!session)throw Error('Your session expired. Please sign in again.');
   const body={message,conversationId:conversationId||null};if(personId)body.personId=personId;
   let r=await fetch('/api/aria/chat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify(body),signal:controller.signal});
   if(r.status===401){session=await refreshClientSession().catch(()=>null);if(!session)throw Error('Your session expired. Please sign in again.');r=await fetch('/api/aria/chat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},body:JSON.stringify(body),signal:controller.signal})}
   const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'ARIA could not answer that right now.');
   const nextId=d.conversationId||conversationId||null;setConversationId(nextId);if(nextId){try{localStorage.setItem(storageKey(session.user.id),nextId)}catch{}}
   if(!mounted.current)return;setMessages(v=>[...v,{role:'assistant',content:d.text||'I checked what I can safely access, but I do not have a useful answer yet.',at:Date.now()}]);
  }catch(e){if(mounted.current)setError(e?.name==='AbortError'?'ARIA took too long to answer. Your data is safe; try the question again.':e?.message||'ARIA could not answer that right now.')}
  finally{window.clearTimeout(timeout);if(mounted.current){setSending(false);setThinking(0)}}
 };
 const newConversation=async()=>{setMessages([]);setConversationId(null);setError('');try{const session=await getClientSession();if(session)localStorage.removeItem(storageKey(session.user.id))}catch{}};

 if(!ready)return null;
 const list=messages.slice(-12),promptSuggestions=suggestions[context]||suggestions.home;
 return createPortal(<>
  <button type="button" className="ariaLauncher" onClick={()=>setOpen(true)} aria-label="Tell ARIA"><span className="ariaLauncherOrb">A</span><span>Tell ARIA</span><kbd>⌘K</kbd></button>
  {open&&<div className="ariaCenterOverlay" onMouseDown={e=>{if(e.target===e.currentTarget)setOpen(false)}}>
   <section className="ariaCenter" role="dialog" aria-modal="true" aria-label="Tell ARIA">
    <header className="ariaCenterHead"><div><div className="ariaCenterEyebrow"><i/>ARIA</div><h2>Tell ARIA</h2><p>Ask what to do, how NYEOCARE works, about people or your organization.</p></div><button type="button" className="ariaCenterClose" onClick={()=>setOpen(false)} aria-label="Close">×</button></header>
    <div className="ariaContext"><span>Context</span><b>{contextLabel(context)}</b>{personId&&<button type="button" onClick={newConversation}>New conversation</button>}</div>
    <div className="ariaThread" ref={scrollRef} aria-live="polite" aria-busy={sending}>
     {!list.length&&!sending?<div className="ariaWelcome"><strong>What are you trying to do?</strong><span>ARIA can explain the system, guide you through an action, or answer from information she can safely access.</span><div className="ariaSuggestions">{promptSuggestions.map(x=><button type="button" key={x} onClick={()=>send(x)}>{x}<span>›</span></button>)}</div></div>:null}
     {list.map((m,i)=><div className={'ariaBubble '+m.role} key={String(m.at)+'-'+i}><span>{m.role==='user'?'You':'ARIA'}</span><div>{m.content}</div></div>)}
     {sending&&<div className="ariaThinking"><span className="ariaThinkingOrb"><i/><i/><i/></span><div><strong>{thinking===0?'ARIA is thinking…':thinking===1?'Reviewing the available context…':'Forming the clearest answer…'}</strong><small>She will only use information she can safely access.</small></div></div>}
     {error&&<div className="ariaError" role="alert">{error}</div>}
    </div>
    <form className="ariaComposer" onSubmit={e=>{e.preventDefault();send()}}><textarea ref={inputRef} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}}} placeholder={personId?'Tell ARIA what you want to know about this person…':'Tell ARIA anything…'} rows={1} maxLength={4000} disabled={sending}/><button type="submit" disabled={!input.trim()||sending}>{sending?'…':'Send'}</button></form>
    <footer className="ariaCenterFoot">ARIA can explain and prepare; sensitive changes still require the right human action.</footer>
   </section>
  </div>}
  <style jsx global>{'.ariaLauncher{position:fixed;right:18px;bottom:calc(18px + env(safe-area-inset-bottom));z-index:1400;height:48px;padding:0 14px 0 7px;display:flex;align-items:center;gap:8px;border:1px solid rgba(143,175,214,.2);border-radius:999px;background:linear-gradient(145deg,rgba(16,27,49,.9),rgba(8,15,29,.92));backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);box-shadow:0 14px 36px rgba(0,0,0,.32),inset 0 1px 0 rgba(255,255,255,.08);color:#F5F7FA;cursor:pointer;font-size:12px;font-weight:650;touch-action:manipulation;-webkit-tap-highlight-color:transparent}.ariaLauncherOrb{width:34px;height:34px;display:grid;place-items:center;border-radius:50%;background:radial-gradient(circle at 35% 25%,rgba(255,255,255,.5),rgba(143,175,214,.2) 30%,rgba(7,13,29,.95) 75%);border:1px solid rgba(143,175,214,.28);box-shadow:inset 0 1px 4px rgba(255,255,255,.16),0 0 20px rgba(143,175,214,.12);font-size:11px}.ariaLauncher kbd{display:none}@media(min-width:760px){.ariaLauncher kbd{display:inline;font-size:9px;color:rgba(245,247,250,.3)}}.ariaCenterOverlay{position:fixed;inset:0;z-index:1500;display:flex;align-items:flex-end;justify-content:center;padding:12px;background:rgba(2,5,12,.66);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}.ariaCenter{width:min(720px,100%);height:min(720px,calc(100dvh - 24px));display:flex;flex-direction:column;overflow:hidden;border:1px solid rgba(143,175,214,.16);border-radius:28px;background:linear-gradient(145deg,rgba(13,24,45,.98),rgba(5,11,22,.99));box-shadow:0 30px 100px rgba(0,0,0,.62);color:#F5F7FA}.ariaCenterHead{display:flex;justify-content:space-between;gap:12px;padding:18px 18px 12px;border-bottom:1px solid rgba(255,255,255,.06)}.ariaCenterEyebrow{font-size:9px;letter-spacing:.18em;color:#8FAFD6;font-weight:700}.ariaCenterEyebrow i{display:inline-block;width:6px;height:6px;border-radius:50%;background:#8FAFD6;box-shadow:0 0 12px rgba(143,175,214,.6);margin-right:7px}.ariaCenterHead h2{margin:5px 0 3px;font-size:24px;letter-spacing:-.03em}.ariaCenterHead p{margin:0;max-width:560px;font-size:11.5px;line-height:1.5;color:rgba(245,247,250,.46)}.ariaCenterClose{width:38px;height:38px;flex-shrink:0;border:1px solid rgba(255,255,255,.1);border-radius:50%;background:rgba(255,255,255,.05);color:#fff;font-size:24px;cursor:pointer}.ariaContext{display:flex;align-items:center;gap:8px;padding:9px 18px;border-bottom:1px solid rgba(255,255,255,.05);font-size:10px;color:rgba(245,247,250,.42)}.ariaContext b{color:rgba(245,247,250,.72);font-weight:600}.ariaContext button{margin-left:auto;border:1px solid rgba(255,255,255,.08);border-radius:999px;background:rgba(255,255,255,.035);color:rgba(245,247,250,.58);padding:5px 9px;font-size:10px}.ariaThread{flex:1;min-height:0;overflow:auto;padding:14px 16px 8px;display:flex;flex-direction:column;gap:9px;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}.ariaWelcome{margin:auto 0;display:grid;gap:8px;text-align:center;padding:12px 4px}.ariaWelcome strong{font-size:18px}.ariaWelcome>span{max-width:530px;margin:0 auto;color:rgba(245,247,250,.46);font-size:11.5px;line-height:1.5}.ariaSuggestions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:7px}.ariaSuggestions button{display:flex;justify-content:space-between;gap:8px;text-align:left;padding:11px 12px;border:1px solid rgba(143,175,214,.1);border-radius:14px;background:rgba(143,175,214,.05);color:rgba(245,247,250,.82);font-size:11px;cursor:pointer}.ariaSuggestions button span{color:#D6B86A}.ariaBubble{max-width:86%;padding:9px 11px;border-radius:14px;font-size:12px;line-height:1.5}.ariaBubble>span{display:block;margin-bottom:3px;font-size:8px;letter-spacing:.1em;text-transform:uppercase;opacity:.38}.ariaBubble.user{align-self:flex-end;background:rgba(214,184,106,.075);border:1px solid rgba(214,184,106,.11);border-bottom-right-radius:5px}.ariaBubble.assistant{align-self:flex-start;background:rgba(143,175,214,.055);border:1px solid rgba(143,175,214,.09);border-bottom-left-radius:5px}.ariaThinking{display:flex;align-items:center;gap:9px;align-self:flex-start;padding:9px 11px;color:rgba(245,247,250,.7)}.ariaThinkingOrb{display:flex;gap:3px}.ariaThinkingOrb i{width:5px;height:5px;border-radius:50%;background:#8FAFD6;opacity:.4;animation:ariaThinkingPulse 1.15s ease-in-out infinite}.ariaThinkingOrb i:nth-child(2){animation-delay:.16s}.ariaThinkingOrb i:nth-child(3){animation-delay:.32s}.ariaThinking strong{font-size:11.5px;font-weight:600}.ariaThinking small{display:block;margin-top:2px;color:rgba(245,247,250,.32);font-size:9.5px}.ariaError{align-self:center;padding:8px 10px;border:1px solid rgba(215,123,123,.2);border-radius:10px;background:rgba(215,123,123,.06);color:#e4aaaa;font-size:10.5px}.ariaComposer{display:flex;gap:8px;align-items:flex-end;padding:10px 12px calc(10px + env(safe-area-inset-bottom));border-top:1px solid rgba(255,255,255,.06);background:rgba(4,9,18,.72)}.ariaComposer textarea{flex:1;min-height:42px;max-height:120px;resize:none;padding:11px 12px;border:1px solid rgba(255,255,255,.1);border-radius:14px;background:rgba(255,255,255,.035);outline:none;color:#fff;font-size:12px}.ariaComposer button{height:42px;padding:0 15px;border:0;border-radius:14px;background:#D6B86A;color:#07101f;font-weight:700;cursor:pointer}.ariaComposer button:disabled{opacity:.42}.ariaCenterFoot{padding:7px 14px 10px;text-align:center;color:rgba(245,247,250,.24);font-size:9px}@keyframes ariaThinkingPulse{0%,100%{opacity:.25;transform:scale(.82)}50%{opacity:.95;transform:scale(1.18)}}@media(max-width:560px){.ariaCenterOverlay{padding:0}.ariaCenter{height:100dvh;border-radius:24px 24px 0 0}.ariaSuggestions{grid-template-columns:1fr}.ariaBubble{max-width:93%}}@media(prefers-reduced-motion:reduce){.ariaThinkingOrb i{animation:none!important}}@media(prefers-reduced-transparency:reduce){.ariaLauncher,.ariaCenterOverlay{backdrop-filter:none;-webkit-backdrop-filter:none}.ariaLauncher{background:#101A31}.ariaCenterOverlay{background:rgba(2,5,12,.9)}}'}
 </style>
 </>,document.body);
}

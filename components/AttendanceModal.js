// components/AttendanceModal.js
import{useCallback,useEffect,useRef,useState}from'react';
import{createPortal}from'react-dom';
import{getClientSession}from'../lib/clientSession';
import{getCached,setCached,clearCached,publishDataChange}from'../lib/appData';
import{supabase}from'../lib/supabaseClient';import AriaProcessingStatus from'./AriaProcessingStatus';
import{getFieldSession,getFieldPeople,saveFieldSession,saveFieldPeople,setFieldCloseRequested,enqueueFieldMutation,removeFieldMutation,getFieldPendingCount,localRosterSearch,clearFieldSession,syncFieldMode}from'../lib/attendanceFieldMode';
import{measurePerformance}from'../lib/performanceTelemetry';

export default function AttendanceModal({isOpen,onClose}){
  const[session,setSession]=useState(null);
  const[background,setBackground]=useState(null);
  const[canDiscard,setCanDiscard]=useState(false);
  const[people,setPeople]=useState([]);
  const[loading,setLoading]=useState(true);
  const[saving,setSaving]=useState(false);
  const[closing,setClosing]=useState(false);
  const[error,setError]=useState('');
  const[notice,setNotice]=useState('');
  const[query,setQuery]=useState('');
  const[sessionName,setSessionName]=useState('');
  const[cursor,setCursor]=useState(null);
  const[hasMore,setHasMore]=useState(false);
  const[total,setTotal]=useState(0);
  const[present,setPresent]=useState(0);
  const[loadingMore,setLoadingMore]=useState(false);
  const mounted=useRef(false);
  const[networkOnline,setNetworkOnline]=useState(true);
  const[fieldRoster,setFieldRoster]=useState([]);
  const[fieldReady,setFieldReady]=useState(false);
  const[pendingCount,setPendingCount]=useState(0);
  const searchSeq=useRef(0);

  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);

  const read=async(response)=>{
    const raw=await response.text();
    if(!raw)return{};
    try{return JSON.parse(raw)}catch{return{error:`Request failed (${response.status}).`}};
  };

  const normalizeSession=d=>{
    if(!d?.session_id)return null;
    const status=String(d.status||'');
    if(!['active','closed'].includes(status))return null;
    return{
      ...d,
      session_id:String(d.session_id),
      name:String(d.name||'Attendance session'),
      status,
      processing_status:d.processing_status?String(d.processing_status):null,
      processing_progress:Number(d.processing_progress)||0,
      processing_processed:Number(d.processing_processed)||0,
      processing_total:Number(d.processing_total)||0,
      can_discard:d.can_discard===true
    };
  };

  const fetchPage=useCallback(async(live,q='',nextCursor=null,append=false,sessionOverride=null)=>{
    const s=sessionOverride||await getClientSession();
    if(!s)throw Error('You must be logged in.');
    const params=new URLSearchParams({
      session_id:String(live.session_id),
      limit:'80'
    });
    if(q.trim())params.set('q',q.trim());
    if(nextCursor)params.set('cursor',nextCursor);

    const response=await fetch('/api/attendance/people?'+params.toString(),{
      headers:{Authorization:`Bearer ${s.access_token}`},
      cache:'no-store'
    });
    const data=await read(response);
    if(!response.ok)throw Error(data.error||'Could not load attendance people.');

    const next=Array.isArray(data.people)?data.people:[];
    if(append){
      setPeople(current=>{
        const map=new Map(current.map(p=>[String(p.id),p]));
        next.forEach(p=>map.set(String(p.id),p));
        const merged=[...map.values()];
        const cached=getCached('attendance:'+s.user.id);
        if(cached)setCached('attendance:'+s.user.id,{...cached,people:merged});
        return merged;
      });
    }else{
      setPeople(next);
      const cached=getCached('attendance:'+s.user.id);
      if(cached)setCached('attendance:'+s.user.id,{...cached,people:next});
      else setCached('attendance:'+s.user.id,{session:{...live,user_id:s.user.id},people:next});
    }
    setTotal(Number(data.organization_total)||0);
    setPresent(Number(data.present_count)||0);
    await saveFieldPeople(live.session_id,next);
    await saveFieldSession(s.user.id,{...live,user_id:s.user.id});
    await refreshFieldPending(live.session_id);
    setCursor(data.next_cursor||null);
    setHasMore(data.has_more===true);
    return data;
  },[]);

  const load=useCallback(async({showLoading=true}={})=>{
    const seq=++searchSeq.current;
    try{
      const s=await getClientSession();
      if(!s)throw Error('You must be logged in.');

      if(showLoading&&mounted.current)setLoading(true);
      setError('');
      const cached=await hydrateFieldSession(s.user.id);
      const timing=measurePerformance('attendance_open',{network:typeof navigator==='undefined'?'unknown':navigator.onLine?'online':'offline'});

      const response=await fetch('/api/attendance/active-session',{
        headers:{Authorization:`Bearer ${s.access_token}`},
        cache:'no-store'
      });
      const data=await read(response);
      if(!response.ok)throw Error(data.error||'Could not load attendance.');

      const bg=data.background_processing||null;
      if(seq!==searchSeq.current||!mounted.current)return;
      setBackground(bg);

      if(!data.active){
        if(cached&&typeof navigator!=='undefined'&&navigator.onLine)await clearFieldSession(s.user.id,cached.sessionId);
        if(cached&&!navigator.onLine){setLoading(false);return}
        setSession(null);
        setCanDiscard(false);
        setPeople([]);
        setCursor(null);
        setHasMore(false);
        setLoading(false);
        return;
      }

      const live=normalizeSession(data);
      if(!live)throw Error('Attendance session response was incomplete.');

      setSession({...live,user_id:s.user.id});
      setCanDiscard(live.can_discard===true);

      const cached=getCached('attendance:'+s.user.id);
      if(cached?.session?.session_id===live.session_id&&Array.isArray(cached.people)){
        setPeople(cached.people);
      }

      await fetchPage(live,query,'',false,s);
      saveFieldSession(s.user.id,{...live,user_id:s.user.id}).catch(()=>{});
      if(seq===searchSeq.current&&mounted.current)setLoading(false);
      timing('ok',{cached:Boolean(cached)});
      fetch('/api/attendance/field-roster?session_id='+encodeURIComponent(live.session_id)+'&limit=5000',{headers:{Authorization:'Bearer '+s.access_token},cache:'no-store'})
        .then(async r=>{if(!r.ok)return null;return r.json()}).then(async data=>{
          if(!data?.success||!Array.isArray(data.people))return;
          let all=data.people.slice();let cursorValue=data.next_cursor||null;let pages=1;
          while(data.has_more&&cursorValue&&pages<8){
            const params=new URLSearchParams({session_id:String(live.session_id),limit:'5000',cursor:String(cursorValue)});
            const r=await fetch('/api/attendance/field-roster?'+params.toString(),{headers:{Authorization:'Bearer '+s.access_token},cache:'no-store'});
            if(!r.ok)break;const more=await r.json();if(!Array.isArray(more.people))break;
            all=all.concat(more.people);cursorValue=more.next_cursor||null;data.has_more=more.has_more===true;pages++;
          }
          if(!mounted.current)return;
          await saveFieldPeople(live.session_id,all,{replace:true});
          setFieldRoster(all);setFieldReady(all.length>0);setTotal(Number(data.total)||all.length);setPresent(Number(data.present_count)||all.filter(p=>p.marked===true).length);
          const visible=localRosterSearch(all,query,80);setPeople(visible);setCursor(null);setHasMore(false);await refreshFieldPending(live.session_id);
        }).catch(()=>{});
    }catch(e){
      console.error('[ATTENDANCE] Load error:',e);
      if(seq===searchSeq.current&&mounted.current){
        setError(String(e?.message||'Could not load attendance.'));
        setLoading(false);
      }
    }
  },[fetchPage,query]);

  useEffect(()=>{if(isOpen)load();},[isOpen,load]);

  useEffect(()=>{
    if(!isOpen)return;
    let cancelled=false;
    const timer=window.setInterval(()=>{
      if(!cancelled&&document.visibilityState==='visible')load({showLoading:false});
    },12000);
    return()=>{cancelled=true;window.clearInterval(timer)};
  },[isOpen,load]);

  useEffect(()=>{
    if(!isOpen||!session||session.status!=='active')return;
    const seq=++searchSeq.current;
    const started=typeof performance!=='undefined'?performance.now():Date.now();
    const timer=window.setTimeout(async()=>{
      try{
        if(fieldReady&&fieldRoster.length){
          const matches=localRosterSearch(fieldRoster,query,80);
          setPeople(matches);setCursor(null);setHasMore(false);setTotal(fieldRoster.length);setPresent(fieldRoster.filter(p=>p.marked===true).length);setError('');
        }else if(networkOnline){
          await fetchPage(session,query,'',false);
        }
        if(seq===searchSeq.current&&mounted.current)measurePerformance('attendance_search',{mode:fieldReady?'local':'server'} )('ok',{duration_ms:Math.round((typeof performance!=='undefined'?performance.now():Date.now())-started)});
      }catch(e){if(seq===searchSeq.current&&mounted.current)setError(e.message||'Could not search people.')}
    },fieldReady?0:220);
    return()=>window.clearTimeout(timer);
  },[isOpen,session?.session_id,session?.status,query,fetchPage,fieldReady,fieldRoster,networkOnline]);

  useEffect(()=>{
    if(!isOpen)return;
    let channel=null;
    let timer=null;
    let stopped=false;
    const refresh=()=>{
      if(stopped||timer)return;
      timer=window.setTimeout(()=>{timer=null;if(!stopped)load({showLoading:false})},250);
    };
    getClientSession().then(s=>{
      if(!s||stopped)return;
      channel=supabase.channel('attendance-live-'+String(s.user.id))
        .on('postgres_changes',{event:'*',schema:'public',table:'sessions'},refresh)
        .on('postgres_changes',{event:'*',schema:'public',table:'attendance_records'},refresh)
        .subscribe();
    }).catch(()=>{});
    return()=>{
      stopped=true;
      if(timer)window.clearTimeout(timer);
      if(channel)supabase.removeChannel(channel);
    };
  },[isOpen,load]);

  const createSession=async()=>{
    const name=sessionName.trim();
    if(!name)return;
    setSaving(true);setError('');setNotice('');
    try{
      const s=await getClientSession();
      if(!s)throw Error('You must be logged in.');
      const response=await fetch('/api/attendance/create-session',{
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          Authorization:`Bearer ${s.access_token}`
        },
        body:JSON.stringify({name})
      });
      const data=await read(response);
      if(!response.ok||!data.success)throw Error(data.error||'Could not start attendance.');

      const live=normalizeSession({
        ...data.session,
        session_id:data.session?.id,
        processing_status:data.session?.aria_processing_status||'idle',
        can_discard:data.can_discard===true
      });
      if(!live)throw Error('Attendance session response was incomplete.');

      const next={...live,user_id:s.user.id};
      setSession(next);
      setBackground(null);
      setSessionName('');
      setCursor(null);
      setHasMore(false);
      setLoading(true);
      await fetchPage(next,'','',false,s);
      setLoading(false);
      publishDataChange('attendance');
    }catch(e){
      console.error('[ATTENDANCE] Create error:',e);
      if(mounted.current)setError(e.message||'Could not start attendance.');
    }finally{
      if(mounted.current)setSaving(false);
    }
  };

  const mark=async(id,isMarked)=>{
    if(!session||session.status!=='active'||closing)return;
    const previous=people,nextValue=!isMarked,perf=measurePerformance('attendance_mark',{network:networkOnline?'online':'offline'});
    setPeople(current=>current.map(p=>String(p.id)===String(id)?{...p,marked:nextValue,marked_by_name:nextValue?'You':null}:p));
    setFieldRoster(current=>current.map(p=>String(p.id)===String(id)?{...p,marked:nextValue,marked_by_name:nextValue?'You':null}:p));
    setPresent(value=>Math.max(0,value+(nextValue?1:-1)));setError('');
    const cachedPerson=fieldRoster.find(p=>String(p.id)===String(id));
    if(cachedPerson)saveFieldPeople(session.session_id,[{...cachedPerson,marked:nextValue,marked_by_name:nextValue?'You':null}]).catch(()=>{});
    if(!networkOnline){
      await enqueueFieldMutation({sessionId:session.session_id,personId:id,present:nextValue});await refreshFieldPending(session.session_id);setNotice('Saved on this device. It will sync automatically when the connection returns.');perf('queued');return;
    }
    try{
      let s=await getClientSession();if(!s)throw Error('You must be logged in.');
      let response=await fetch('/api/attendance/mark',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+s.access_token},body:JSON.stringify({session_id:session.session_id,people_id:id,present:nextValue})});
      if(response.status===401){s=await getClientSession({forceRefresh:true}).catch(()=>null);if(s)response=await fetch('/api/attendance/mark',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+s.access_token},body:JSON.stringify({session_id:session.session_id,people_id:id,present:nextValue})})}
      const data=await read(response);if(!response.ok||!data.success)throw Object.assign(Error(data.error||'Could not update attendance.'),{transient:response.status>=500||response.status===0});
      const actual=data.present===true;
      if(actual!==nextValue){setPresent(value=>Math.max(0,value+(actual?1:-1)));setFieldRoster(current=>current.map(p=>String(p.id)===String(id)?{...p,marked:actual}:p));setPeople(current=>current.map(p=>String(p.id)===String(id)?{...p,marked:actual}:p))}
      await removeFieldMutation(session.session_id,id);await refreshFieldPending(session.session_id);setNotice('');perf('ok');
    }catch(e){
      const transient=e?.transient||e instanceof TypeError||typeof navigator!=='undefined'&&!navigator.onLine;
      if(transient){await enqueueFieldMutation({sessionId:session.session_id,personId:id,present:nextValue});await refreshFieldPending(session.session_id);setNotice('Saved on this device. Syncing automatically when the connection returns.');perf('queued');return}
      setPeople(previous);setFieldRoster(current=>current.map(p=>String(p.id)===String(id)?{...p,marked:isMarked}:p));setPresent(value=>Math.max(0,value+(nextValue?-1:1)));setError(e.message||'Could not update attendance.');perf('error');
    }
  };

  const loadMore=async()=>{
    if(!session||!hasMore||!cursor||loadingMore)return;
    setLoadingMore(true);setError('');if(fieldReady){setLoadingMore(false);return}
    try{await fetchPage(session,query,cursor,true)}
    catch(e){setError(e.message||'Could not load more people.')}
    finally{if(mounted.current)setLoadingMore(false)}
  };

  const keep=async()=>{
    if(!session||session.status!=='active'||closing)return;
    const perf=measurePerformance('attendance_save',{network:networkOnline?'online':'offline'});setClosing(true);setError('');
    try{
      const s=networkOnline?await getClientSession():null;
      if(!networkOnline){await saveFieldSession(session.user_id||s?.user?.id,session,{closeRequested:true});setNotice('Attendance saved on this device. It will finish syncing automatically when the connection returns.');setClosing(false);perf('queued');onClose();return}
      const response=await fetch('/api/attendance/close-session',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+s.access_token},body:JSON.stringify({session_id:session.session_id})});
      const data=await read(response);if(!response.ok||!data.success)throw Object.assign(Error(data.error||'Attendance could not be saved yet.'),{transient:response.status>=500||response.status===0});
      await clearFieldSession(s.user.id,session.session_id);clearCached('attendance:'+s.user.id);publishDataChange('attendance');perf('ok');onClose();
    }catch(e){
      const transient=e?.transient||e instanceof TypeError||typeof navigator!=='undefined'&&!navigator.onLine;
      if(transient){await saveFieldSession(session.user_id||((await getClientSession().catch(()=>null))?.user?.id),session,{closeRequested:true}).catch(()=>{});setNotice('Attendance saved on this device. It will finish syncing automatically when the connection returns.');perf('queued');onClose()}
      else if(mounted.current)setError(e.message||'Attendance could not be saved yet.');
    }finally{if(mounted.current)setClosing(false)}
  };

  const discard=async()=>{
    if(!session||closing)return;
    if(!window.confirm('Discard this attendance session?\n\nAll marks in this live session will be permanently removed.'))return;
    setClosing(true);setError('');
    try{
      const s=await getClientSession();
      if(!s)throw Error('You must be logged in.');
      const response=await fetch('/api/attendance/leave-session',{
        method:'POST',
        headers:{'Content-Type':'application/json',Authorization:`Bearer ${s.access_token}`},
        body:JSON.stringify({session_id:session.session_id})
      });
      const data=await read(response);
      if(!response.ok||!data.success)throw Error(data.error||'Could not discard this session.');
      clearCached('attendance:'+s.user.id);
      setSession(null);setPeople([]);setNotice('Attendance session discarded.');
      publishDataChange('attendance');
    }catch(e){
      console.error('[ATTENDANCE] Discard error:',e);
      if(mounted.current)setError(e.message||'Could not discard this session.');
    }finally{
      if(mounted.current)setClosing(false);
    }
  };

  if(!isOpen||typeof document==='undefined')return null;

  const percent=total?Math.round((present/total)*100):0;
  const backgroundLabel=background
    ? background.progress>=100?'ARIA updated'
      : background.processing_status==='needs_attention'?'ARIA needs attention'
      :'ARIA is updating'
    : null;

  const content=<div style={overlay} onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <div style={modal} role="dialog" aria-modal="true" aria-label="Attendance">
      <header style={header}>
        <div>
          <div style={eyebrow}>{session?'LIVE ATTENDANCE':'ATTENDANCE'}</div>
          <h2 style={h2}>{session?.name||'Attendance'}</h2>
          <p style={sub}>
            {session
              ? 'Mark people as you see them. Your changes are saved immediately.'
              : background
                ? `${backgroundLabel}. You can start the next attendance now.`
                : 'Create a session to begin taking attendance.'}
          </p>
        </div>
        <button style={close} onClick={onClose} aria-label="Close attendance">×</button>
      </header>

      {background&&!session&&<div style={backgroundBox}><AriaProcessingStatus kind="attendance" status={background.processing_status||'processing'} stage={background.aria_processing_stage||background.stage||''} progress={background.progress||0} processed={background.processed||0} total={background.total||0}/><span style={backgroundHint}>{backgroundLabel==='ARIA updated'?'The last session is fully understood.':background.processing_status==='needs_attention'?'Attendance is saved. ARIA is waiting for a human decision.':'Attendance is saved. You can start the next session while ARIA finishes this one.'}</span></div>}

      {background&&session&&<div style={backgroundInline}><AriaProcessingStatus kind="attendance" compact status={background.processing_status||'processing'} stage={background.aria_processing_stage||background.stage||''} progress={background.progress||0}/></div>}

      {notice&&<div style={noticeBox}>{notice}</div>}
      {error&&<div style={errorBox}>{error}</div>}

      {loading?<div style={loadingBox}>Preparing attendance…</div>
      :!session?<div style={createBox}>
        <div style={plus}>＋</div>
        <strong style={{fontSize:20}}>Start attendance</strong>
        <span style={sub}>ARIA works independently after you save. It never holds the next session hostage.</span>
        <input
          style={input}
          value={sessionName}
          onChange={e=>setSessionName(e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter'&&!saving)createSession()}}
          placeholder="Session name"
          maxLength={120}
          autoFocus
        />
        <button
          style={{...primary,opacity:saving||!sessionName.trim()?0.55:1}}
          disabled={saving||!sessionName.trim()}
          onClick={createSession}
        >
          {saving?'Starting…':'Start attendance'}
        </button>
      </div>
      :<div style={main}>
        <div style={stats}>
          <div><strong style={big}>{present}</strong><span style={label}>present</span></div>
          <div style={divider}/>
          <div><strong style={stat}>{total}</strong><span style={label}>people</span></div>
          <div><strong style={stat}>{percent}%</strong><span style={label}>marked</span></div>
          <div style={progress}><i style={{width:`${percent}%`}}/></div>
        </div>

        <div style={toolbar}>
          <input
            style={search}
            value={query}
            onChange={e=>setQuery(e.target.value)}
            placeholder="Search people…"
            aria-label="Search people"
          />
          {query&&<button style={clear} onClick={()=>setQuery('')} aria-label="Clear search">×</button>}
        </div>

        <div style={peopleBox}>
          {people.map(p=>
            <div style={personRow} key={p.id}>
              <div style={personInfo}>
                <div style={{...avatar,...(p.marked?presentAvatar:{})}}>
                  {(p.first_name||'?').charAt(0).toUpperCase()}
                </div>
                <div>
                  <strong>{p.first_name} {p.last_name||''}</strong>
                  {p.marked&&<small>{'Present'+(p.marked_by_name?' · '+p.marked_by_name:'')}</small>}
                </div>
              </div>
              <button
                style={{...markButton,...(p.marked?doneButton:{})}}
                disabled={closing}
                onClick={()=>mark(p.id,Boolean(p.marked))}
              >
                {p.marked?'✓ Present':'Mark present'}
              </button>
            </div>
          )}

          {!people.length&&<div style={empty}>
            <strong>{query?'No people found':'No active people yet'}</strong>
            <span>{query?'Try another name or phone number.':'Add people before taking attendance.'}</span>
          </div>}

          {hasMore&&<button style={loadMoreButton} disabled={loadingMore} onClick={loadMore}>
            {loadingMore?'Loading…':'Load more people'}
          </button>}
        </div>

        <footer style={footer}>
          <div style={live}><i/>Live attendance <span style={fieldState}>{networkOnline?(pendingCount?('Syncing '+pendingCount+' change'+(pendingCount===1?'':'s'):'Online'):('Offline'+(pendingCount?' · '+pendingCount+' pending':''))}</span></div>
          <div style={footerActions}>
            {canDiscard&&<button style={discardButton} disabled={closing} onClick={discard}>Discard</button>}
            <button style={keepButton} disabled={closing||loading} onClick={keep}>
              {closing?'Saving…':'Save attendance'}
            </button>
          </div>
        </footer>
      </div>}
    </div>
  </div>;

  return createPortal(content,document.body);
}

const overlay={
  position:'fixed',inset:0,zIndex:2147483000,
  background:'rgba(2,5,12,.72)',backdropFilter:'blur(18px)',
  display:'flex',alignItems:'center',justifyContent:'center',
  padding:12,overflow:'auto'
};
const modal={
  width:'min(1120px,94vw)',height:'min(88vh,820px)',minHeight:470,
  background:'linear-gradient(145deg,rgba(43,60,83,.97),rgba(10,18,33,.99))',
  border:'1px solid rgba(235,244,255,.18)',borderRadius:30,overflow:'hidden',
  display:'flex',flexDirection:'column',color:'#f5f7fb',
  boxShadow:'0 35px 110px rgba(0,0,0,.7)'
};
const header={display:'flex',justifyContent:'space-between',gap:14,padding:'18px 22px 14px',borderBottom:'1px solid rgba(255,255,255,.08)',flexShrink:0};
const eyebrow={fontSize:9,fontWeight:700,letterSpacing:2.2,color:'rgba(255,255,255,.4)',marginBottom:5};
const h2={margin:0,fontSize:'clamp(24px,3vw,34px)',lineHeight:1.02};
const sub={margin:'5px 0 0',color:'rgba(255,255,255,.46)',fontSize:12,lineHeight:1.45};
const close={width:38,height:38,borderRadius:'50%',border:'1px solid rgba(255,255,255,.13)',background:'rgba(255,255,255,.08)',color:'#fff',fontSize:25,cursor:'pointer',flexShrink:0};
const main={display:'flex',flexDirection:'column',flex:1,minHeight:0};
const backgroundBox={margin:'10px 18px 0',padding:'12px 14px',borderRadius:16,border:'1px solid rgba(214,184,106,.2)',background:'rgba(214,184,106,.055)',display:'grid',gap:8};
const backgroundInline={display:'flex',justifyContent:'space-between',padding:'8px 18px',borderBottom:'1px solid rgba(255,255,255,.06)',color:'rgba(255,255,255,.55)',fontSize:11};
const miniProgress={height:4,borderRadius:99,background:'rgba(255,255,255,.08)',overflow:'hidden'};
const miniProgressFill={height:'100%',background:'#d6b86a',borderRadius:99};
const backgroundText={display:'flex',justifyContent:'space-between',fontSize:12};
const noticeBox={margin:'8px 18px 0',padding:'10px 12px',borderRadius:12,background:'rgba(255,255,255,.055)',border:'1px solid rgba(255,255,255,.1)',color:'rgba(255,255,255,.82)',fontSize:13};
const backgroundHint={display:'block',padding:'2px 2px 0',fontSize:10,color:'rgba(255,255,255,.42)',lineHeight:1.4};const errorBox={margin:'8px 18px 0',padding:'10px 12px',borderRadius:12,background:'rgba(239,68,68,.08)',border:'1px solid rgba(239,68,68,.18)',color:'#ffb8b8',fontSize:13};
const loadingBox={flex:1,display:'grid',placeItems:'center',color:'rgba(255,255,255,.5)'};
const createBox={flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:14,padding:30,textAlign:'center'};
const plus={width:52,height:52,borderRadius:'50%',display:'grid',placeItems:'center',background:'rgba(255,255,255,.08)',fontSize:26};
const input={width:'min(440px,100%)',padding:'13px 15px',borderRadius:13,border:'1px solid rgba(255,255,255,.12)',background:'rgba(0,0,0,.2)',color:'#fff',outline:0,fontSize:15};
const primary={padding:'12px 20px',border:0,borderRadius:999,background:'#fff',color:'#08101e',fontWeight:700,cursor:'pointer'};
const stats={display:'flex',alignItems:'center',gap:14,padding:'12px 20px',borderBottom:'1px solid rgba(255,255,255,.06)',flexShrink:0};
const big={fontSize:28};
const stat={fontSize:20};
const label={display:'block',fontSize:10,color:'rgba(255,255,255,.4)'};
const divider={width:1,height:29,background:'rgba(255,255,255,.1)'};
const progress={flex:1,height:4,background:'rgba(255,255,255,.1)',borderRadius:99,overflow:'hidden'};
const toolbar={padding:'8px 18px',flexShrink:0};
const search={width:'100%',padding:'10px 14px',borderRadius:12,border:'1px solid rgba(255,255,255,.1)',background:'rgba(0,0,0,.16)',color:'#fff',outline:0,fontSize:14};
const clear={position:'absolute',right:31,marginTop:7,border:0,background:'none',color:'#fff',fontSize:20};
const peopleBox={flex:1,overflow:'auto',padding:'0 18px'};
const empty={minHeight:160,display:'grid',placeItems:'center',alignContent:'center',gap:6,color:'rgba(255,255,255,.5)',textAlign:'center'};
const personRow={display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,padding:'8px 0',borderBottom:'1px solid rgba(255,255,255,.05)'};
const personInfo={display:'flex',alignItems:'center',gap:10,minWidth:0};
const avatar={width:36,height:36,borderRadius:'50%',background:'rgba(255,255,255,.08)',display:'grid',placeItems:'center',flexShrink:0,fontWeight:700,fontSize:14};
const presentAvatar={background:'rgba(74,222,128,.12)'};
const markButton={padding:'7px 11px',borderRadius:999,border:'1px solid rgba(255,255,255,.11)',background:'rgba(255,255,255,.045)',color:'#fff',cursor:'pointer',whiteSpace:'nowrap',fontSize:13};
const doneButton={background:'rgba(74,222,128,.09)',borderColor:'rgba(74,222,128,.2)'};
const loadMoreButton={display:'block',margin:'12px auto 16px',padding:'9px 15px',borderRadius:999,border:'1px solid rgba(255,255,255,.11)',background:'rgba(255,255,255,.045)',color:'#fff',cursor:'pointer',fontSize:12};
const footer={display:'flex',alignItems:'center',justifyContent:'space-between',gap:10,padding:'10px 18px',borderTop:'1px solid rgba(255,255,255,.07)',flexShrink:0};
const live={fontSize:12,color:'rgba(255,255,255,.45)',display:'flex',alignItems:'center',gap:7};
const footerActions={display:'flex',gap:8};
const fieldState={fontSize:9,color:'rgba(214,184,106,.75)',marginLeft:4};
const discardButton={padding:'8px 14px',borderRadius:999,border:'1px solid rgba(255,255,255,.12)',background:'transparent',color:'#fff',cursor:'pointer',fontSize:13};
const keepButton={padding:'9px 16px',border:0,borderRadius:999,background:'#fff',color:'#08101e',fontWeight:700,cursor:'pointer',fontSize:13};

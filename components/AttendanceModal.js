// components/AttendanceModal.js
import{useCallback,useEffect,useRef,useState}from'react';
import{createPortal}from'react-dom';
import{getClientSession}from'../lib/clientSession';
import{getCached,setCached,clearCached,publishDataChange}from'../lib/appData';
import{supabase}from'../lib/supabaseClient';import AriaProcessingStatus from'./AriaProcessingStatus';
import{getFieldSession,getFieldPeople,isFieldRosterSnapshotComplete,saveFieldSession,saveFieldPeople,enqueueFieldMutation,removeFieldMutation,getFieldPendingCount,getPendingFieldMutations,getUnattributedPendingFieldMutationCount,removeFieldPerson,localRosterSearch,clearFieldSession,syncFieldMode}from'../lib/attendanceFieldMode';
import{measurePerformance}from'../lib/performanceTelemetry';

const FAST_SYNC_FALLBACK_MS=2500;
const SLOW_SYNC_FALLBACK_MS=5000;
const ACTIVE_SESSION_DISCOVERY_INTERVAL_MS=5000;
const ATTENDANCE_REQUEST_TIMEOUT_MS=12000;
const ATTENDANCE_LOAD_TIMEOUT_MS=5000;
const ATTENDANCE_AUTH_TIMEOUT_MS=5000;
const ATTENDANCE_LOCAL_READ_TIMEOUT_MS=350;
async function fetchAttendanceWithTimeout(url,options={},timeoutMs=ATTENDANCE_REQUEST_TIMEOUT_MS){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    return await fetch(url,{...options,signal:controller.signal});
  }catch(error){
    if(controller.signal.aborted){
      const timeout=new Error('Attendance request timed out.');
      timeout.name='TimeoutError';
      timeout.transient=true;
      throw timeout;
    }
    throw error;
  }finally{
    clearTimeout(timer);
  }
}

function withAttendanceDeadline(promise,ms,message){
  let timer;
  return Promise.race([Promise.resolve(promise),new Promise((_,reject)=>{timer=setTimeout(()=>{const error=new Error(message);error.name='TimeoutError';error.transient=true;reject(error)},ms)})]).finally(()=>clearTimeout(timer));
}
function withAttendanceFallback(promise,ms,fallback){
  let timer;
  return Promise.race([Promise.resolve(promise),new Promise(resolve=>{timer=setTimeout(()=>resolve(fallback),ms)})]).finally(()=>clearTimeout(timer));
}
const attendanceSearchKey=(sessionId,q)=>String(sessionId)+':'+String(q||'').trim();
function createVisitorRequestId(){
  try{
    if(typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function')return crypto.randomUUID();
  }catch{}
  const part=()=>Math.random().toString(36).slice(2,12);
  return 'visitor_'+Date.now().toString(36)+'_'+part()+'_'+part();
}

export default function AttendanceModal({isOpen,onClose}){
  const[session,setSession]=useState(null);
  const[background,setBackground]=useState(null);
  const[canDiscard,setCanDiscard]=useState(false);
  const[canStartSession,setCanStartSession]=useState(false);
  const[people,setPeople]=useState([]);
  const[loading,setLoading]=useState(true);
  const[saving,setSaving]=useState(false);
  const[closing,setClosing]=useState(false);
  const[error,setError]=useState('');
  const[notice,setNotice]=useState('');
  const[query,setQuery]=useState('');
  const[sessionName,setSessionName]=useState('');
  const[absenceMeaningful,setAbsenceMeaningful]=useState(false);
  const[showFinishConfirm,setShowFinishConfirm]=useState(false);
  const[showAddVisitor,setShowAddVisitor]=useState(false);
  const[visitorName,setVisitorName]=useState('');
  const[visitorPhone,setVisitorPhone]=useState('');
  const[visitorContactConsent,setVisitorContactConsent]=useState(false);
  const[addingVisitor,setAddingVisitor]=useState(false);const[visitorIdentityReview,setVisitorIdentityReview]=useState(null);
  const[cursor,setCursor]=useState(null);
  const[hasMore,setHasMore]=useState(false);
  const[total,setTotal]=useState(0);
  const[present,setPresent]=useState(0);
  const[loadingMore,setLoadingMore]=useState(false);
  const[welcomeSavingIds,setWelcomeSavingIds]=useState([]);
  const mounted=useRef(false);
  const[networkOnline,setNetworkOnline]=useState(true);
  const[fieldRoster,setFieldRoster]=useState([]);
  const[fieldReady,setFieldReady]=useState(false);
  const[rosterSnapshotComplete,setRosterSnapshotComplete]=useState(false);
  const[pendingCount,setPendingCount]=useState(0);
  const[legacyPendingCount,setLegacyPendingCount]=useState(0);
  const loadSeq=useRef(0);
  const searchSeq=useRef(0);
  const lastSearchKey=useRef('');
  const markingIds=useRef(new Set());
  const visitorRequestId=useRef('');
  const fieldWarmAt=useRef(0);
  const fieldCursor=useRef({sessionId:'',cursor:''});
  const fieldSnapshotSessionId=useRef('');
  const fieldRosterRef=useRef([]);
  const fieldRosterLoadSeq=useRef(0);
  const fieldRosterEpoch=useRef(0);
  const fieldRosterWarmInProgress=useRef(false);
  const queryRef=useRef(query);
  const fieldPolling=useRef(false);
  const realtimeConnected=useRef(false);
  const onCloseRef=useRef(onClose);
  useEffect(()=>{onCloseRef.current=onClose},[onClose]);
  useEffect(()=>{fieldRosterRef.current=fieldRoster},[fieldRoster]);
  useEffect(()=>{queryRef.current=query},[query]);
  useEffect(()=>{
    const sessionId=String(session?.session_id||'');
    if(fieldCursor.current.sessionId!==sessionId){
      fieldCursor.current={sessionId,cursor:''};
      fieldRosterLoadSeq.current++;
      fieldRosterEpoch.current++;
      fieldSnapshotSessionId.current='';
      fieldWarmAt.current=0;
    }
    if(!sessionId){fieldRosterRef.current=[];setRosterSnapshotComplete(false);}
  },[session?.session_id]);

  const refreshFieldPending=useCallback(async(sessionId)=>{
    try{
      const auth=await getClientSession().catch(()=>null),userId=String(auth?.user?.id||'');
      setPendingCount(await getFieldPendingCount(sessionId,userId));
      setLegacyPendingCount(await getUnattributedPendingFieldMutationCount());
    }catch{setPendingCount(0);setLegacyPendingCount(0)}
  },[]);

  const hydrateFieldSession=useCallback(async(userId)=>{
    try{
      const cached=await getFieldSession(userId);
      if(!cached)return null;
      let cachedPeopleRaw=await getFieldPeople(cached.sessionId,userId);
      const rosterComplete=await isFieldRosterSnapshotComplete(cached.sessionId,userId).catch(()=>false);
      // The account-keyed app cache is retained for legacy/offline continuity,
      // but it is not proof that all roster pages were stored.
      if(!cachedPeopleRaw.length&&!rosterComplete){
        const accountCache=getCached('attendance:'+String(userId));
        if(String(accountCache?.session?.session_id||'')===String(cached.sessionId)&&Array.isArray(accountCache.people)){
          cachedPeopleRaw=accountCache.people;
        }
      }
      const pendingMutations=await getPendingFieldMutations(cached.sessionId,userId).catch(()=>[]);
      const pendingByPerson=new Map(pendingMutations.map(item=>[String(item.personId),item]));
      const cachedPeople=cachedPeopleRaw.map(person=>{
        const pending=pendingByPerson.get(String(person.id));
        return pending?{...person,marked:pending.present,marked_by_name:pending.present?'You':null}:person;
      });
      return {...cached,people:cachedPeople,rosterComplete};
    }catch{return null}
  },[]);

  const applyCachedRoster=useCallback((cached,{offlineFallback=false}={})=>{
    const roster=Array.isArray(cached?.people)?cached.people:[];
    setPeople(roster.slice(0,80));
    setTotal(roster.length);
    setPresent(roster.filter(person=>person.marked===true).length);
    setFieldRoster(roster);
    setFieldReady(roster.length>0);
    setRosterSnapshotComplete(offlineFallback&&cached?.rosterComplete===true);
    setCanDiscard(cached?.session?.can_discard===true);
    setCursor(null);setHasMore(false);
    void refreshFieldPending(cached?.sessionId).catch(()=>{});
  },[refreshFieldPending]);

  useEffect(()=>{
    const update=()=>setNetworkOnline(typeof navigator==='undefined'?true:navigator.onLine);
    update();
    window.addEventListener('online',update);
    window.addEventListener('offline',update);
    return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update)}
  },[]);

  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
  useEffect(()=>{if(!isOpen)setShowFinishConfirm(false)},[isOpen]);

  useEffect(()=>{
    if(!isOpen)return;
    let cancelled=false;
    getUnattributedPendingFieldMutationCount()
      .then(count=>{if(!cancelled)setLegacyPendingCount(count)})
      .catch(()=>{if(!cancelled)setLegacyPendingCount(0)});
    return()=>{cancelled=true};
  },[isOpen]);

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

  const primeFieldCursor=useCallback(async(live,auth)=>{
    const sessionId=String(live?.session_id||'');
    if(fieldCursor.current.sessionId!==sessionId)fieldRosterLoadSeq.current++;
    // Re-priming gives the next delta sequence a new server cursor. Invalidate
    // the previous full snapshot first so stale cached rows cannot receive deltas
    // from a cursor that was established after changes to those rows.
    fieldRosterEpoch.current++;
    fieldSnapshotSessionId.current='';
    setFieldReady(false);
    fieldCursor.current={sessionId,cursor:''};
    if(!sessionId||!auth?.access_token)return;
    try{
      const response=await fetchAttendanceWithTimeout('/api/attendance/field-changes?session_id='+encodeURIComponent(sessionId),{
        headers:{Authorization:'Bearer '+auth.access_token},cache:'no-store'
      },ATTENDANCE_LOAD_TIMEOUT_MS);
      const data=await response.json().catch(()=>({}));
      if(response.ok&&data.success===true&&data.cursor){
        fieldCursor.current={sessionId,cursor:String(data.cursor)};
      }
    }catch{}
  },[]);

  const warmFieldRoster=useCallback(async(live,auth)=>{
    const sessionId=String(live?.session_id||'');
    if(!sessionId||!auth?.access_token||fieldRosterWarmInProgress.current)return false;
    fieldRosterWarmInProgress.current=true;
    setRosterSnapshotComplete(false);
    const snapshotEpoch=++fieldRosterEpoch.current;
    const rosterRequestSeq=++fieldRosterLoadSeq.current;
    // Require a new complete snapshot before accepting another incremental
    // delta sequence; a failed refresh must not leave a fresh cursor paired
    // with an older roster snapshot.
    fieldSnapshotSessionId.current='';
    try{
      const params=new URLSearchParams({session_id:sessionId,limit:'5000'});
      const response=await fetchAttendanceWithTimeout('/api/attendance/field-roster?'+params.toString(),{
        headers:{Authorization:'Bearer '+auth.access_token},cache:'no-store'
      },ATTENDANCE_REQUEST_TIMEOUT_MS);
      if(!response.ok)return false;
      let data=await response.json();
      if(!data?.success||!Array.isArray(data.people))return false;
      let all=data.people.slice();
      let cursorValue=data.next_cursor||null;
      let pages=1;
      while(data.has_more&&cursorValue&&pages<8){
        const pageParams=new URLSearchParams({session_id:sessionId,limit:'5000',cursor:String(cursorValue)});
        const pageResponse=await fetchAttendanceWithTimeout('/api/attendance/field-roster?'+pageParams.toString(),{
          headers:{Authorization:'Bearer '+auth.access_token},cache:'no-store'
        },ATTENDANCE_REQUEST_TIMEOUT_MS);
        if(!pageResponse.ok)break;
        const page=await pageResponse.json().catch(()=>null);
        if(!Array.isArray(page?.people))break;
        all=all.concat(page.people);
        cursorValue=page.next_cursor||null;
        data.has_more=page.has_more===true;
        pages++;
      }
      // A capped or interrupted page walk, or a count changing during pagination,
      // is not a complete roster. Retry instead of treating a partial snapshot as
      // authoritative for cross-device deltas.
      const declaredTotal=Number(data.total);
      if(data.has_more===true||!Number.isInteger(declaredTotal)||declaredTotal<0||declaredTotal!==all.length)return false;
      const pending=await getPendingFieldMutations(sessionId,auth.user?.id).catch(()=>[]);
      if(rosterRequestSeq!==fieldRosterLoadSeq.current||snapshotEpoch!==fieldRosterEpoch.current||fieldCursor.current.sessionId!==sessionId)return false;
      const pendingByPerson=new Map(pending.map(item=>[String(item.personId),item]));
      all=all.map(person=>{
        const mutation=pendingByPerson.get(String(person.id));
        return mutation?{...person,marked:mutation.present,marked_by_name:mutation.present?'You':null}:person;
      });
      await saveFieldPeople(sessionId,auth.user?.id,all,{replace:true}).catch(()=>{});
      if(!mounted.current||rosterRequestSeq!==fieldRosterLoadSeq.current||snapshotEpoch!==fieldRosterEpoch.current||fieldCursor.current.sessionId!==sessionId)return false;
      fieldRosterRef.current=all;
      fieldSnapshotSessionId.current=sessionId;
      setFieldRoster(all);
      setRosterSnapshotComplete(true);
      setFieldReady(all.length>0);
      setTotal(Number(data.total)||all.length);
      setPresent(all.filter(person=>person.marked===true).length);
      const visible=localRosterSearch(all,queryRef.current,80);
      setPeople(visible);
      setCursor(null);setHasMore(false);
      fieldWarmAt.current=Date.now();
      void refreshFieldPending(sessionId);
      return true;
    }catch(error){
      console.warn('[ATTENDANCE] Canonical roster refresh deferred:',error?.message||error);
      return false;
    }finally{
      fieldRosterWarmInProgress.current=false;
    }
  },[refreshFieldPending]);

  const pollFieldChanges=useCallback(async()=>{
    const sessionId=String(session?.session_id||'');
    if(!isOpen||session?.status!=='active'||!sessionId||!networkOnline||fieldPolling.current||fieldRosterWarmInProgress.current)return;
    fieldPolling.current=true;
    const pollEpoch=fieldRosterEpoch.current;
    try{
      const auth=await getClientSession().catch(()=>null);
      if(!auth?.access_token)return;
      // Incremental changes must never be applied to an incomplete roster. A
      // successful empty snapshot is valid too, which matters for new churches.
      if(fieldSnapshotSessionId.current!==sessionId){
        const currentCursor=fieldCursor.current;
        if(currentCursor.sessionId!==sessionId||!currentCursor.cursor){
          await primeFieldCursor({session_id:sessionId},auth);
        }
        await warmFieldRoster({session_id:sessionId},auth);
        return;
      }
      const currentCursor=fieldCursor.current;
      if(currentCursor.sessionId!==sessionId||!currentCursor.cursor){
        await primeFieldCursor({session_id:sessionId},auth);
        await warmFieldRoster({session_id:sessionId},auth);
        return;
      }
      const params=new URLSearchParams({session_id:sessionId,since:currentCursor.cursor});
      const response=await fetchAttendanceWithTimeout('/api/attendance/field-changes?'+params.toString(),{
        headers:{Authorization:'Bearer '+auth.access_token},cache:'no-store'
      },ATTENDANCE_LOAD_TIMEOUT_MS);
      const data=await response.json().catch(()=>({}));
      if(!response.ok||data.success!==true||!data.cursor){
        if(response.status===409&&typeof window!=='undefined')window.dispatchEvent(new CustomEvent('nyeocare:attendance-session-stale',{detail:{sessionId}}));
        return;
      }
      if(fieldCursor.current.sessionId!==sessionId||pollEpoch!==fieldRosterEpoch.current||fieldRosterWarmInProgress.current)return;
      if(fieldSnapshotSessionId.current!==sessionId)return;

      const pending=await getPendingFieldMutations(sessionId,auth.user?.id).catch(()=>[]);
      // A canonical roster snapshot may have started while this poll was reading
      // local outbox state. Never advance/apply an older poll after that snapshot.
      if(fieldCursor.current.sessionId!==sessionId||pollEpoch!==fieldRosterEpoch.current||fieldRosterWarmInProgress.current)return;
      fieldCursor.current={sessionId,cursor:String(data.cursor)};
      const pendingByPerson=new Map(pending.map(item=>[String(item.personId),item]));
      const map=new Map((fieldRosterRef.current||[]).map(person=>[String(person.id),person]));
      const persist=new Map();

      for(const incoming of Array.isArray(data.people)?data.people:[]){
        const id=String(incoming?.id||'');
        if(!id)continue;
        const prior=map.get(id);
        const next=prior
          ? {...prior,...incoming,marked:prior.marked===true,marked_by_name:prior.marked_by_name||null}
          : {...incoming,marked:false,marked_by_name:null};
        map.set(id,next);
        // Persist edits as well as new rows. Otherwise another phone can show
        // the new name online but resurrect an old name after an offline reopen.
        persist.set(id,next);
      }

      for(const record of Array.isArray(data.attendance)?data.attendance:[]){
        const id=String(record?.people_id||''),prior=map.get(id);
        if(!id||!prior||markingIds.current.has(id))continue;
        const mutation=pendingByPerson.get(id);
        const marked=mutation?mutation.present:record.present===true;
        const next={...prior,marked,marked_by_name:mutation?(mutation.present?'You':null):(record.present===true?(record.marked_by_name||null):null)};
        map.set(id,next);
        persist.set(id,next);
      }

      const removedIds=new Set((Array.isArray(data.removed_people)?data.removed_people:[]).map(person=>String(person?.id||'')).filter(Boolean));
      for(const id of removedIds){
        map.delete(id);
        persist.delete(id);
        void removeFieldPerson(sessionId,auth.user?.id,id).catch(()=>{});
      }

      for(const mutation of pending){
        const id=String(mutation.personId),prior=map.get(id);
        if(!prior)continue;
        const next={...prior,marked:mutation.present,marked_by_name:mutation.present?'You':null};
        map.set(id,next);
        persist.set(id,next);
      }

      const nextRoster=[...map.values()].sort((a,b)=>
        String(a.display_name||((a.first_name||'')+' '+(a.last_name||''))).localeCompare(
          String(b.display_name||((b.first_name||'')+' '+(b.last_name||'')))
        )
      );
      fieldRosterRef.current=nextRoster;
      setFieldRoster(nextRoster);
      setPeople(localRosterSearch(nextRoster,queryRef.current,80));
      setTotal(nextRoster.length);
      setPresent(nextRoster.filter(person=>person.marked===true).length);
      if(nextRoster.length)setFieldReady(true);
      if(persist.size)void saveFieldPeople(sessionId,auth.user?.id,[...persist.values()]).catch(()=>{});
      void refreshFieldPending(sessionId);
    }catch(error){
      // A failed poll is non-destructive. Realtime and the next poll can recover it.
      console.warn('[ATTENDANCE] Shared attendance refresh deferred:',error?.message||error);
    }finally{
      fieldPolling.current=false;
    }
  },[isOpen,session?.session_id,session?.status,networkOnline,primeFieldCursor,warmFieldRoster,refreshFieldPending]);

  const fetchPage=useCallback(async(live,q='',nextCursor=null,append=false,sessionOverride=null)=>{
    const s=sessionOverride||await getClientSession();
    if(!s)throw Error('You must be logged in.');
    const params=new URLSearchParams({
      session_id:String(live.session_id),
      limit:'80'
    });
    if(q.trim())params.set('q',q.trim());
    if(nextCursor)params.set('cursor',nextCursor);

    const response=await fetchAttendanceWithTimeout('/api/attendance/people?'+params.toString(),{
      headers:{Authorization:`Bearer ${s.access_token}`},
      cache:'no-store'
    },ATTENDANCE_LOAD_TIMEOUT_MS);
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
    void saveFieldPeople(live.session_id,s.user.id,next).catch(()=>{});
    void saveFieldSession(s.user.id,{...live,user_id:s.user.id}).catch(()=>{});
    void refreshFieldPending(live.session_id).catch(()=>{});
    setCursor(data.next_cursor||null);
    setHasMore(data.has_more===true);
    return data;
  },[]);

  const load=useCallback(async({showLoading=true,forceSnapshot=false}={})=>{
    const seq=++loadSeq.current;
    const currentQuery=queryRef.current;
    let fieldCached=null,confirmedSessionId=null,sessionUserId=null;
    if(showLoading&&mounted.current){setLoading(true);setError('');setNotice('');}
    try{
      const s=await withAttendanceDeadline(getClientSession(),ATTENDANCE_AUTH_TIMEOUT_MS,'Your sign-in session took too long to load. Check your connection and try again.');
      sessionUserId=String(s?.user?.id||'');
      if(!s)throw Error('You must be logged in.');

      const offline=typeof navigator!=='undefined'&&!navigator.onLine;
      fieldCached=await withAttendanceFallback(hydrateFieldSession(s.user.id),offline?1200:ATTENDANCE_LOCAL_READ_TIMEOUT_MS,null);
      const timing=measurePerformance('attendance_open',{network:typeof navigator==='undefined'?'unknown':navigator.onLine?'online':'offline'});

      if(offline){
        if(fieldCached&&fieldCached.session?.status==='active'){
          setSession({...fieldCached.session,user_id:s.user.id});
          applyCachedRoster(fieldCached,{offlineFallback:true});
          setBackground(null);
          setError('');
          setNotice('Offline mode is active. Your local attendance session is ready and will sync automatically when the connection returns.');
          if(seq===loadSeq.current&&mounted.current)setLoading(false);
          timing('offline-cached');
          return;
        }
        setSession(null);setPeople([]);setFieldRoster([]);setFieldReady(false);setPendingCount(0);setCanDiscard(false);setCursor(null);setHasMore(false);
        setError('No saved attendance session is available on this device. Reconnect before starting attendance.');
        if(seq===loadSeq.current&&mounted.current)setLoading(false);
        timing('offline-no-session');
        return;
      }

      const response=await fetchAttendanceWithTimeout('/api/attendance/active-session',{
        headers:{Authorization:`Bearer ${s.access_token}`},
        cache:'no-store'
      },ATTENDANCE_LOAD_TIMEOUT_MS);
      const data=await read(response);
      if(!response.ok)throw Error(data.error||'Could not load attendance.');

      const bg=data.background_processing||null;
      if(seq!==loadSeq.current||!mounted.current)return;
      setBackground(bg);

      if(!data.active){
        setCanStartSession(data.can_start_new_session===true);
        if(fieldCached&&typeof navigator!=='undefined'&&navigator.onLine){
          await syncFieldMode().catch(()=>false);
          const pending=await getFieldPendingCount(fieldCached.sessionId,s.user.id).catch(()=>1);
          const refreshed=await getFieldSession(s.user.id).catch(()=>null);
          const serverConfirmsClosed=(
            String(data.last_closed_session_id||'')===String(fieldCached.sessionId)
            ||String(data.session_id||'')===String(fieldCached.sessionId)&&data.status==='closed'
          );
          if(pending>0||(refreshed?.closeRequested&&!serverConfirmsClosed)){
            setSession({...fieldCached.session,status:serverConfirmsClosed?'closed':'active',user_id:s.user.id});
            applyCachedRoster(fieldCached);
            setCanDiscard(!serverConfirmsClosed&&fieldCached.session?.can_discard===true);
            setNotice(serverConfirmsClosed
              ? 'Attendance has already been saved. Unsent marks are still on this phone and need an owner or admin to verify them through ARIA; nothing was deleted.'
              : pending>0?'Saved attendance still has marks waiting to sync. NYEOCARE is preserving them on this device.':'Attendance close is still being reconciled; the saved session remains on this device.');
            setLoading(false);return;
          }
          await clearFieldSession(s.user.id,fieldCached.sessionId).catch(()=>{});
        }
        if(fieldCached&&!navigator.onLine){setLoading(false);return}
        setSession(null);
        setFieldRoster([]);setFieldReady(false);setPendingCount(0);
        setCanDiscard(false);
        setPeople([]);
        setCursor(null);
        setHasMore(false);
        setLoading(false);
        return;
      }

      setCanStartSession(false);
      const live=normalizeSession(data);
      if(!live)throw Error('Attendance session response was incomplete.');
      if(data.joined!==true){
        const joinResponse=await fetchAttendanceWithTimeout('/api/attendance/join-session',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+s.access_token},body:JSON.stringify({session_id:live.session_id})});
        const joined=await read(joinResponse);
        if(!joinResponse.ok||joined.success!==true)throw Error(joined.error||'Could not join this attendance session. Ask an owner or admin to add you.');
      }
      await primeFieldCursor(live,s);
      confirmedSessionId=String(live.session_id);
      lastSearchKey.current=attendanceSearchKey(live.session_id,currentQuery);

      if(fieldCached&&String(fieldCached.sessionId)!==String(live.session_id)){
        await syncFieldMode().catch(()=>false);
        const oldPending=await getFieldPendingCount(fieldCached.sessionId,s.user.id).catch(()=>1);
        if(oldPending>0){
          const oldSessionClosed=String(data.last_closed_session_id||'')===String(fieldCached.sessionId);
          setSession({...fieldCached.session,status:oldSessionClosed?'closed':'active',user_id:s.user.id});
          applyCachedRoster(fieldCached);
          setCanDiscard(!oldSessionClosed&&fieldCached.session?.can_discard===true);
          lastSearchKey.current=attendanceSearchKey(fieldCached.sessionId,currentQuery);
          setNotice(oldSessionClosed
            ? 'The previous attendance has already been saved. Unsent marks are still on this phone and need an owner or admin to verify them through ARIA; nothing was deleted.'
            : 'Your previous attendance session still has unsynced marks. NYEOCARE is preserving them on this device while synchronization retries.');
          setError('');
          setLoading(false);
          return;
        }
        await clearFieldSession(s.user.id,fieldCached.sessionId).catch(()=>{});
        fieldCached=null;
        setPeople([]);setFieldRoster([]);setFieldReady(false);setPendingCount(0);fieldWarmAt.current=0;
      }

      setSession({...live,user_id:s.user.id});
      setCanDiscard(live.can_discard===true);

      const cached=getCached('attendance:'+s.user.id);
      if(fieldCached&&String(fieldCached.sessionId)===String(live.session_id)&&Array.isArray(fieldCached.people)){
        applyCachedRoster(fieldCached);
        if(fieldCached.people.length)setLoading(false);
      }else if(cached?.session?.session_id===live.session_id&&Array.isArray(cached.people)){
        setPeople(cached.people);
        if(cached.people.length)setLoading(false);
      }

      await fetchPage(live,currentQuery,'',false,s);
      saveFieldSession(s.user.id,{...live,user_id:s.user.id}).catch(()=>{});
      if(seq===loadSeq.current&&mounted.current)setLoading(false);
      timing('ok',{cached:Boolean(cached),field_cached:Boolean(fieldCached)});
      // Reopen forces a canonical refresh because updates may have happened while
      // this modal was closed. Internal background refreshes can reuse a fresh
      // snapshot instead of repeatedly loading thousands of rows.
      if(fieldCached&&fieldWarmAt.current&&Date.now()-fieldWarmAt.current<300000&&!forceSnapshot)return;
      void warmFieldRoster(live,s).catch(()=>{});
    }catch(e){
      console.error('[ATTENDANCE] Load error:',e);
      if(seq===loadSeq.current&&mounted.current){
        setLoading(false);
        if(fieldCached?.session?.status==='active'&&(!confirmedSessionId||confirmedSessionId===String(fieldCached.sessionId))){
          const recoveredPeople=Array.isArray(fieldCached.people)?fieldCached.people:[];
          if(!confirmedSessionId)setSession({...fieldCached.session,user_id:sessionUserId});
          setCanDiscard(fieldCached.session?.can_discard===true);
          setPeople(recoveredPeople.slice(0,80));
          setFieldRoster(recoveredPeople);
          setFieldReady(recoveredPeople.length>0);
          setTotal(recoveredPeople.length);
          setPresent(recoveredPeople.filter(person=>person.marked===true).length);
          setCursor(null);setHasMore(false);
          void refreshFieldPending(fieldCached.sessionId).catch(()=>{});
          if(recoveredPeople.length){
            setNotice('The server could not confirm this session. Showing saved attendance from this device; new marks remain queued until sync is confirmed.');
            setError('');
          }else{
            setNotice('');
            setError('The session is saved, but its roster is not available on this device. Reconnect to load attendance safely.');
          }
        }else{
          setError(String(e?.message||'Could not load attendance.'));
        }
        setLoading(false);
      }
    }finally{
      if(seq===loadSeq.current&&mounted.current)setLoading(false);
    }
  },[fetchPage,hydrateFieldSession,applyCachedRoster,primeFieldCursor,warmFieldRoster]);

  useEffect(()=>{if(isOpen)load({forceSnapshot:true});},[isOpen,load]);

  useEffect(()=>{
    if(!isOpen||session?.session_id)return;
    let cancelled=false;
    const poll=()=>{if(!cancelled&&document.visibilityState==='visible')void load({showLoading:false})};
    const timer=window.setInterval(poll,ACTIVE_SESSION_DISCOVERY_INTERVAL_MS);
    return()=>{cancelled=true;window.clearInterval(timer)};
  },[isOpen,session?.session_id,load]);



  const refreshSessionState=useCallback(async()=>{
    if(!isOpen||!session?.session_id)return;
    try{
      const s=await getClientSession();if(!s)return;
      const response=await fetchAttendanceWithTimeout('/api/attendance/active-session',{headers:{Authorization:`Bearer ${s.access_token}`},cache:'no-store'});
      const data=await read(response);if(!response.ok)return;
      if(!data.active||String(data.session_id)!==String(session.session_id)){
        await syncFieldMode().catch(()=>false);
        const pending=await getFieldPendingCount(session.session_id,s.user.id).catch(()=>1);
        const serverClosed=String(data.last_closed_session_id||'')===String(session.session_id)
          ||String(data.session_id||'')===String(session.session_id)&&data.status==='closed';
        if(pending>0){
          setPendingCount(pending);
          setSession(current=>current?{...current,status:serverClosed?'closed':'active'}:current);
          if(serverClosed)setCanDiscard(false);
          setNotice(serverClosed
            ? 'This attendance has already been saved. Some offline marks still need to sync or be checked by an owner or admin; no saved marks have been discarded.'
            : 'This session is no longer active on the server, but unsynced attendance is still saved on this device. NYEOCARE is preserving it while synchronization retries.');
          setError('');
          return;
        }
        const cached=await getFieldSession(s.user.id).catch(()=>null);
        const closedConfirmed=!data.active&&String(data.session_id||'')===String(session.session_id)&&data.status==='closed';
        if(cached?.closeRequested&&!closedConfirmed){
          setNotice('Attendance finalization is still being confirmed. Your local session is preserved.');
          return;
        }
        await clearFieldSession(s.user.id,session.session_id).catch(()=>{});
        clearCached('attendance:'+s.user.id);
        setSession(null);setPeople([]);setFieldRoster([]);setFieldReady(false);setPendingCount(0);setCanDiscard(false);fieldWarmAt.current=0;
        publishDataChange('attendance');onCloseRef.current?.();return;
      }
      const live=normalizeSession(data);if(!live)return;
      setSession(current=>current?{...current,...live,user_id:s.user.id}:current);
      setCanDiscard(live.can_discard===true);
      setBackground(data.background_processing||null);
      await refreshFieldPending(live.session_id);
    }catch{}
  },[isOpen,session?.session_id,refreshFieldPending]);

  useEffect(()=>{
    if(!isOpen)return;
    const onStale=e=>{
      if(String(e?.detail?.sessionId||'')!==String(session?.session_id||''))return;
      void refreshSessionState();
    };
    window.addEventListener('nyeocare:attendance-session-stale',onStale);
    return()=>window.removeEventListener('nyeocare:attendance-session-stale',onStale);
  },[isOpen,session?.session_id,refreshSessionState]);

  useEffect(()=>{
    if(!isOpen)return;
    const onSync=e=>{
      if(!session?.session_id)return;
      refreshFieldPending(session.session_id).catch(()=>{});
      const kind=e?.detail?.kind,detail=e?.detail||{};
      if(kind==='conflict'&&String(detail.sessionId||'')===String(session.session_id)){
        setNotice(detail.needsAdminVerification===true?'Attendance has already been saved. These offline marks are still stored on this phone. Ask an owner or admin to verify them and correct the saved attendance through ARIA. Nothing was deleted.':'Some offline attendance marks conflict with a confirmed record or a person no longer in the active directory. Those changes remain saved on this device and were not discarded. Please reconcile them with an owner or admin.');
      }else if(kind==='sync'&&String(detail.sessionId||'')===String(session.session_id)&&Number(detail.needsAdminConfirmationCount)>0){
        setNotice('Some attendance marks arrived after this session closed. They are saved but need an owner or admin to confirm them before ARIA can rely on them.');
      }
      if(kind==='sync'||kind==='clear')refreshSessionState().catch(()=>{});
    };
    window.addEventListener('nyeocare:field-sync',onSync);
    return()=>window.removeEventListener('nyeocare:field-sync',onSync)
  },[isOpen,session?.session_id,refreshFieldPending,refreshSessionState]);

  useEffect(()=>{
    if(!isOpen)return;
    let cancelled=false;
    const timer=window.setInterval(()=>{
      if(!cancelled&&document.visibilityState==='visible')refreshSessionState();
    },30000);
    return()=>{cancelled=true;window.clearInterval(timer)};
  },[isOpen,refreshSessionState]);

  useEffect(()=>{
    if(!isOpen||!session||session.status!=='active')return;
    const key=attendanceSearchKey(session.session_id,query);
    if(lastSearchKey.current===key)return;
    const seq=++searchSeq.current;
    const started=typeof performance!=='undefined'?performance.now():Date.now();
    const timer=window.setTimeout(async()=>{
      try{
        if(fieldReady&&fieldRoster.length&&(!networkOnline||rosterSnapshotComplete)){
          const matches=localRosterSearch(fieldRoster,query,80);
          setPeople(matches);setCursor(null);setHasMore(false);setTotal(fieldRoster.length);setPresent(fieldRoster.filter(p=>p.marked===true).length);setError('');
        }else if(networkOnline){
          await fetchPage(session,query,'',false);
        }
        if(seq===searchSeq.current&&mounted.current){lastSearchKey.current=key;measurePerformance('attendance_search',{mode:fieldReady?'local':'server'} )('ok',{duration_ms:Math.round((typeof performance!=='undefined'?performance.now():Date.now())-started)})}
      }catch(e){if(seq===searchSeq.current&&mounted.current)setError(e.message||'Could not search people.')}
    },fieldReady?0:220);
    return()=>window.clearTimeout(timer);
  },[isOpen,session?.session_id,session?.status,query,fetchPage,fieldReady,fieldRoster,networkOnline,rosterSnapshotComplete]);

  useEffect(()=>{
    if(!isOpen||session?.status!=='active'||!session?.session_id)return;
    let stopped=false,timer=null;
    const run=()=>{
      if(!stopped&&document.visibilityState==='visible')void pollFieldChanges();
    };
    const schedule=()=>{
      if(stopped)return;
      if(timer)window.clearTimeout(timer);
      const delay=realtimeConnected.current?SLOW_SYNC_FALLBACK_MS:FAST_SYNC_FALLBACK_MS;
      timer=window.setTimeout(async()=>{
        if(!stopped&&document.visibilityState==='visible')await pollFieldChanges();
        schedule();
      },delay);
    };
    const onVisible=()=>{if(document.visibilityState==='visible'){run();schedule()}};
    run();
    schedule();
    window.addEventListener('online',run);
    document.addEventListener('visibilitychange',onVisible);
    return()=>{
      stopped=true;
      if(timer)window.clearTimeout(timer);
      window.removeEventListener('online',run);
      document.removeEventListener('visibilitychange',onVisible);
    };
  },[isOpen,session?.session_id,session?.status,pollFieldChanges]);

  useEffect(()=>{
    if(!isOpen||!session?.session_id)return;
    let channel=null,stopped=false;
    const applyAttendanceRow=(row,deleted=false)=>{
      if(!row||String(row.session_id)!==String(session.session_id)||!row.people_id)return;
      const personId=String(row.people_id);
      void getPendingFieldMutations(session.session_id,session.user_id).then(pendingRows=>{
        const mutation=(pendingRows||[]).find(item=>String(item.personId)===personId);
        const nextMarked=mutation?mutation.present:(!deleted&&row.present===true);
        setFieldRoster(current=>{
          const prev=current.find(p=>String(p.id)===personId);
          if(!prev||Boolean(prev.marked)===nextMarked)return current;
          const markedByName=mutation?(mutation.present?'You':null):(nextMarked?(prev.marked_by_name||null):null);
          const nextPerson={...prev,marked:nextMarked,marked_by_name:markedByName};
          const next=current.map(p=>String(p.id)===personId?nextPerson:p);
          setPresent(v=>Math.max(0,v+(nextMarked?1:-1)));
          void saveFieldPeople(session.session_id,session.user_id,[nextPerson]).catch(()=>{});
          return next;
        });
        setPeople(current=>current.map(p=>{
          if(String(p.id)!==personId)return p;
          const markedByName=mutation?(mutation.present?'You':null):(nextMarked?(p.marked_by_name||''):null);
          return {...p,marked:nextMarked,marked_by_name:markedByName};
        }));
      }).catch(()=>{});
    };
    realtimeConnected.current=false;
    const runFallbackSync=()=>{if(!stopped&&document.visibilityState==='visible')void pollFieldChanges()};
    getClientSession().then(s=>{
      if(!s||stopped)return;
      const sessionId=String(session.session_id);
      channel=supabase.channel('attendance-live-'+sessionId+'-'+String(s.user.id))
        .on('postgres_changes',{event:'*',schema:'public',table:'sessions',filter:'id=eq.'+sessionId},()=>refreshSessionState())
        .on('postgres_changes',{event:'INSERT',schema:'public',table:'attendance_records',filter:'session_id=eq.'+sessionId},payload=>applyAttendanceRow(payload.new,false))
        .on('postgres_changes',{event:'UPDATE',schema:'public',table:'attendance_records',filter:'session_id=eq.'+sessionId},payload=>applyAttendanceRow(payload.new,false))
        .on('postgres_changes',{event:'DELETE',schema:'public',table:'attendance_records',filter:'session_id=eq.'+sessionId},payload=>applyAttendanceRow(payload.old,true))
        .subscribe(status=>{
          realtimeConnected.current=status==='SUBSCRIBED';
          if(stopped)return;
          if(status==='SUBSCRIBED'){
            // Reconcile the canonical state immediately after the socket is live.
            void refreshSessionState();
            void pollFieldChanges();
          }else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED'){
            // Keep the fast server-backed fallback when Realtime is unavailable.
            runFallbackSync();
          }
        });
    }).catch(()=>{realtimeConnected.current=false});
    return()=>{stopped=true;realtimeConnected.current=false;if(channel)supabase.removeChannel(channel)};
  },[isOpen,session?.session_id,refreshSessionState,pollFieldChanges]);

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
        body:JSON.stringify({name,absence_meaningful:absenceMeaningful===true})
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
      lastSearchKey.current=attendanceSearchKey(next.session_id,'');
      setQuery('');
      setSession(next);
      setFieldRoster([]);setFieldReady(false);setPendingCount(0);fieldWarmAt.current=0;
      setBackground(null);
      setSessionName('');
      setAbsenceMeaningful(false);
      setShowFinishConfirm(false);
      setCursor(null);
      setHasMore(false);
      setLoading(true);
      await primeFieldCursor(next,s);
      await fetchPage(next,'','',false,s);
      void warmFieldRoster(next,s).catch(()=>{});
      setLoading(false);
      publishDataChange('attendance');
    }catch(e){
      console.error('[ATTENDANCE] Create error:',e);
      if(mounted.current)setError(e.message||'Could not start attendance.');
    }finally{
      if(mounted.current)setSaving(false);
    }
  };

  const addVisitor=async(identityReview=null)=>{
    if(!session||session.status!=='active'||!networkOnline||addingVisitor)return;
    const fullName=visitorName.trim(),rawPhone=visitorPhone.trim();
    if(!fullName){setError('Enter the visitor’s name first.');return}
    if(rawPhone&&!visitorContactConsent){setError('Ask permission before saving a phone number for church follow-up.');return}
    const requestId=visitorRequestId.current||createVisitorRequestId();
    visitorRequestId.current=requestId;
    setAddingVisitor(true);setError('');setNotice('');
    try{
      let auth=await getClientSession();if(!auth)throw Error('You must be logged in.');
      let response=await fetchAttendanceWithTimeout('/api/attendance/add-visitor',{
        method:'POST',
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.access_token},
        body:JSON.stringify({session_id:session.session_id,request_id:requestId,full_name:fullName,phone:rawPhone||null,contact_consent:visitorContactConsent,...(identityReview?{identity_review:identityReview}:{})})
      });
      if(response.status===401){
        auth=await getClientSession({forceRefresh:true}).catch(()=>null);
        if(auth)response=await fetchAttendanceWithTimeout('/api/attendance/add-visitor',{
          method:'POST',
          headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.access_token},
          body:JSON.stringify({session_id:session.session_id,request_id:requestId,full_name:fullName,phone:rawPhone||null,contact_consent:visitorContactConsent,...(identityReview?{identity_review:identityReview}:{})})
        });
      }
      const data=await read(response);
      if(!response.ok&&response.status===409&&['PERSON_IDENTITY_REVIEW_REQUIRED','PERSON_IDENTITY_REVIEW_STALE','DUPLICATE_IDENTITY_NOT_DISTINCT','PERSON_IDENTITY_REVIEW_IN_PROGRESS'].includes(data.code)){
        setVisitorIdentityReview({code:data.code,message:data.error||'Review possible matches before saving.',candidates:Array.isArray(data.candidates)?data.candidates:[]});
        return;
      }
      if(!response.ok||data.success!==true||!data.person)throw Error(data.error||'Could not add this visitor.');
      if(data.person.status!=='active'){
        visitorRequestId.current='';setVisitorName('');setVisitorPhone('');setVisitorContactConsent(false);setVisitorIdentityReview(null);setShowAddVisitor(false);
        setNotice('This visitor request was already processed, but the record is now inactive or archived. No duplicate was created. Ask an owner or admin to review the directory.');
        return;
      }
      const wasAlreadyInRoster=people.some(p=>String(p.id)===String(data.person.id))||fieldRoster.some(p=>String(p.id)===String(data.person.id))||fieldRosterRef.current.some(p=>String(p.id)===String(data.person.id));
      const person={...data.person,marked:false,marked_by_name:null,first_visit_candidate:data.person.first_visit_candidate===true,first_visit_welcome_recorded:data.person.first_visit_welcome_recorded===true};
      setPeople(current=>{
        if(query.trim()&&!localRosterSearch([person],query,1).length)return current;
        const next=[...current.filter(p=>String(p.id)!==String(person.id)),person];
        next.sort((a,b)=>String(a.display_name||((a.first_name||'')+' '+(a.last_name||''))).localeCompare(String(b.display_name||((b.first_name||'')+' '+(b.last_name||'')))));
        return next.slice(0,80);
      });
      if(fieldSnapshotSessionId.current===String(session.session_id)){
        const next=[...fieldRosterRef.current.filter(p=>String(p.id)!==String(person.id)),person];
        next.sort((a,b)=>String(a.display_name||((a.first_name||'')+' '+(a.last_name||''))).localeCompare(String(b.display_name||((b.first_name||'')+' '+(b.last_name||'')))));
        fieldRosterRef.current=next;
        setFieldRoster(next);
        setFieldReady(true);
        void saveFieldPeople(session.session_id,session.user_id,[person]).catch(()=>{});
      }else{
        // Keep the visible first page responsive, but do not treat a one-person
        // partial roster as canonical. The full snapshot will include this new row.
        void warmFieldRoster({session_id:session.session_id},auth).catch(()=>{});
      }
      setTotal(value=>value+(wasAlreadyInRoster?0:1));
      visitorRequestId.current='';setVisitorName('');setVisitorPhone('');setVisitorContactConsent(false);setShowAddVisitor(false);
      setVisitorIdentityReview(null);setNotice(data.identity_review_confirmed?'Visitor added after identity review. ARIA’s decision was recorded. No message was sent.':'Visitor added to this organization. No message was sent.');
      publishDataChange('attendance');
    }catch(e){
      if(mounted.current)setError(e.message||'Could not add this visitor.');
    }finally{
      if(mounted.current)setAddingVisitor(false);
    }
  };

  const mark=async(id,isMarked)=>{
    if(!session||session.status!=='active'||closing)return;
    const markKey=String(id);
    if(markingIds.current.has(markKey))return;
    markingIds.current.add(markKey);
    const nextValue=!isMarked,perf=measurePerformance('attendance_mark',{network:networkOnline?'online':'offline'});
    setPeople(current=>current.map(p=>String(p.id)===String(id)?{...p,marked:nextValue,marked_by_name:nextValue?'You':null}:p));
    setFieldRoster(current=>current.map(p=>String(p.id)===String(id)?{...p,marked:nextValue,marked_by_name:nextValue?'You':null}:p));
    setPresent(value=>Math.max(0,value+(nextValue?1:-1)));setError('');
    const cachedPerson=fieldRoster.find(p=>String(p.id)===String(id));
    if(cachedPerson)saveFieldPeople(session.session_id,session.user_id,[{...cachedPerson,marked:nextValue,marked_by_name:nextValue?'You':null}]).catch(()=>{});
    if(!networkOnline){
      try{
        await enqueueFieldMutation({sessionId:session.session_id,userId:session.user_id,personId:id,present:nextValue});
        await refreshFieldPending(session.session_id);
        setNotice('Saved on this device. It will sync automatically when the connection returns.');perf('queued');
      }catch(queueError){
        setPeople(current=>current.map(p=>String(p.id)===String(id)?{...p,marked:isMarked,marked_by_name:isMarked?(p.marked_by_name||'You'):null}:p));
        setFieldRoster(current=>current.map(p=>String(p.id)===String(id)?{...p,marked:isMarked,marked_by_name:isMarked?(p.marked_by_name||'You'):null}:p));
        setPresent(value=>Math.max(0,value+(nextValue?-1:1)));
        setError('This change could not be saved on this device. Reconnect before continuing.');perf('error');
      }finally{markingIds.current.delete(markKey)}
      return;
    }
    try{
      let s=await getClientSession();if(!s)throw Error('You must be logged in.');
      let response=await fetchAttendanceWithTimeout('/api/attendance/mark',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+s.access_token},body:JSON.stringify({session_id:session.session_id,people_id:id,present:nextValue})});
      if(response.status===401){s=await getClientSession({forceRefresh:true}).catch(()=>null);if(s)response=await fetchAttendanceWithTimeout('/api/attendance/mark',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+s.access_token},body:JSON.stringify({session_id:session.session_id,people_id:id,present:nextValue})})}
      const data=await read(response);if(!response.ok||!data.success)throw Object.assign(Error(data.error||'Could not update attendance.'),{transient:response.status>=500||response.status===0});
      const actual=data.present===true;
      if(actual!==nextValue){setPresent(value=>Math.max(0,value+(actual?1:-1)));setFieldRoster(current=>current.map(p=>String(p.id)===String(id)?{...p,marked:actual}:p));setPeople(current=>current.map(p=>String(p.id)===String(id)?{...p,marked:actual}:p))}
      await removeFieldMutation(session.session_id,session.user_id,id);await refreshFieldPending(session.session_id);setNotice('');perf('ok');
    }catch(e){
      const transient=e?.transient||e instanceof TypeError||typeof navigator!=='undefined'&&!navigator.onLine;
      if(transient){
        try{
          await enqueueFieldMutation({sessionId:session.session_id,userId:session.user_id,personId:id,present:nextValue});
          await refreshFieldPending(session.session_id);
          setNotice('Saved on this device. Syncing automatically when the connection returns.');perf('queued');return;
        }catch(queueError){
          setPeople(current=>current.map(p=>String(p.id)===String(id)?{...p,marked:isMarked,marked_by_name:isMarked?(p.marked_by_name||'You'):null}:p));
          setFieldRoster(current=>current.map(p=>String(p.id)===String(id)?{...p,marked:isMarked,marked_by_name:isMarked?(p.marked_by_name||'You'):null}:p));
          setPresent(value=>Math.max(0,value+(nextValue?-1:1)));
          setError('The server could not confirm this change and this device could not save it. Reconnect before continuing.');perf('error');return;
        }
      }
      setPeople(current=>current.map(p=>String(p.id)===String(id)?{...p,marked:isMarked,marked_by_name:isMarked?(p.marked_by_name||'You'):null}:p));
      setFieldRoster(current=>current.map(p=>String(p.id)===String(id)?{...p,marked:isMarked,marked_by_name:isMarked?(p.marked_by_name||'You'):null}:p));
      setPresent(value=>Math.max(0,value+(nextValue?-1:1)));setError(e.message||'Could not update attendance.');perf('error');
    }finally{markingIds.current.delete(markKey)}
  };

  const loadMore=async()=>{
    if(!session||!hasMore||!cursor||loadingMore)return;
    setLoadingMore(true);setError('');if(fieldReady&&rosterSnapshotComplete){setLoadingMore(false);return}
    try{await fetchPage(session,query,cursor,true)}
    catch(e){setError(e.message||'Could not load more people.')}
    finally{if(mounted.current)setLoadingMore(false)}
  };

  const recordFirstVisitWelcome=async(person)=>{
    if(!session||session.status!=='active'||closing||!person?.first_visit_candidate||!person?.marked||person?.first_visit_welcome_recorded)return;
    if(!networkOnline||pendingCount>0){
      setNotice('Welcome them warmly in person now. Once attendance finishes syncing, record the welcome here; nothing has been recorded yet.');
      return;
    }
    const personId=String(person.id);
    if(welcomeSavingIds.includes(personId))return;
    setWelcomeSavingIds(current=>[...current,personId]);
    setError('');
    try{
      const auth=await getClientSession();
      if(!auth)throw Error('Your sign-in session expired. Reopen attendance before recording this welcome.');
      const response=await fetchAttendanceWithTimeout('/api/attendance/first-visit-welcome',{
        method:'POST',
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.access_token},
        body:JSON.stringify({session_id:session.session_id,people_id:personId})
      },ATTENDANCE_REQUEST_TIMEOUT_MS);
      const data=await read(response);
      if(!response.ok||!data.success)throw Error(data.error||'The welcome could not be recorded.');
      const updated={...person,first_visit_welcome_recorded:true};
      setPeople(current=>current.map(p=>String(p.id)===personId?{...p,first_visit_welcome_recorded:true}:p));
      setFieldRoster(current=>current.map(p=>String(p.id)===personId?{...p,first_visit_welcome_recorded:true}:p));
      await saveFieldPeople(session.session_id,session.user_id,[updated]).catch(()=>{});
      setNotice(data.already_recorded?'This welcome was already saved.':'Welcome recorded. ARIA will keep this as the first-visit outcome for this session, so it will not create a duplicate follow-up.');
      publishDataChange('attendance');
    }catch(e){
      if(mounted.current)setError(e.message||'The welcome could not be recorded safely.');
    }finally{
      if(mounted.current)setWelcomeSavingIds(current=>current.filter(id=>id!==personId));
    }
  };

  const keep=async()=>{
    if(!session||session.status!=='active'||closing)return;
    setShowFinishConfirm(false);
    const perf=measurePerformance('attendance_save',{network:networkOnline?'online':'offline'});
    setClosing(true);setError('');
    try{
      const s=networkOnline?await getClientSession():null;
      if(!networkOnline){
        await saveFieldSession(session.user_id||s?.user?.id,session,{closeRequested:true});
        setNotice('Your confirmation is saved on this device. Attendance will finish syncing when the connection returns; the shared session remains available until the server saves it.');
        setClosing(false);perf('queued');onClose();return;
      }
      if(pendingCount>0||legacyPendingCount>0){
        throw Error('Some attendance changes are still syncing. Wait for them to finish before saving attendance.');
      }
      const response=await fetchAttendanceWithTimeout('/api/attendance/close-session',{
        method:'POST',
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+s.access_token},
        body:JSON.stringify({session_id:session.session_id})
      });
      const data=await read(response);
      if(!response.ok||!data.success)throw Object.assign(Error(data.error||'Attendance could not be saved yet.'),{transient:response.status>=500||response.status===0});
      await clearFieldSession(s.user.id,session.session_id);
      clearCached('attendance:'+s.user.id);
      publishDataChange('attendance');perf('ok');onClose();
    }catch(e){
      const transient=e?.transient||e instanceof TypeError||typeof navigator!=='undefined'&&!navigator.onLine;
      if(transient){
        await saveFieldSession(session.user_id||((await getClientSession().catch(()=>null))?.user?.id),session,{closeRequested:true}).catch(()=>{});
        setNotice('Your confirmation is saved on this device. It will finish syncing automatically when the connection returns.');
        perf('queued');onClose();
      }else if(mounted.current)setError(e.message||'Attendance could not be saved yet.');
    }finally{if(mounted.current)setClosing(false)}
  };

  const discard=async()=>{
    if(!session||closing)return;
    if(!networkOnline){setNotice('Reconnect to discard this session. Your saved attendance marks are still safe on this device.');return;}
    if(!window.confirm('Discard this attendance session?\n\nAll marks in this live session will be permanently removed.'))return;
    setClosing(true);setError('');
    try{
      const s=await getClientSession();
      if(!s)throw Error('You must be logged in.');
      const response=await fetchAttendanceWithTimeout('/api/attendance/leave-session',{
        method:'POST',
        headers:{'Content-Type':'application/json',Authorization:`Bearer ${s.access_token}`},
        body:JSON.stringify({session_id:session.session_id})
      });
      const data=await read(response);
      if(!response.ok&&!([404,409].includes(response.status))){throw Error(data.error||'Could not discard this session.');}
      await clearFieldSession(s.user.id,session.session_id).catch(()=>{});
      clearCached('attendance:'+s.user.id);
      setSession(null);setPeople([]);setFieldRoster([]);setFieldReady(false);setPendingCount(0);setCanDiscard(false);setCursor(null);setHasMore(false);setTotal(0);setPresent(0);fieldWarmAt.current=0;
      setNotice(response.ok&&data.success?'Attendance session discarded.':'Attendance was already discarded or closed.');
      publishDataChange('attendance');
      onCloseRef.current?.();
    }catch(e){
      console.error('[ATTENDANCE] Discard error:',e);
      if(mounted.current)setError(e.message||'Could not discard this session.');
    }finally{
      if(mounted.current)setClosing(false);
    }
  };

  if(!isOpen||typeof document==='undefined')return null;

  const percent=total?Math.round((present/total)*100):0;
  const fieldStatus=session?.status==='closed'?'Saved':networkOnline?(pendingCount?`Syncing ${pendingCount} change${pendingCount===1?'':'s'}`:'Online'):`Offline${pendingCount?' · '+pendingCount+' pending':''}`;
  const autoCloseLabel=(()=>{
    if(!session?.auto_close_at)return null;
    try{
      return new Intl.DateTimeFormat('en-NG',{
        weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',
        timeZone:session.organization_timezone||'Africa/Lagos'
      }).format(new Date(session.auto_close_at));
    }catch{return null}
  })();
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
          {session?.name&&<h2 style={h2}>{session.name}</h2>}
          <p style={sub}>
            {session
              ? 'Mark people as you see them. Your changes are saved immediately.'
              : background
                ? `${backgroundLabel}. You can start the next attendance now.`
                : 'Create a session to begin taking attendance.'}
          </p>
          {session?.status==='active'&&autoCloseLabel&&<span style={autoCloseHint}>You can leave this screen. Attendance stays live for everyone and saves automatically by {autoCloseLabel}.</span>}
        </div>
        <button style={close} onClick={onClose} aria-label="Close attendance">×</button>
      </header>

      {background&&!session&&<div style={backgroundBox}><AriaProcessingStatus kind="attendance" status={background.processing_status||'processing'} stage={background.aria_processing_stage||background.stage||''} progress={background.progress||0} processed={background.processed||0} total={background.total||0}/><span style={backgroundHint}>{backgroundLabel==='ARIA updated'?'The last session is fully understood.':background.processing_status==='needs_attention'?'Attendance is saved. ARIA is waiting for a human decision.':'Attendance is saved. You can start the next session while ARIA finishes this one.'}</span></div>}

      {background&&session&&<div style={backgroundInline}><AriaProcessingStatus kind="attendance" compact status={background.processing_status||'processing'} stage={background.aria_processing_stage||background.stage||''} progress={background.progress||0}/></div>}

      {notice&&<div style={noticeBox}>{notice}</div>}
      {legacyPendingCount>0&&<div style={errorBox} role="alert">This device has {legacyPendingCount} older offline attendance change{legacyPendingCount===1?'':'s'} that are not tied to a specific sign-in. NYEOCARE will not upload them as another account. Compare against the approved paper sheet and ask an owner or admin to reconcile them before relying on the saved total.</div>}
      {session?.status==='active'&&!rosterSnapshotComplete&&!loading&&<div style={noticeBox} role="status">
        {networkOnline
          ? 'The full roster snapshot on this device is not confirmed yet. NYEOCARE is refreshing it; until that finishes, cached totals and search results may be incomplete. Keep the approved paper sheet as the service backup.'
          : 'Only '+fieldRoster.length+' cached people are available offline on this device, and the cache is not confirmed complete. The directory may be larger and the present count may be incomplete. Use the approved paper attendance sheet as the authoritative record until this device reconnects and refreshes.'}
      </div>}
      {error&&<div style={errorBox}>{error}</div>}

      {loading?<div style={loadingBox}>Preparing attendance…</div>
      :!session?canStartSession?<div style={createBox}>
        <div style={plus}>＋</div>
        <strong style={{fontSize:20}}>Start attendance</strong>
        <input
          style={input}
          value={sessionName}
          onChange={e=>setSessionName(e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter'&&!saving)createSession()}}
          placeholder="Session name"
          maxLength={120}
          autoFocus
        />
        <span style={{...sub,fontSize:12,textAlign:"center"}}>
          Give the session a clear name. You can close this screen at any time; attendance stays open for everyone until it is saved automatically or you choose to save it.
        </span>
        <button
          style={{...primary,opacity:saving||!sessionName.trim()?0.55:1}}
          disabled={saving||!sessionName.trim()}
          onClick={createSession}
        >
          {saving?'Starting…':'Start attendance'}
        </button>
      </div>
      :<div style={createBox}>
        <div style={plus}>＋</div>
        <strong style={{fontSize:20}}>An owner or admin must start attendance</strong>
        <span style={sub}>Ask an owner or admin to start the service. Once it is active, reopen Attendance to join and mark people present.</span>
      </div>
      :<div style={main}>
        <div style={stats}>
          <div><strong style={big}>{present}</strong><span style={label}>present</span></div>
          <div style={divider}/>
          <div><strong style={stat}>{total}</strong><span style={label}>{rosterSnapshotComplete?'people':'cached people'}</span></div>
          <div><strong style={stat}>{percent}%</strong><span style={label}>{rosterSnapshotComplete?'marked':'cached marked'}</span></div>
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
        <div style={{padding:'0 18px 8px',display:'flex',justifyContent:'flex-end'}}>
          <button type="button" style={{...markButton,opacity:!networkOnline||addingVisitor?0.5:1}} disabled={!networkOnline||addingVisitor||session.status!=='active'} onClick={()=>{setVisitorIdentityReview(null);setShowAddVisitor(value=>!value)}}>
            {showAddVisitor?'Cancel adding visitor':'+ Add visitor'}
          </button>
        </div>
        {!networkOnline&&<div style={noticeBox}>Offline mode can queue attendance marks for people already in the directory, but it cannot create a new person record safely. Use the church’s approved paper attendance sheet for new visitors and add them when the connection returns.</div>}
        {showAddVisitor&&<div style={{margin:'0 18px 10px',padding:12,borderRadius:14,border:'1px solid rgba(255,255,255,.13)',background:'rgba(0,0,0,.14)',display:'grid',gap:8}}>
          <strong style={{fontSize:14}}>Add a first-time visitor</strong>
          <input style={{...input,width:'100%'}} value={visitorName} onChange={e=>{visitorRequestId.current='';setVisitorIdentityReview(null);setVisitorName(e.target.value)}} placeholder="Full name (required)" maxLength={180} autoComplete="name" />
          <input style={{...input,width:'100%'}} value={visitorPhone} onChange={e=>{visitorRequestId.current='';setVisitorIdentityReview(null);setVisitorPhone(e.target.value)}} placeholder="Phone number (optional)" type="tel" inputMode="tel" autoComplete="tel" />
          <label style={{display:'flex',alignItems:'flex-start',gap:8,fontSize:12,lineHeight:1.4,color:'rgba(255,255,255,.8)'}}>
            <input type="checkbox" checked={visitorContactConsent} onChange={e=>{visitorRequestId.current='';setVisitorContactConsent(e.target.checked)}} style={{marginTop:2}} />
            They explicitly agreed that the church may keep this phone number for follow-up. Leave the phone blank if they did not agree.
          </label>
          {visitorIdentityReview&&<div role="alert" style={{padding:12,borderRadius:12,border:'1px solid rgba(212,175,55,.35)',background:'rgba(212,175,55,.06)',display:'grid',gap:8}}><strong style={{fontSize:13}}>{visitorIdentityReview.code==='DUPLICATE_IDENTITY_NOT_DISTINCT'?'Same identity already exists':'Review possible matches'}</strong><span style={{fontSize:12,lineHeight:1.5,opacity:.8}}>{visitorIdentityReview.message}</span>{visitorIdentityReview.candidates.map(candidate=><div key={candidate.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,padding:'7px 0',borderTop:'1px solid rgba(255,255,255,.08)'}}><div style={{minWidth:0}}><strong style={{display:'block',fontSize:12}}>{candidate.display_name||[candidate.first_name,candidate.last_name].filter(Boolean).join(' ')}</strong><span style={{display:'block',fontSize:11,opacity:.7,marginTop:3}}>{candidate.phone||'No phone recorded'}{candidate.status?' · '+candidate.status:''}</span><span style={{display:'block',fontSize:10,opacity:.55,marginTop:2}}>{candidate.name_match?'Same normalized name · ':candidate.similar_name?'Similar name · ':''}{candidate.phone_match?'Same phone number':''}</span></div><a href={`/person/${candidate.id}`} target="_blank" rel="noreferrer" style={{fontSize:11,color:'#D4AF37',whiteSpace:'nowrap'}}>Open record</a></div>)}{visitorIdentityReview.code!=='PERSON_IDENTITY_REVIEW_IN_PROGRESS'&&<button type="button" style={primary} disabled={addingVisitor} onClick={()=>addVisitor({confirmed:true,candidate_ids:visitorIdentityReview.candidates.map(candidate=>candidate.id)})}>I verified this is a separate person</button>}<a href="/people?review=1" style={{display:'block',textAlign:'center',padding:'10px 12px',borderRadius:999,border:'1px solid rgba(212,175,55,.28)',color:'#D4AF37',fontSize:12,textDecoration:'none'}}>Open Review Center</a><button type="button" style={discardButton} onClick={()=>setVisitorIdentityReview(null)}>Close review</button></div>}
          <span style={{...sub,fontSize:11}}>This adds the person as a Visitor only. It does not make them a member or worker, and no message is sent.</span>
          <div style={{display:'flex',justifyContent:'flex-end',gap:8,flexWrap:'wrap'}}>
            <button type="button" style={discardButton} disabled={addingVisitor} onClick={()=>{visitorRequestId.current='';setShowAddVisitor(false);setVisitorName('');setVisitorPhone('');setVisitorContactConsent(false)}}>Cancel</button>
            <button type="button" style={{...primary,opacity:addingVisitor||!visitorName.trim()||!networkOnline||Boolean(visitorPhone.trim()&&!visitorContactConsent)?0.55:1}} disabled={addingVisitor||!visitorName.trim()||!networkOnline||Boolean(visitorPhone.trim()&&!visitorContactConsent)} onClick={addVisitor}>{addingVisitor?'Adding…':'Save visitor'}</button>
          </div>
        </div>}
        

        <div style={peopleBox}>
          {people.map(p=>
            <div style={personRow} key={p.id}>
              <div style={personInfo}>
                <div style={{...avatar,...(p.marked?presentAvatar:{})}}>
                  {(p.first_name||'?').charAt(0).toUpperCase()}
                </div>
                <div style={{minWidth:0}}>
                  <strong>{p.first_name} {p.last_name||''}</strong>
                  {p.marked&&<small style={{display:'block'}}>{'Present'+(p.marked_by_name?' · '+p.marked_by_name:'')}</small>}
                  {p.marked&&p.first_visit_candidate===true&&(
                    <div style={firstVisitWelcomeRow}>
                      {p.first_visit_welcome_recorded===true
                        ? <small style={firstVisitWelcomeDone}>✓ Welcomed in person</small>
                        : <>
                            <small style={firstVisitWelcomeHint}>First recorded attendance · welcome warmly if appropriate</small>
                            <button
                              type="button"
                              style={{...firstVisitWelcomeButton,...((!networkOnline||pendingCount>0||closing||session.status!=='active'||welcomeSavingIds.includes(String(p.id)))?firstVisitWelcomeButtonDisabled:{})}}
                              disabled={!networkOnline||pendingCount>0||closing||session.status!=='active'||welcomeSavingIds.includes(String(p.id))}
                              onClick={()=>recordFirstVisitWelcome(p)}
                              aria-label={`Record in-person welcome for ${p.first_name||'this visitor'}`}
                            >
                              {welcomeSavingIds.includes(String(p.id))?'Saving…':!networkOnline||pendingCount>0?'Sync to record':'Welcomed in person'}
                            </button>
                          </>
                      }
                    </div>
                  )}
                </div>
              </div>
              <button
                style={{...markButton,...(p.marked?doneButton:{})}}
                disabled={closing||session.status!=='active'}
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
          <div style={live}><i/>Live attendance <span style={fieldState}>{fieldStatus}</span></div>
          <div style={footerActions}>
            {canDiscard&&<button style={discardButton} disabled={closing} onClick={discard}>Discard</button>}
            <button style={keepButton} disabled={closing||loading||session.status!=='active'} onClick={()=>setShowFinishConfirm(true)}>
              {closing?'Saving…':'Save attendance'}
            </button>
          </div>
        </footer>
      </div>}
    </div>
    {showFinishConfirm&&<div style={finishConfirmOverlay} role="alertdialog" aria-modal="true" aria-labelledby="attendance-finish-title" aria-describedby="attendance-finish-description">
      <div style={finishConfirmCard}>
        <strong id="attendance-finish-title" style={{fontSize:18}}>Save attendance?</strong>
        <p id="attendance-finish-description" style={{margin:'8px 0 16px',fontSize:13,lineHeight:1.55,color:'rgba(255,255,255,.78)'}}>
          Have you finished marking everyone who attended? Anyone not marked Present will be marked absent for this event. An owner or admin can correct it later.
        </p>
        <div style={{display:'flex',justifyContent:'flex-end',gap:8,flexWrap:'wrap'}}>
          <button type="button" style={discardButton} disabled={closing} onClick={()=>setShowFinishConfirm(false)}>Cancel</button>
          <button type="button" style={keepButton} disabled={closing||legacyPendingCount>0||(networkOnline&&pendingCount>0)} onClick={keep}>{closing?'Saving…':'Yes, save attendance'}</button>
        </div>
        {(networkOnline&&pendingCount>0||legacyPendingCount>0)&&<span style={{marginTop:10,fontSize:11,color:'rgba(255,210,140,.9)'}}>Wait for the pending attendance changes to sync before saving.</span>}
      </div>
    </div>}
  </div>;

  return createPortal(content,document.body);
}

const autoCloseHint={display:'block',marginTop:5,fontSize:11,color:'rgba(214,184,106,.82)',lineHeight:1.4};
const finishConfirmOverlay={position:'fixed',inset:0,zIndex:2147483001,display:'grid',placeItems:'center',padding:18,background:'rgba(2,5,12,.76)',backdropFilter:'blur(12px)'};
const finishConfirmCard={width:'min(440px,100%)',padding:20,borderRadius:20,border:'1px solid rgba(255,255,255,.16)',background:'linear-gradient(145deg,#26364d,#0b1425)',boxShadow:'0 24px 70px rgba(0,0,0,.55)',color:'#f5f7fb'};
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
const firstVisitWelcomeRow={display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',marginTop:5,maxWidth:340};
const firstVisitWelcomeHint={fontSize:10,color:'rgba(214,184,106,.82)',lineHeight:1.35};
const firstVisitWelcomeDone={fontSize:10,color:'rgba(74,222,128,.9)',lineHeight:1.35};
const firstVisitWelcomeButton={padding:'4px 8px',borderRadius:999,border:'1px solid rgba(214,184,106,.32)',background:'rgba(214,184,106,.09)',color:'rgba(255,242,208,.96)',cursor:'pointer',fontSize:10,fontWeight:600,whiteSpace:'nowrap'};
const firstVisitWelcomeButtonDisabled={opacity:.45,cursor:'not-allowed'};
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

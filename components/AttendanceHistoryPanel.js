// components/AttendanceHistoryPanel.js
import{useCallback,useEffect,useRef,useState}from'react';

import{getClientSession}from'../lib/clientSession';import ModalPortal from'./ModalPortal';

const groups={men:'Men',women:'Women',youth:'Youth',unassigned:'Unassigned'};
const count=value=>Number(value)||0;
const formatDate=(value,zone='Africa/Lagos')=>{
  if(!value)return'—';
  try{return new Intl.DateTimeFormat('en-NG',{weekday:'short',day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',timeZone:zone}).format(new Date(value));}
  catch{return new Date(value).toLocaleString();}
};
const personName=value=>String(value||'Person').trim()||'Person';

export default function AttendanceHistoryPanel({isOpen,onClose,initialSessionId=null}){
  const[sessions,setSessions]=useState([]),[listCursor,setListCursor]=useState(null),[listMore,setListMore]=useState(false),[listLoading,setListLoading]=useState(false);
  const[detail,setDetail]=useState(null),[recordCursor,setRecordCursor]=useState(null),[recordMore,setRecordMore]=useState(false),[detailLoading,setDetailLoading]=useState(false),[loadingMore,setLoadingMore]=useState(false);
  const[error,setError]=useState(''),[compact,setCompact]=useState(false);
  const navigationRef=useRef({key:null,active:false,detail:null});
  const onCloseRef=useRef(onClose);
  useEffect(()=>{onCloseRef.current=onClose},[onClose]);

  const request=useCallback(async url=>{
    const auth=await getClientSession();
    if(!auth?.access_token)throw new Error('Your sign-in session has expired. Sign in again to view attendance history.');
    const response=await fetch(url,{headers:{Authorization:'Bearer '+auth.access_token},cache:'no-store'});
    const raw=await response.text();let data={};
    try{data=raw?JSON.parse(raw):{}}catch{data={error:'The attendance history response could not be read.'};}
    if(!response.ok||data.success!==true)throw new Error(data.error||'Could not load attendance history.');
    return data;
  },[]);

  const loadSessions=useCallback(async(cursor=null,append=false)=>{
    if(append)setLoadingMore(true);else setListLoading(true);setError('');
    try{
      const params=new URLSearchParams({limit:'20'});if(cursor)params.set('cursor',cursor);
      const data=await request('/api/attendance/history?'+params.toString());
      setSessions(current=>append?[...current,...(data.sessions||[])]:data.sessions||[]);
      setListCursor(data.next_cursor||null);setListMore(data.has_more===true);
    }catch(err){setError(err.message||'Could not load saved attendance.');}
    finally{setListLoading(false);setLoadingMore(false);}
  },[request]);

  const loadDetail=useCallback(async(id,cursor=null,append=false)=>{
    if(append)setLoadingMore(true);else setDetailLoading(true);setError('');
    try{
      const params=new URLSearchParams({session_id:String(id),limit:'100'});if(cursor)params.set('cursor',cursor);
      const data=await request('/api/attendance/history?'+params.toString());
      setDetail(current=>append&&current?{...data,records:[...(current.records||[]),...(data.records||[])]}:data);
      setRecordCursor(data.next_cursor||null);setRecordMore(data.has_more===true);
    }catch(err){setError(err.message||'Could not load this attendance record.');}
    finally{setDetailLoading(false);setLoadingMore(false);}
  },[request]);

  const openSession=useCallback(id=>{
    const navigation=navigationRef.current;
    if(navigation.active&&!navigation.detail){
      navigation.detail=String(id);
      const state=window.history.state&&typeof window.history.state==='object'?window.history.state:{};
      window.history.pushState({...state,nyeoAttendanceHistoryKey:navigation.key,nyeoAttendanceHistoryDetail:navigation.detail},'');
    }
    void loadDetail(id);
  },[loadDetail]);

  const backFromDetail=()=>{
    const navigation=navigationRef.current;
    if(navigation.active&&navigation.detail){window.history.back();return;}
    setDetail(null);setError('');
  };

  useEffect(()=>{
    if(!isOpen)return;
    setDetail(null);setError('');setSessions([]);setListCursor(null);setListMore(false);
    const key='nyeo-attendance-history-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
    const baseState=window.history.state&&typeof window.history.state==='object'?window.history.state:{};
    const navigation={key,active:true,detail:null};
    navigationRef.current=navigation;
    window.history.pushState({...baseState,nyeoAttendanceHistoryKey:key,nyeoAttendanceHistoryDetail:null},'');
    if(initialSessionId){
      navigation.detail=String(initialSessionId);
      window.history.pushState({...window.history.state,nyeoAttendanceHistoryKey:key,nyeoAttendanceHistoryDetail:navigation.detail},'');
    }
    const handlePopState=()=>{
      if(!navigation.active)return;
      if(navigation.detail){
        navigation.detail=null;
        setDetail(null);
        setError('');
        return;
      }
      navigation.active=false;
      onCloseRef.current?.();
    };
    window.addEventListener('popstate',handlePopState);
    void loadSessions();if(initialSessionId)void loadDetail(initialSessionId);
    return()=>window.removeEventListener('popstate',handlePopState);
  },[isOpen,initialSessionId,loadSessions,loadDetail]);

  useEffect(()=>{
    if(!isOpen)return;
    const media=window.matchMedia('(max-width:680px)'),update=()=>setCompact(media.matches);update();
    if(media.addEventListener)media.addEventListener('change',update);else window.addEventListener('resize',update);
    return()=>{if(media.removeEventListener)media.removeEventListener('change',update);else window.removeEventListener('resize',update);};
  },[isOpen]);

  if(!isOpen||typeof document==='undefined')return null;
  const summary=detail?.summary||null,totals=summary?.totals||{},breakdown=summary?.group_breakdown||[];
  const present=count(totals.present_count),absent=count(totals.absent_count);
  const processingStatus=detail?.session?.aria_processing_status;
  const view=<div className="ny-modal-overlay" style={{...overlay,pointerEvents:'auto'}}>
    <section className="ny-modal-panel" style={{...modal,width:compact?'100vw':'min(920px,96vw)',height:compact?'100dvh':'min(90dvh,860px)',maxHeight:compact?'100dvh':'90dvh',borderRadius:compact?0:26}}>
      <header style={header}>
        <div style={{display:'flex',alignItems:'center',gap:10,minWidth:0}}>
          {detail&&<button type="button" style={back} onClick={backFromDetail}>‹</button>}
          <div style={{minWidth:0}}>
            <div style={eyebrow}>NYEOCARE · ATTENDANCE</div>
            <h2 style={heading}>{detail?detail.session?.name||'Saved attendance':'Past attendance'}</h2>
            <div style={subtitle}>{detail?.session?formatDate(detail.session.started_at,detail.session.organization_timezone):'Saved gatherings and their recorded register'}</div>
          </div>
        </div>
      </header>
      {error&&<div style={errorBox} role="alert">{error}</div>}
      {detail?<div style={body}>
        {detailLoading&&!summary?<div style={empty}>Loading saved register…</div>:<>
          <div style={summaryCard}>
            <div style={smallCaps}>RECORDED ATTENDANCE</div>
            <div style={bigNumber}>{present}</div>
            <div style={summaryLabel}>people recorded as present</div>
            <div style={stats}>
              <div><strong>{count(totals.recorded_count)}</strong><span>Recorded entries</span></div>
              <div><strong>{present}</strong><span>Present</span></div>
              <div><strong>{absent}</strong><span>Absent</span></div>
            </div>
            <div style={processing}>
              <i style={{background:processingStatus==='completed'?'#7FBF9A':processingStatus==='needs_attention'?'#D6B86A':'#8FAFD6'}}/>
              <span>{processingStatus==='completed'?'ARIA updated':processingStatus==='needs_attention'?'ARIA needs attention':'ARIA processing / queued'}</span>
              <span style={{opacity:.5}}>· {String(detail.session?.register_completeness||'unconfirmed').replace(/_/g,' ')}</span>
            </div>
          </div>
          <div style={sectionTitle}><strong>Attendance breakdown</strong><span>Current People sections</span></div>
          <div style={groupList}>{breakdown.map(group=><div style={groupRow} key={group.key}>
            <span>{group.label}</span><div style={track}><div style={{...fill,width:(present?Math.min(100,count(group.count)/present*100):0)+'%'}}/></div><strong>{count(group.count)}</strong>
          </div>)}</div>
          <p style={note}>Section totals use each person’s current People assignment. Earlier sessions do not contain a historical section snapshot, so this breakdown is descriptive—not a claim about their section on the service date.</p>
          <div style={sectionTitle}><strong>Saved register</strong><span>{(detail.records||[]).length} loaded</span></div>
          <div style={records}>
            {(detail.records||[]).map(record=>{
              const label=record.present?'Present':'Absent';
              const tone=record.present?'#9BD4AE':'rgba(245,247,250,.58)';
              return <div style={recordRow} key={record.id}>
                <div style={avatar}>{personName(record.person_name).charAt(0).toUpperCase()}</div>
                <div style={{minWidth:0,flex:1}}>
                  <strong style={name}>{personName(record.person_name)}</strong>
                  <div style={meta}>{groups[record.attendance_group]||'Unassigned'} · {record.marked_at?formatDate(record.marked_at,detail.session?.organization_timezone):'Date recorded'}</div>
                </div>
                <span style={{...status,color:tone,borderColor:'rgba(255,255,255,.1)'}}>{label}</span>
              </div>;
            })}
            {!detail.records?.length&&!detailLoading&&<div style={empty}>No attendance entries were recorded for this session.</div>}
            {recordMore&&<button type="button" style={more} disabled={loadingMore} onClick={()=>loadDetail(detail.session.id,recordCursor,true)}>{loadingMore?'Loading…':'Load more entries'}</button>}
          </div>
        </>}
      </div>:<div style={body}>
        <div style={intro}><strong>Every saved gathering, kept together.</strong><span>Open a session to see its recorded present and absent counts, section summary and register.</span></div>
        {listLoading&&!sessions.length?<div style={empty}>Loading attendance history…</div>:sessions.map(item=><button type="button" style={sessionCard} key={item.id} onClick={()=>openSession(item.id)}>
          <div style={sessionTop}><div style={{minWidth:0}}><strong style={sessionName}>{item.name||'Attendance session'}</strong><span style={sessionDate}>{formatDate(item.started_at,item.organization_timezone)}</span></div><span style={arrow}>›</span></div>
          <div style={sessionStats}><span><strong>{count(item.present_count)}</strong> present</span><span><strong>{count(item.absent_count)}</strong> absent</span><span>{item.aria_processing_status==='completed'?'ARIA updated':'ARIA processing'}</span></div>
        </button>)}
        {!listLoading&&!sessions.length&&!error&&<div style={empty}>No saved attendance sessions yet.</div>}
        {listMore&&<button type="button" style={more} disabled={loadingMore} onClick={()=>loadSessions(listCursor,true)}>{loadingMore?'Loading…':'Load earlier sessions'}</button>}
      </div>}
    </section>
  </div>;
  return <ModalPortal>{view}</ModalPortal>;
}
const overlay={position:'fixed',inset:0,zIndex:2147483600,display:'flex',alignItems:'center',justifyContent:'center',padding:10,background:'rgba(2,5,12,.82)',backdropFilter:'blur(18px)'};
const modal={display:'flex',flexDirection:'column',overflow:'hidden',border:'1px solid rgba(235,244,255,.16)',background:'linear-gradient(145deg,rgba(34,49,72,.99),rgba(7,14,27,.995))',boxShadow:'0 35px 110px rgba(0,0,0,.65)',color:'#F5F7FA'};
const header={display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,padding:'18px 20px 14px',borderBottom:'1px solid rgba(255,255,255,.08)',flexShrink:0};
const eyebrow={fontSize:9,fontWeight:800,letterSpacing:1.6,color:'rgba(214,184,106,.85)'};
const heading={fontSize:'clamp(19px,3vw,25px)',fontWeight:750,letterSpacing:-.3,margin:'4px 0 2px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'};
const subtitle={fontSize:11,color:'rgba(245,247,250,.48)',lineHeight:1.4};
const back={width:34,height:34,borderRadius:11,border:'1px solid rgba(255,255,255,.12)',background:'rgba(255,255,255,.045)',color:'#F5F7FA',fontSize:24,cursor:'pointer'};
const close={width:36,height:36,borderRadius:'50%',border:'1px solid rgba(255,255,255,.12)',background:'rgba(255,255,255,.07)',color:'#F5F7FA',fontSize:23,cursor:'pointer',flexShrink:0};
const body={flex:1,minHeight:0,overflowY:'auto',padding:'16px 18px 22px'};
const summaryCard={padding:18,borderRadius:19,border:'1px solid rgba(214,184,106,.22)',background:'radial-gradient(circle at 85% 10%,rgba(214,184,106,.13),transparent 42%),linear-gradient(145deg,rgba(31,47,70,.8),rgba(9,17,31,.9))'};
const smallCaps={fontSize:9,fontWeight:800,letterSpacing:1.4,color:'rgba(214,184,106,.82)'};
const bigNumber={fontSize:48,fontWeight:820,lineHeight:1.05,letterSpacing:-1.5,marginTop:8,fontVariantNumeric:'tabular-nums'};
const summaryLabel={fontSize:12,color:'rgba(245,247,250,.55)',marginTop:2};
const stats={display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:8,marginTop:18};
const processing={display:'flex',alignItems:'center',gap:7,marginTop:14,fontSize:10,color:'rgba(245,247,250,.64)',textTransform:'capitalize',flexWrap:'wrap'};
const sectionTitle={display:'flex',alignItems:'baseline',justifyContent:'space-between',gap:12,margin:'18px 2px 9px',fontSize:13};
const groupList={padding:'7px 12px',borderRadius:15,border:'1px solid rgba(255,255,255,.08)',background:'rgba(255,255,255,.025)'};
const groupRow={display:'grid',gridTemplateColumns:'78px minmax(40px,1fr) 25px',alignItems:'center',gap:9,padding:'8px 0',fontSize:11,color:'rgba(245,247,250,.72)'};
const track={height:5,borderRadius:99,overflow:'hidden',background:'rgba(255,255,255,.09)'};
const fill={height:'100%',borderRadius:99,background:'linear-gradient(90deg,#927544,#E8D49A)'};
const note={fontSize:10,lineHeight:1.45,color:'rgba(245,247,250,.38)',margin:'8px 2px 0'};
const records={borderTop:'1px solid rgba(255,255,255,.07)'};
const recordRow={display:'flex',alignItems:'center',gap:10,padding:'10px 2px',borderBottom:'1px solid rgba(255,255,255,.055)'};
const avatar={width:34,height:34,borderRadius:12,display:'grid',placeItems:'center',flexShrink:0,background:'rgba(255,255,255,.07)',color:'#E8D49A',fontWeight:750,fontSize:13};
const name={fontSize:12,display:'block',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'};
const meta={fontSize:9.5,color:'rgba(245,247,250,.42)',marginTop:3};
const status={fontSize:9.5,fontWeight:700,whiteSpace:'nowrap',border:'1px solid',borderRadius:999,padding:'5px 8px'};
const sessionCard={display:'block',width:'100%',textAlign:'left',padding:15,marginBottom:9,borderRadius:16,border:'1px solid rgba(255,255,255,.085)',background:'linear-gradient(140deg,rgba(255,255,255,.055),rgba(255,255,255,.018))',color:'#F5F7FA',cursor:'pointer'};
const sessionTop={display:'flex',alignItems:'center',justifyContent:'space-between',gap:12};
const sessionName={display:'block',fontSize:14,fontWeight:720};
const sessionDate={display:'block',fontSize:10,color:'rgba(245,247,250,.48)',marginTop:4};
const arrow={fontSize:24,color:'#D6B86A'};
const sessionStats={display:'flex',gap:13,flexWrap:'wrap',fontSize:10,color:'rgba(245,247,250,.48)',marginTop:13};
const intro={display:'grid',gap:4,padding:'3px 2px 14px',fontSize:12,color:'rgba(245,247,250,.55)'};
const empty={minHeight:150,display:'grid',placeItems:'center',alignContent:'center',fontSize:12,color:'rgba(245,247,250,.46)',textAlign:'center'};
const more={display:'block',width:'100%',padding:11,margin:'14px 0',borderRadius:999,border:'1px solid rgba(214,184,106,.24)',background:'rgba(214,184,106,.075)',color:'#E8D49A',fontSize:11,fontWeight:700,cursor:'pointer'};
const errorBox={margin:'10px 14px 0',padding:11,borderRadius:12,border:'1px solid rgba(215,123,123,.24)',background:'rgba(215,123,123,.08)',color:'#F0B6B6',fontSize:11,lineHeight:1.45};

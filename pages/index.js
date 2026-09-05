// pages/index.js
import{useEffect,useState}from'react';
import{useRouter}from'next/router';
import{supabase}from'../lib/supabaseClient';
import Layout from'../components/Layout';
import CareQueueList from'../components/CareQueueList';
import ScanModal from'../components/ScanModal';
import AttendanceModal from'../components/AttendanceModal';
import AriaVoice from'../components/AriaVoice';

export default function ARIAHome(){
const router=useRouter(),[data,setData]=useState(null),[loading,setLoading]=useState(true),[tool,setTool]=useState(null);
useEffect(()=>{
let active=true;
async function load(){
try{
const{data:{session}}=await supabase.auth.getSession();
if(!session){await router.replace('/login');return}
const res=await fetch('/api/daily-briefing/latest',{headers:{Authorization:`Bearer ${session.access_token}`}});
if(!res.ok)throw Error('ARIA Today failed to load');
const json=await res.json();
if(active)setData(json);
}catch(err){if(active)console.error('[ARIA Today]',err)}finally{if(active)setLoading(false)}
}
load();
return()=>{active=false};
},[router]);

if(loading)return <Layout><div style={{maxWidth:900,margin:'0 auto',padding:'48px 20px'}}><div className="fiducia-card shimmer" style={{height:260,borderRadius:28}}/></div></Layout>;
if(!data)return <Layout><div style={{maxWidth:900,margin:'0 auto',padding:'48px 20px'}}><h1 style={{color:'#f0f0f0'}}>ARIA Today</h1><p style={{color:'rgba(255,255,255,.55)'}}>ARIA could not load today’s information.</p></div></Layout>;

const s=data.stats||{},hasPattern=data.patterns?.length>0,hasActions=data.pendingActions?.length>0;

return <Layout>
<main style={{maxWidth:900,margin:'0 auto',padding:'42px 20px 100px'}}>
<div style={{marginBottom:34}}>
<div style={eyebrow}>ARIA Today</div>
<h1 style={hero}>{data.summary}</h1>
</div>

<p style={description}>
{hasPattern?'This is a pattern worth looking at before it becomes a bigger concern.':hasActions?'ARIA has prepared a possible next step for you to review.':data.state==='EMPTY'?'Add your people and ARIA will begin building the memory needed to notice meaningful changes over time.':data.state==='STARTING'?'Your people are here. A session gives ARIA the real-world activity it needs to learn patterns.':'ARIA is watching for meaningful changes and will surface them when there is enough evidence.'}
</p>

<section style={statsGrid}><Stat label="People" value={s.people??0}/><Stat label="30-day sessions" value={s.sessions30??0}/><Stat label="Active attendees" value={s.activeAttendees30??0}/></section>

<section style={{marginBottom:42}}>
<h2 style={sectionTitle}>Talk to ARIA</h2>
<AriaVoice/>
</section>

<section style={{marginBottom:42}}>
<h2 style={sectionTitle}>What should I do?</h2>
<div className="fiducia-card" style={{padding:24,borderRadius:28}}>
<div style={cardTitle}>{data.state==='EMPTY'?'Begin with your people.':data.state==='STARTING'?'Record your first session.':hasPattern?`Look at ${data.patterns[0].first_name}'s pattern.`:hasActions?'Review ARIA’s suggested action.':'Nothing needs your attention right now.'}</div>
<p style={cardText}>{data.nextAction}</p>
{data.nextActionType==='SCAN'&&<ToolButton onClick={()=>setTool('scan')} primary>Scan Register</ToolButton>}
{data.nextActionType==='ATTENDANCE'&&<ToolButton onClick={()=>setTool('attendance')} primary>Attendance</ToolButton>}
{data.nextActionType==='REVIEW'&&<ToolButton onClick={()=>setTool('review')} primary>Review</ToolButton>}
</div>
</section>

{hasPattern&&<section style={{marginBottom:42}}>
<h2 style={sectionTitle}>A pattern ARIA noticed</h2>
{data.patterns.slice(0,3).map(p=><div key={p.id} className="fiducia-card" style={{padding:'18px 20px',marginBottom:8,borderRadius:22}}>
<div style={{color:'#f2f2f2',fontWeight:500}}>{p.first_name} {p.last_name||''}</div>
<div style={patternText}>Attended {p.previous_attendance} of the previous 3 sessions, but was not present in the latest session.</div>
<div style={patternLabel}>PATTERN · not a prediction of what will happen</div>
</div>)}
</section>}

<CareQueueList/>

<section style={tools}>
<div style={toolsLabel}>Tools</div>
<div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
<ToolButton onClick={()=>setTool('scan')}>Scan Register</ToolButton>
<ToolButton onClick={()=>setTool('attendance')}>Attendance</ToolButton>
<ToolButton onClick={()=>setTool('review')}>Review</ToolButton>
</div>
</section>

<div style={footerText}>Every Person. Every Story. Remembered.</div>
</main>

{tool==='scan'&&<ScanModal isOpen onClose={()=>setTool(null)}/>}
{tool==='attendance'&&<AttendanceModal isOpen onClose={()=>setTool(null)}/>}
{tool==='review'&&<ActionModal title="Review" text="Review people, signals and suggested care actions before deciding what to do." button="Open Review" onClose={()=>setTool(null)} onAction={()=>router.push('/people?tab=review')}/>}
</Layout>
}

function Stat({label,value}){return <div className="fiducia-card" style={{padding:'18px 20px',borderRadius:24}}><div style={statLabel}>{label}</div><div style={statValue}>{value}</div></div>}
function ToolButton({children,onClick,primary=false}){return <button onClick={onClick} className={primary?'fiducia-button fiducia-button-primary':'fiducia-button fiducia-button-ghost'} style={{borderRadius:999}}>{children}</button>}
function ActionModal({title,text,button,onClose,onAction}){return <div style={actionOverlay}><div className="fiducia-card" style={{width:'100%',maxWidth:480,padding:28,borderRadius:30}}><h2 style={{margin:'0 0 10px',color:'#f5f5f5'}}>{title}</h2><p style={actionText}>{text}</p><div style={{display:'flex',gap:10,flexWrap:'wrap'}}><ToolButton primary onClick={onAction}>{button}</ToolButton><ToolButton onClick={onClose}>Close</ToolButton></div></div></div>}

const eyebrow={fontSize:13,letterSpacing:2,textTransform:'uppercase',color:'rgba(255,255,255,.4)',marginBottom:14},hero={fontSize:'clamp(34px,7vw,58px)',lineHeight:1.08,letterSpacing:'-.035em',fontWeight:600,color:'#f7f7f7',maxWidth:760,margin:0},description={fontSize:18,lineHeight:1.65,color:'rgba(255,255,255,.58)',maxWidth:720,margin:'0 0 34px'},statsGrid={display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:12,marginBottom:44},sectionTitle={fontSize:22,fontWeight:550,color:'#f0f0f0',margin:'0 0 14px'},cardTitle={fontSize:21,fontWeight:550,color:'#f5f5f5',marginBottom:8},cardText={margin:'0 0 22px',fontSize:16,lineHeight:1.6,color:'rgba(255,255,255,.55)'},patternText={color:'rgba(255,255,255,.5)',marginTop:5,lineHeight:1.5},patternLabel={color:'rgba(255,255,255,.32)',fontSize:12,marginTop:8},statLabel={fontSize:12,letterSpacing:1.2,textTransform:'uppercase',color:'rgba(255,255,255,.4)',marginBottom:8},statValue={fontSize:32,fontWeight:600,color:'#f5f5f5'},tools={marginTop:42,paddingTop:26,borderTop:'1px solid rgba(255,255,255,.07)'},toolsLabel={fontSize:13,letterSpacing:1.5,textTransform:'uppercase',color:'rgba(255,255,255,.3)',marginBottom:14},footerText={textAlign:'center',marginTop:70,color:'rgba(255,255,255,.22)',fontSize:14,letterSpacing:'.03em'},actionOverlay={position:'fixed',inset:0,zIndex:1000,background:'rgba(0,0,0,.65)',backdropFilter:'blur(14px)',display:'flex',alignItems:'center',justifyContent:'center',padding:20},actionText={color:'rgba(255,255,255,.55)',lineHeight:1.6,margin:'0 0 24px'};

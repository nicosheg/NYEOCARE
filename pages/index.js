// pages/index.js
import{useEffect,useMemo,useState}from'react';
import{useRouter}from'next/router';
import{supabase}from'../lib/supabaseClient';
import Layout from'../components/Layout';
import AriaVoice from'../components/AriaVoice';
import ScanModal from'../components/ScanModal';
import AttendanceModal from'../components/AttendanceModal';
import ReviewCenterTab from'../components/ReviewCenterTab';

export default function ARIAHome(){
const router=useRouter();
const[data,setData]=useState(null),[loading,setLoading]=useState(true),[ariaOpen,setAriaOpen]=useState(false),[brief,setBrief]=useState(false),[scan,setScan]=useState(false),[attendance,setAttendance]=useState(false),[review,setReview]=useState(false),[live,setLive]=useState(false),[reviewCount,setReviewCount]=useState(0);

const load=async()=>{
try{
const{data:{session}}=await supabase.auth.getSession();
if(!session){await router.replace('/login');return}
const h={Authorization:`Bearer ${session.access_token}`};
const[a,b,c]=await Promise.all([
fetch('/api/daily-briefing/latest',{headers:h}),
fetch('/api/attendance/active-session',{headers:h}),
fetch('/api/identity/review-items',{headers:h})
]);
if(a.ok)setData(await a.json());
if(b.ok){const d=await b.json();setLive(!!d.active)}
if(c.ok){const d=await c.json();setReviewCount(Number(d.stats?.total)||d.items?.length||0)}
}catch(e){console.error('[ARIA Today]',e)}finally{setLoading(false)}
};

useEffect(()=>{let active=true;const run=async()=>{if(active)await load()};run();const t=setInterval(run,30000);return()=>{active=false;clearInterval(t)}},[]);

const briefing=useMemo(()=>{
if(!data)return'';
const items=data.briefing?.items||[];
if(!items.length)return`Good day. I’m keeping watch over ${data.organization?.name||'your organization'} today. There is nothing that needs your immediate attention right now.`;
const parts=[`Good day. Here is what matters most today for ${data.organization?.name||'your organization'}.`];
items.forEach((x,i)=>{
const name=x.first_name||x.last_name?`${x.first_name||''} ${x.last_name||''}`.trim():'';
const category=x.category==='care'?'Care':x.category==='relationship'?'Relationship':'People';
const detail=x.evidence?.summary||x.metadata?.summary||x.action_metadata?.summary||x.type||'Something worth your attention';
parts.push(`${i+1}. ${category}${name?` for ${name}`:''}. ${detail}.`);
});
return parts.join(' ');
},[data]);

if(loading)return <Layout><main style={shell}><div style={loadingCard}/></main></Layout>;
if(!data)return <Layout><main style={shell}><div style={empty}><div style={ariaMark}>ARIA</div><h1>ARIA is unavailable right now.</h1><p>Please try again.</p></div></main></Layout>;

const notification=data.notification||{hasSomething:false,text:'ARIA is keeping watch today.'};
const items=data.briefing?.items||[];

return <Layout>
<main style={shell}>
<section style={welcome}>
<div style={eyebrow}>NYEOCARE</div>
<h1 style={heading}>Good day.</h1>
<p style={subheading}>ARIA is here and keeping watch.</p>
</section>

<button style={ariaCard} onClick={()=>{setAriaOpen(true);setBrief(false)}}>
<div style={ariaOrb}>A</div>
<div style={{flex:1,textAlign:'left'}}>
<div style={ariaLabel}>ARIA</div>
<div style={ariaTitle}>{notification.hasSomething?notification.text:'ARIA is keeping watch.'}</div>
<div style={ariaSub}>{notification.hasSomething?`${notification.count||1} thing${notification.count===1?'':'s'} worth seeing today.`:'Nothing urgent right now. She is still watching.'}</div>
</div>
<div style={arrow}>›</div>
</button>

<section style={tools}>
<div style={toolsHead}>
<span>TODAY'S TOOLS</span>
{live&&<i>LIVE</i>}
</div>
<div style={toolGrid}>
<ActionButton icon="＋" title="Scan" detail="Remember people" onClick={()=>setScan(true)}/>
<ActionButton icon="◉" title={live?'Attendance · LIVE':'Attendance'} detail={live?'Mark people as you see them':'Start a session'} onClick={()=>setAttendance(true)} active={live}/>
<ActionButton icon="✓" title={reviewCount?`Review · ${reviewCount}`:'Review'} detail={reviewCount?'Resolve what ARIA found':'Identity is clear'} onClick={()=>setReview(true)} attention={reviewCount>0}/>
</div>
</section>

<section style={comingSoon}>
<div style={comingEyebrow}>ARIA</div>
<h2>She is becoming more.</h2>
<p>Soon, you won’t have to search for what matters. You’ll just talk to her.</p>
<span>COMING SOON</span>
</section>

{ariaOpen&&<AriaExperience data={data} briefing={briefing} brief={brief} setBrief={setBrief} onClose={()=>{setAriaOpen(false);setBrief(false)}}/>}
<ScanModal isOpen={scan} onClose={()=>{setScan(false);load()}}/>
<AttendanceModal isOpen={attendance} onClose={()=>{setAttendance(false);load()}}/>
{review&&<div style={modalOverlay}><div style={reviewShell}><ReviewCenterTab modal onClose={()=>{setReview(false);load()}}/></div></div>}
</main>
</Layout>
}

function ActionButton({icon,title,detail,onClick,active,attention}){
return <button style={{...tool,...(active?toolActive:{}),...(attention?toolAttention:{})}} onClick={onClick}>
<span style={toolIcon}>{icon}</span>
<span style={{flex:1,textAlign:'left'}}><b>{title}</b><small>{detail}</small></span>
<span style={toolArrow}>›</span>
</button>
}

function AriaExperience({data,briefing,brief,setBrief,onClose}){
const items=data.briefing?.items||[];
return <div style={overlay}>
<div style={experience}>
<header style={header}>
<button style={close} onClick={onClose}>×</button>
<div><div style={eyebrow}>ARIA · TODAY</div><div style={org}>{data.organization?.name||'Your organization'}</div></div>
</header>
<div style={content}>
{!brief&&<section style={ask}>
<div style={ariaMark}>ARIA</div>
<h1>{data.notification?.hasSomething?'I have something for you today.':'I’m keeping watch today.'}</h1>
<p>{data.briefing?.headline||'Nothing needs your immediate attention right now.'}</p>
{data.notification?.hasSomething?<div style={choice}><button style={primary} onClick={()=>setBrief(true)}>Yes, brief me</button><button style={secondary} onClick={onClose}>Not now</button></div>:<button style={secondary} onClick={onClose}>Close</button>}
</section>}
{brief&&<section>
<div style={briefHeader}><div style={ariaMark}>ARIA</div><div><div style={small}>DAILY BRIEFING</div><h1>Here is what matters today.</h1></div></div>
<AriaVoice briefingText={briefing}/>
<div style={queue}>{items.map((item,i)=><Priority key={`${item.category||'item'}:${item.id||item.person_id||i}`} item={item} index={i}/>)}{!items.length&&<div style={quiet}>ARIA has nothing urgent to bring to you right now. I’ll keep watching.</div>}</div>
</section>}
</div>
</div>
</div>
}

function Priority({item,index}){
const name=item.first_name||item.last_name?`${item.first_name||''} ${item.last_name||''}`.trim():'';
const category=item.category==='care'?'CARE':item.category==='relationship'?'RELATIONSHIP':'PEOPLE';
const detail=item.evidence?.summary||item.metadata?.summary||item.action_metadata?.summary||item.type||'ARIA noticed something worth your attention.';
return <article style={priorityCard}>
<div style={number}>{String(index+1).padStart(2,'0')}</div>
<div style={{flex:1}}>
<div style={label}>{category}</div>
<h2>{name||'Something needs attention'}</h2>
<p>{detail}</p>
</div>
</article>
}

const shell={maxWidth:860,margin:'0 auto',padding:'34px 20px 90px',minHeight:'calc(100vh - 80px)'};
const welcome={padding:'30px 4px 28px'};
const eyebrow={fontSize:11,letterSpacing:2,textTransform:'uppercase',color:'rgba(255,255,255,.35)',marginBottom:10};
const heading={fontSize:'clamp(36px,8vw,58px)',lineHeight:1.05,letterSpacing:'-.04em',color:'#f7f7f7',margin:0,fontWeight:600};
const subheading={margin:'10px 0 0',fontSize:17,color:'rgba(255,255,255,.48)'};
const ariaCard={width:'100%',display:'flex',alignItems:'center',gap:14,padding:'18px',borderRadius:26,border:'1px solid rgba(255,255,255,.11)',background:'linear-gradient(135deg,rgba(255,255,255,.065),rgba(255,255,255,.025))',color:'#fff',cursor:'pointer',boxShadow:'0 18px 55px rgba(0,0,0,.16)'};
const ariaOrb={width:44,height:44,borderRadius:16,display:'grid',placeItems:'center',background:'rgba(255,255,255,.07)',border:'1px solid rgba(255,255,255,.1)',fontSize:13,letterSpacing:2,color:'#fff',flexShrink:0};
const ariaLabel={fontSize:10,letterSpacing:2,color:'rgba(255,255,255,.35)',marginBottom:5};
const ariaTitle={fontSize:16,fontWeight:600};
const ariaSub={fontSize:12,color:'rgba(255,255,255,.4)',marginTop:4};
const arrow={fontSize:28,color:'rgba(255,255,255,.35)'};
const tools={marginTop:34};
const toolsHead={display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:10,letterSpacing:2,color:'rgba(255,255,255,.3)',marginBottom:10};
const toolGrid={display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:9};
const tool={minHeight:92,padding:'14px',display:'flex',alignItems:'center',gap:10,borderRadius:21,border:'1px solid rgba(255,255,255,.08)',background:'rgba(255,255,255,.035)',color:'#fff',cursor:'pointer',transition:'transform .2s ease,background .2s ease'};
const toolActive={background:'rgba(255,255,255,.08)',borderColor:'rgba(255,255,255,.18)'};
const toolAttention={borderColor:'rgba(212,175,55,.3)'};
const toolIcon={width:31,height:31,borderRadius:11,display:'grid',placeItems:'center',background:'rgba(255,255,255,.06)',color:'rgba(255,255,255,.7)',fontSize:17,flexShrink:0};
const toolArrow={fontSize:20,color:'rgba(255,255,255,.25)'};
const comingSoon={margin:'34px 0 0',padding:'26px 22px',borderRadius:26,border:'1px solid rgba(143,183,255,.1)',background:'linear-gradient(145deg,rgba(143,183,255,.045),rgba(255,255,255,.018))'};
const comingEyebrow={fontSize:10,letterSpacing:2,color:'#8fb7ff'};
const modalOverlay={position:'fixed',inset:0,zIndex:3000,background:'rgba(2,5,12,.78)',backdropFilter:'blur(18px)',padding:12};
const reviewShell={height:'100%',maxWidth:960,margin:'0 auto',overflow:'auto'};
const overlay={position:'fixed',inset:0,zIndex:2000,background:'rgba(3,7,18,.82)',backdropFilter:'blur(22px)',padding:12};
const experience={height:'100%',maxWidth:920,margin:'0 auto',borderRadius:30,background:'#0a1128',border:'1px solid rgba(255,255,255,.1)',overflow:'auto',boxShadow:'0 30px 100px rgba(0,0,0,.45)'};
const header={position:'sticky',top:0,zIndex:2,display:'flex',alignItems:'center',gap:14,padding:'18px 20px',background:'rgba(10,17,40,.9)',backdropFilter:'blur(18px)',borderBottom:'1px solid rgba(255,255,255,.06)'};
const close={width:40,height:40,border:0,borderRadius:'50%',background:'rgba(255,255,255,.07)',color:'#fff',fontSize:25,cursor:'pointer'};
const org={fontSize:15,color:'#f5f5f5',fontWeight:550};
const content={padding:'30px 22px 70px'};
const ask={maxWidth:680,margin:'9vh auto 0'};
const choice={display:'flex',gap:10,flexWrap:'wrap',marginTop:26};
const primary={border:0,borderRadius:999,padding:'12px 20px',background:'#f5f5f5',color:'#0a1128',fontWeight:600,cursor:'pointer'};
const secondary={border:'1px solid rgba(255,255,255,.12)',borderRadius:999,padding:'12px 20px',background:'rgba(255,255,255,.05)',color:'#fff',cursor:'pointer'};
const briefHeader={display:'flex',gap:14,alignItems:'center',marginBottom:22};
const small={fontSize:11,letterSpacing:1.5,color:'rgba(255,255,255,.35)'};
const queue={display:'grid',gap:10,marginTop:24};
const priorityCard={display:'flex',gap:16,padding:'20px',borderRadius:24,background:'rgba(255,255,255,.045)',border:'1px solid rgba(255,255,255,.075)'};
const number={fontSize:12,color:'rgba(255,255,255,.25)',paddingTop:3};
const label={fontSize:10,letterSpacing:1.4,color:'rgba(255,255,255,.34)'};
const quiet={padding:30,textAlign:'center',color:'rgba(255,255,255,.45)'};
const loadingCard={height:150,borderRadius:24,background:'rgba(255,255,255,.045)'};
const empty={paddingTop:100,color:'#fff'};

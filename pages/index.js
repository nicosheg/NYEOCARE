// pages/index.js
import{useEffect,useState}from'react';
import{useRouter}from'next/router';
import{supabase}from'../lib/supabaseClient';
import Layout from'../components/Layout';
import ScanModal from'../components/ScanModal';
import AttendanceModal from'../components/AttendanceModal';
import ReviewCenterTab from'../components/ReviewCenterTab';

const greeting=()=>{const h=new Date().getHours();return h>=5&&h<12?'Good morning.':h>=12&&h<17?'Good afternoon.':h>=17&&h<21?'Good evening.':'Good night.'};

export default function ARIAHome(){
const router=useRouter();
const[data,setData]=useState(null),[loading,setLoading]=useState(true),[briefOpen,setBriefOpen]=useState(false),[scan,setScan]=useState(false),[attendance,setAttendance]=useState(false),[review,setReview]=useState(false),[live,setLive]=useState(false),[reviewCount,setReviewCount]=useState(0),[timeGreeting,setTimeGreeting]=useState(greeting());
const load=async()=>{try{const{data:{session}}=await supabase.auth.getSession();if(!session){await router.replace('/login');return}const h={Authorization:`Bearer ${session.access_token}`};const[a,b,c]=await Promise.all([fetch('/api/daily-briefing/latest',{headers:h}),fetch('/api/attendance/active-session',{headers:h}),fetch('/api/identity/review-items',{headers:h})]);if(a.ok)setData(await a.json());if(b.ok){const d=await b.json();setLive(!!d.active)}if(c.ok){const d=await c.json();setReviewCount(Number(d.stats?.total)||d.items?.length||0)}}catch(e){console.error('[ARIA Today]',e)}finally{setLoading(false)}};
useEffect(()=>{let active=true;const run=()=>{if(active){setTimeGreeting(greeting());load()}};run();const t=setInterval(run,30000);return()=>{active=false;clearInterval(t)}},[]);
if(loading)return <Layout><main style={shell}><div style={loadingBlock}/></main></Layout>;
if(!data)return <Layout><main style={shell}><section style={unavailable}><div style={ariaWord}>ARIA</div><h1>ARIA is unavailable right now.</h1><button style={retry} onClick={()=>{setLoading(true);load()}}>Try again</button></section></main></Layout>;
const notification=data.notification||{},items=data.briefing?.items||[],count=Number(notification.count)||items.length;
return <Layout><main style={shell}>
<section style={welcome}><div style={eyebrow}>NYEOCARE</div><h1 style={heading}>{timeGreeting}</h1><p style={subheading}>ARIA is here.</p></section>
<button style={briefCard} onClick={()=>setBriefOpen(true)}><div style={briefOrb}>A</div><div style={briefCopy}><div style={ariaLabel}>ARIA</div><strong>{notification.hasSomething?'I have something for you today.':'I’m keeping watch today.'}</strong><span>{count?`${count} thing${count===1?'':'s'} worth seeing.`:'Nothing needs your attention right now.'}</span></div><div style={arrow}>›</div></button>
<section style={tools}><div style={toolGrid}><ActionButton icon="＋" title="Scan" onClick={()=>setScan(true)}/><ActionButton icon="◉" title={live?'Attendance · LIVE':'Attendance'} onClick={()=>setAttendance(true)} active={live}/><ActionButton icon="✓" title={reviewCount?`Review · ${reviewCount}`:'Review'} onClick={()=>setReview(true)} attention={reviewCount>0}/></div></section>
<section style={coming}><span>ARIA · COMING SOON</span><p>Soon, you won’t have to search for what matters. You’ll just talk to her.</p></section>
{briefOpen&&<BriefingModal data={data} onClose={()=>setBriefOpen(false)}/>}
<ScanModal isOpen={scan} onClose={()=>{setScan(false);load()}}/>
<AttendanceModal isOpen={attendance} onClose={()=>{setAttendance(false);load()}}/>
{review&&<div style={modalOverlay}><div style={reviewShell}><ReviewCenterTab modal onClose={()=>{setReview(false);load()}}/></div></div>}
</main></Layout>}

function ActionButton({icon,title,onClick,active,attention}){return <button style={{...tool,...(active?toolActive:{}),...(attention?toolAttention:{})}} onClick={onClick}><span style={toolIcon}>{icon}</span><span>{title}</span><b>›</b></button>}

function BriefingModal({data,onClose}){const items=data.briefing?.items||[];return <div style={modalOverlay}><div style={briefingModal}><header style={modalHeader}><div><div style={eyebrow}>ARIA · TODAY</div><h2>Daily briefing</h2></div><button style={close} onClick={onClose}>×</button></header><section style={briefingBody}><div style={briefLead}>{data.briefing?.headline||'ARIA is keeping watch.'}</div>{items.length?<div style={briefList}>{items.map((item,i)=><BriefItem key={`${item.id||item.person_id||i}`} item={item} index={i}/>)}</div>:<div style={quiet}>Nothing needs your immediate attention right now. I’ll keep watching.</div>}</section></div></div>}

function BriefItem({item,index}){const name=item.first_name||item.last_name?`${item.first_name||''} ${item.last_name||''}`.trim():'';const detail=item.evidence?.summary||item.metadata?.summary||item.action_metadata?.summary||item.type||'Something worth your attention.';return <article style={briefItem}><span>{String(index+1).padStart(2,'0')}</span><div><small>{item.category==='care'?'CARE':item.category==='relationship'?'RELATIONSHIP':'PEOPLE'}</small><strong>{name||'Something worth your attention'}</strong><p>{detail}</p></div></article>}

const shell={maxWidth:760,margin:'0 auto',padding:'42px 22px 110px',minHeight:'calc(100vh - 80px)'};
const welcome={padding:'34px 8px 30px'};
const eyebrow={fontSize:10,letterSpacing:2.2,textTransform:'uppercase',color:'rgba(255,255,255,.32)',marginBottom:10};
const heading={fontSize:'clamp(40px,10vw,60px)',lineHeight:1.02,letterSpacing:'-.045em',color:'#f7f7f7',margin:0,fontWeight:600};
const subheading={margin:'10px 0 0',fontSize:16,color:'rgba(255,255,255,.42)'};
const briefCard={width:'100%',display:'flex',alignItems:'center',gap:14,padding:'19px',borderRadius:25,border:'1px solid rgba(255,255,255,.1)',background:'linear-gradient(145deg,rgba(255,255,255,.065),rgba(255,255,255,.025))',color:'#fff',cursor:'pointer',textAlign:'left',boxShadow:'0 18px 60px rgba(0,0,0,.16)'};
const briefOrb={width:45,height:45,borderRadius:16,display:'grid',placeItems:'center',background:'rgba(255,255,255,.065)',border:'1px solid rgba(255,255,255,.09)',fontSize:13,letterSpacing:2,flexShrink:0};
const briefCopy={minWidth:0,flex:1,display:'grid',gap:4};
const ariaLabel={fontSize:10,letterSpacing:2,color:'rgba(255,255,255,.32)'};
const arrow={fontSize:28,color:'rgba(255,255,255,.3)',paddingLeft:4};
const tools={marginTop:58};
const toolGrid={display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:10};
const tool={minWidth:0,height:58,padding:'10px 12px',display:'flex',alignItems:'center',justifyContent:'center',gap:8,borderRadius:18,border:'1px solid rgba(255,255,255,.075)',background:'rgba(255,255,255,.032)',color:'rgba(255,255,255,.82)',cursor:'pointer',fontSize:13,fontWeight:600};
const toolActive={background:'rgba(255,255,255,.07)',borderColor:'rgba(255,255,255,.15)'};
const toolAttention={borderColor:'rgba(212,175,55,.3)'};
const toolIcon={fontSize:15,color:'rgba(255,255,255,.55)'};
const coming={marginTop:150,textAlign:'center',maxWidth:430,marginLeft:'auto',marginRight:'auto',padding:'0 10px'};
const modalOverlay={position:'fixed',inset:0,zIndex:3000,background:'rgba(2,5,12,.8)',backdropFilter:'blur(20px)',padding:12};
const reviewShell={height:'100%',maxWidth:960,margin:'0 auto',overflow:'auto'};
const briefingModal={height:'100%',maxWidth:720,margin:'0 auto',borderRadius:30,background:'#0a1128',border:'1px solid rgba(255,255,255,.1)',overflow:'auto',boxShadow:'0 30px 100px rgba(0,0,0,.45)'};
const modalHeader={position:'sticky',top:0,zIndex:2,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'20px 22px',background:'rgba(10,17,40,.9)',backdropFilter:'blur(18px)',borderBottom:'1px solid rgba(255,255,255,.06)'};
const close={width:40,height:40,border:0,borderRadius:'50%',background:'rgba(255,255,255,.07)',color:'#fff',fontSize:25,cursor:'pointer'};
const briefingBody={padding:'28px 22px 60px'};
const briefLead={fontSize:21,lineHeight:1.35,color:'#f5f5f5',marginBottom:24};
const briefList={display:'grid',gap:10};
const briefItem={display:'flex',gap:16,padding:'18px',borderRadius:21,border:'1px solid rgba(255,255,255,.075)',background:'rgba(255,255,255,.035)'};
const quiet={padding:'35px 10px',textAlign:'center',color:'rgba(255,255,255,.4)',lineHeight:1.6};
const loadingBlock={height:180,borderRadius:25,background:'rgba(255,255,255,.04)'};
const unavailable={paddingTop:100,color:'#fff'};
const ariaWord={fontSize:12,letterSpacing:4,color:'rgba(255,255,255,.35)'};
const retry={marginTop:20,padding:'10px 16px',borderRadius:999,border:'1px solid rgba(255,255,255,.12)',background:'rgba(255,255,255,.05)',color:'#fff',cursor:'pointer'};

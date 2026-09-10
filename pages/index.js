// pages/index.js
import{useEffect,useState}from'react';
import{useRouter}from'next/router';
import{createPortal}from'react-dom';
import{supabase}from'../lib/supabaseClient';
import{useOnboarding}from'../components/OnboardingProvider';
import Layout from'../components/Layout';
import FirstExperience from'../components/FirstExperience';
import ScanModal from'../components/ScanModal';
import AttendanceModal from'../components/AttendanceModal';
import ReviewCenterTab from'../components/ReviewCenterTab';

const greeting=()=>{const h=new Date().getHours();return h>=5&&h<12?'Good morning.':h>=12&&h<17?'Good afternoon.':h>=17&&h<21?'Good evening.':'Good night.'};

export default function ARIAHome(){
const router=useRouter(),onboarding=useOnboarding();
const[data,setData]=useState(null),[loading,setLoading]=useState(true),[briefOpen,setBriefOpen]=useState(false),[scan,setScan]=useState(false),[attendance,setAttendance]=useState(false),[review,setReview]=useState(false),[live,setLive]=useState(false),[reviewCount,setReviewCount]=useState(0),[timeGreeting,setTimeGreeting]=useState(greeting());

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
}catch(e){console.error('[ARIA Today]',e)}
finally{setLoading(false)}
};

useEffect(()=>{
let active=true;
const run=()=>{if(active){setTimeGreeting(greeting());load()}};
run();
const t=setInterval(run,30000);
return()=>{active=false;clearInterval(t)}
},[]);

if(loading)return <Layout><main style={shell}><div style={loadingBlock}/></main></Layout>;

if(!data)return <Layout><main style={shell}><section style={unavailable}><div style={ariaWord}>ARIA</div><h1>ARIA is unavailable right now.</h1><button style={retry} onClick={()=>{setLoading(true);load()}}>Try again</button></section></main></Layout>;

const notification=data.notification||{},items=data.briefing?.items||[],count=Number(notification.count)||items.length;
const showHome=onboarding?.loaded&&onboarding.enabled&&!onboarding.isExperienced('home');
const showScan=onboarding?.loaded&&onboarding.enabled&&!onboarding.isExperienced('scan')&&!scan;
const showReview=onboarding?.loaded&&onboarding.enabled&&!onboarding.isExperienced('review')&&!review;

const handleBriefAction=item=>{
setBriefOpen(false);
const action=item?.action;
if(action?.type==='review'){setReview(true);return}
if(action?.href)router.push(action.href);
};

return <Layout><main style={shell}>
{showHome&&<FirstExperience experience="home" onComplete={()=>onboarding.completeExperience('home')}/>}
{showScan&&<FirstExperience experience="scan" onComplete={()=>onboarding.completeExperience('scan')} onAction={()=>setScan(true)}/>}
{showReview&&<FirstExperience experience="review" onComplete={()=>onboarding.completeExperience('review')} onAction={()=>setReview(true)}/>}

<section style={welcome}>
<div style={eyebrow}>NYEOCARE</div>
<h1 style={heading}>{timeGreeting}</h1>
<p style={subheading}>ARIA is here.</p>
</section>

<button style={briefCard} onClick={()=>setBriefOpen(true)}>
<div style={briefOrb}>A</div>
<div style={briefCopy}>
<div style={ariaLabel}>ARIA</div>
<strong>{notification.hasSomething?'I have something concrete for you today.':'I’m keeping watch today.'}</strong>
<span>{count?`${count} item${count===1?'':'s'} with a clear next step.`:'Nothing needs your attention right now.'}</span>
</div>
<div style={arrow}>›</div>
</button>

<section style={tools}>
<div style={toolGrid}>
<ActionButton icon="＋" title="Scan" onClick={()=>setScan(true)}/>
<ActionButton icon="◉" title={live?'Attendance · LIVE':'Attendance'} onClick={()=>setAttendance(true)} active={live}/>
<ActionButton icon="✓" title={reviewCount?`Review · ${reviewCount}`:'Review'} onClick={()=>setReview(true)} attention={reviewCount>0}/>
</div>
</section>

<section style={coming}>
<div className="ariaMaterial" aria-hidden="true">
<span className="materialCore"/>
<span className="materialFold materialFoldA"/>
<span className="materialFold materialFoldB"/>
<span className="materialLight"/>
</div>
<div style={comingLabel}>ARIA · COMING SOON</div>
<p>Soon, you won’t have to search for what matters. You’ll just talk to her.</p>
</section>

{briefOpen&&<BriefingModal data={data} onClose={()=>setBriefOpen(false)} onAction={handleBriefAction}/>}
<ScanModal isOpen={scan} onClose={()=>{setScan(false);load()}}/>
<AttendanceModal isOpen={attendance} onClose={()=>{setAttendance(false);load()}}/>
{review&&<ModalPortal><div style={modalOverlay}><div style={reviewShell}><ReviewCenterTab modal onClose={()=>{setReview(false);load()}}/></div></div></ModalPortal>}

<style jsx>{`
.ariaMaterial{position:relative;width:118px;height:64px;margin:0 auto 15px;transform:translateZ(0);filter:drop-shadow(0 16px 26px rgba(0,0,0,.28));animation:materialFloat 8s ease-in-out infinite}
.materialCore{position:absolute;inset:9px 21px;border-radius:45% 55% 48% 52%;background:radial-gradient(ellipse at 38% 28%,rgba(255,255,255,.22),transparent 17%),radial-gradient(ellipse at 52% 48%,rgba(143,175,214,.22),rgba(19,35,57,.58) 53%,rgba(3,9,18,.84) 100%);border:1px solid rgba(230,241,253,.18);box-shadow:inset 7px 7px 18px rgba(255,255,255,.08),inset -10px -12px 22px rgba(0,0,0,.4),0 0 28px rgba(143,175,214,.08);animation:materialBreathe 6s ease-in-out infinite}
.materialFold{position:absolute;top:16px;width:52px;height:31px;border-radius:55% 45% 48% 52%;background:linear-gradient(125deg,rgba(238,245,252,.18),rgba(143,175,214,.06) 48%,rgba(2,8,17,.5));border:1px solid rgba(245,248,252,.11);mix-blend-mode:screen}
.materialFoldA{left:5px;transform:rotate(18deg);animation:foldA 7s ease-in-out infinite}
.materialFoldB{right:5px;transform:rotate(-18deg);animation:foldB 8s ease-in-out infinite}
.materialLight{position:absolute;left:50%;top:50%;width:24px;height:24px;border-radius:50%;transform:translate(-50%,-50%);background:radial-gradient(circle,rgba(232,212,154,.5),rgba(214,184,106,.08) 40%,transparent 72%);filter:blur(5px);animation:materialLight 5.5s ease-in-out infinite}
@keyframes materialFloat{0%,100%{transform:translate3d(0,0,0) rotate(-1deg)}50%{transform:translate3d(0,-4px,0) rotate(1deg)}}
@keyframes materialBreathe{0%,100%{transform:scaleX(.97) scaleY(.96)}50%{transform:scaleX(1.03) scaleY(1.04)}}
@keyframes foldA{0%,100%{transform:rotate(18deg) translate(0,0)}50%{transform:rotate(12deg) translate(4px,-2px)}}
@keyframes foldB{0%,100%{transform:rotate(-18deg) translate(0,0)}50%{transform:rotate(-12deg) translate(-4px,-2px)}}
@keyframes materialLight{0%,100%{opacity:.3;transform:translate(-50%,-50%) scale(.7)}50%{opacity:.72;transform:translate(-50%,-50%) scale(1.15)}}
html[data-nyeo-weather="rain"] .ariaMaterial,html[data-nyeo-weather="storm"] .ariaMaterial{filter:drop-shadow(0 16px 28px rgba(0,0,0,.36)) drop-shadow(0 0 18px rgba(143,175,214,.08))}
html[data-nyeo-time="night"] .materialLight{opacity:.8}
@media(max-height:700px){
.ariaMaterial{height:48px;width:100px;margin-bottom:8px}
.materialCore{inset:7px 18px}
.materialFold{top:12px;width:45px;height:25px}
.coming p{margin-top:6px!important;font-size:12px!important}
}
@media(max-width:380px){
.shell{padding-left:15px!important;padding-right:15px!important}
}
@media(prefers-reduced-motion:reduce){
.ariaMaterial,.materialCore,.materialFold,.materialLight{animation:none!important}
}
`}</style>
</main></Layout>
}

function ModalPortal({children}){if(typeof document==='undefined')return null;return createPortal(children,document.body)}

function ActionButton({icon,title,onClick,active,attention}){
return <button style={{...tool,...(active?toolActive:{}),...(attention?toolAttention:{})}} onClick={onClick}><span style={toolIcon}>{icon}</span><span>{title}</span><b>›</b></button>
}

function BriefingModal({data,onClose,onAction}){
const items=data.briefing?.items||[];
return <ModalPortal><div style={modalOverlay}><div style={briefingModal}>
<header style={modalHeader}>
<div><div style={eyebrow}>ARIA · TODAY</div><h2>Daily briefing</h2></div>
<button style={close} onClick={onClose}>×</button>
</header>
<section style={briefingBody}>
<div style={briefLead}>{data.briefing?.headline||'ARIA is keeping watch.'}</div>
{items.length?<div style={briefList}>{items.map((item,i)=><BriefItem key={`${item.id||item.person_id||i}`} item={item} index={i} onAction={()=>onAction(item)}/>)}</div>:<div style={quiet}>Nothing needs your immediate attention right now. I’ll keep watching.</div>}
</section>
</div></div></ModalPortal>
}

function BriefItem({item,index,onAction}){
return <button style={briefItem} onClick={onAction}>
<span style={number}>{String(index+1).padStart(2,'0')}</span>
<div style={briefContent}>
<small>{item.label||'ARIA'}</small>
<strong>{item.title||'ARIA attention'}</strong>
<p>{item.message||'Open this item to see the next step.'}</p>
<span style={actionText}>{item.action?.label||'Open'} →</span>
</div>
</button>
}

const shell={maxWidth:760,margin:'0 auto',padding:'24px 20px 96px',height:'calc(100dvh - 80px)',minHeight:'540px',overflow:'hidden',position:'relative',zIndex:1};
const welcome={padding:'24px 8px 20px'};
const eyebrow={fontSize:10,letterSpacing:2.2,textTransform:'uppercase',color:'var(--ny-text-whisper)',marginBottom:9};
const heading={fontSize:'clamp(38px,10vw,58px)',lineHeight:.98,letterSpacing:'-.045em',color:'var(--ny-text)',margin:0,fontWeight:600};
const subheading={margin:'9px 0 0',fontSize:15,color:'var(--ny-text-muted)'};
const briefCard={width:'100%',display:'flex',alignItems:'center',gap:12,padding:'14px 15px',borderRadius:'var(--ny-radius-card)',border:'1px solid var(--ny-border)',background:'linear-gradient(145deg,rgba(255,255,255,.06),rgba(255,255,255,.025))',color:'var(--ny-text)',cursor:'pointer',textAlign:'left',boxShadow:'var(--ny-shadow-lg)',backdropFilter:'blur(18px)'};
const briefOrb={width:40,height:40,borderRadius:14,display:'grid',placeItems:'center',background:'rgba(255,255,255,.055)',border:'1px solid var(--ny-border)',fontSize:12,letterSpacing:2,flexShrink:0,color:'var(--ny-text)'};
const briefCopy={minWidth:0,flex:1,display:'grid',gap:3};
const ariaLabel={fontSize:9,letterSpacing:2,color:'var(--ny-text-whisper)'};
const arrow={fontSize:25,color:'var(--ny-text-muted)',paddingLeft:4};
const tools={marginTop:28};
const toolGrid={display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:9};
const tool={minWidth:0,height:52,padding:'8px 9px',display:'flex',alignItems:'center',justifyContent:'center',gap:6,borderRadius:'var(--ny-radius-button)',border:'1px solid var(--ny-border-subtle)',background:'rgba(255,255,255,.03)',color:'var(--ny-text-secondary)',cursor:'pointer',fontSize:11.5,fontWeight:600,backdropFilter:'blur(14px)'};
const toolActive={background:'rgba(127,191,154,.08)',borderColor:'rgba(127,191,154,.28)',color:'var(--ny-success)'};
const toolAttention={borderColor:'var(--ny-gold-border)',color:'var(--ny-gold-soft)'};
const toolIcon={fontSize:14,color:'inherit'};
const coming={position:'absolute',left:20,right:20,bottom:8,textAlign:'center',maxWidth:430,margin:'0 auto',padding:'0 10px'};
const comingLabel={fontSize:9,letterSpacing:2.1,color:'var(--ny-text-whisper)'};
const modalOverlay={position:'fixed',inset:0,zIndex:100000,background:'rgba(2,5,12,.8)',backdropFilter:'blur(20px)',padding:12};
const reviewShell={height:'100%',maxWidth:960,margin:'0 auto',overflow:'auto'};
const briefingModal={height:'100%',maxWidth:720,margin:'0 auto',borderRadius:'var(--ny-radius-major)',background:'var(--ny-surface)',border:'1px solid var(--ny-border)',overflow:'auto',boxShadow:'var(--ny-shadow-xl)'};
const modalHeader={position:'sticky',top:0,zIndex:2,display:'flex',alignItems:'center',justifyContent:'space-between',padding:'16px 18px',background:'rgba(11,19,38,.9)',backdropFilter:'blur(18px)',borderBottom:'1px solid var(--ny-border-subtle)'};
const close={width:38,height:38,border:0,borderRadius:'50%',background:'rgba(255,255,255,.07)',color:'var(--ny-text)',fontSize:24,cursor:'pointer'};
const briefingBody={padding:'20px 18px 45px'};
const briefLead={fontSize:16,lineHeight:1.4,color:'var(--ny-text)',marginBottom:15};
const briefList={display:'grid',gap:7};
const briefItem={width:'100%',display:'flex',gap:11,padding:'12px 13px',borderRadius:'var(--ny-radius-button)',border:'1px solid var(--ny-border-subtle)',background:'rgba(255,255,255,.035)',cursor:'pointer',outline:'none',color:'var(--ny-text)',textAlign:'left'};
const number={fontSize:10,color:'var(--ny-text-whisper)',paddingTop:3,flexShrink:0};
const briefContent={minWidth:0,display:'grid',gap:3};
const actionText={fontSize:11,color:'var(--ny-aria)',fontWeight:600,marginTop:3};
const quiet={padding:'30px 10px',textAlign:'center',color:'var(--ny-text-muted)',lineHeight:1.6};
const loadingBlock={height:180,borderRadius:'var(--ny-radius-major)',background:'rgba(255,255,255,.04)'};
const unavailable={paddingTop:100,color:'var(--ny-text)'};
const ariaWord={fontSize:12,letterSpacing:4,color:'var(--ny-text-muted)'};
const retry={marginTop:20,padding:'10px 16px',borderRadius:999,border:'1px solid var(--ny-border)',background:'rgba(255,255,255,.05)',color:'var(--ny-text)',cursor:'pointer'};

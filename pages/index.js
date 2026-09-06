// pages/index.js
import{useEffect,useMemo,useState}from'react';
import{useRouter}from'next/router';
import{supabase}from'../lib/supabaseClient';
import Layout from'../components/Layout';
import AriaVoice from'../components/AriaVoice';

export default function ARIAHome(){
 const router=useRouter(),[data,setData]=useState(null),[loading,setLoading]=useState(true),[open,setOpen]=useState(false),[brief,setBrief]=useState(false);

 const load=async()=>{
  try{
   const{data:{session}}=await supabase.auth.getSession();
   if(!session){await router.replace('/login');return}
   const res=await fetch('/api/daily-briefing/latest',{headers:{Authorization:`Bearer ${session.access_token}`}});
   if(!res.ok)throw Error('ARIA Today failed to load');
   setData(await res.json());
  }catch(err){console.error('[ARIA Today]',err)}
  finally{setLoading(false)}
 };

 useEffect(()=>{
  let active=true;
  const run=async()=>{if(active)await load()};
  run();
  const timer=setInterval(()=>run(),60000);
  return()=>{active=false;clearInterval(timer)};
 },[]);

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
  parts.push('I recommend reviewing these items and deciding what you would like to do next.');
  return parts.join(' ');
 },[data]);

 if(loading)return <Layout><div style={shell}><div style={loadingCard}/></div></Layout>;

 if(!data)return <Layout><div style={shell}><div style={empty}><div style={logo}>ARIA</div><h1>ARIA is unavailable right now.</h1><p>Please try again.</p></div></div></Layout>;

 const notification=data.notification||{hasSomething:false,text:'ARIA is keeping watch today.'};

 return <Layout>
  <main style={shell}>
   <section style={welcome}>
    <div style={eyebrow}>NYEOCARE</div>
    <h1 style={heading}>Good day.</h1>
    <p style={subheading}>ARIA is here and keeping watch.</p>
   </section>

   <button style={notificationCard} onClick={()=>{setOpen(true);setBrief(false)}}>
    <div style={notificationDot}/>
    <div style={{flex:1,textAlign:'left'}}>
     <div style={notificationTitle}>{notification.text||'ARIA has something for you today.'}</div>
     <div style={notificationSub}>{notification.hasSomething?`${notification.count||1} thing${notification.count===1?'':'s'} worth seeing today.`:'Nothing urgent right now. ARIA is still watching.'}</div>
    </div>
    <div style={arrow}>›</div>
   </button>

   {open&&<AriaExperience data={data} briefing={briefing} brief={brief} setBrief={setBrief} onClose={()=>{setOpen(false);setBrief(false)}}/>}
  </main>
 </Layout>
}

function AriaExperience({data,briefing,brief,setBrief,onClose}){
 const items=data.briefing?.items||[];
 return <div style={overlay}>
  <div style={experience}>
   <header style={header}>
    <button style={close} onClick={onClose}>×</button>
    <div>
     <div style={eyebrow}>ARIA · TODAY</div>
     <div style={org}>{data.organization?.name||'Your organization'}</div>
    </div>
   </header>

   <div style={content}>
    {!brief&&<section style={ask}>
     <div style={ariaMark}>ARIA</div>
     <h1>{data.notification?.hasSomething?'I have something for you today.':'I’m keeping watch today.'}</h1>
     <p>{data.briefing?.headline||'Nothing needs your immediate attention right now.'}</p>
     {data.notification?.hasSomething&&<div style={choice}>
      <button style={primary} onClick={()=>setBrief(true)}>Yes, brief me</button>
      <button style={secondary} onClick={onClose}>Not now</button>
     </div>}
     {!data.notification?.hasSomething&&<button style={secondary} onClick={onClose}>Close</button>}
    </section>}

    {brief&&<section>
     <div style={briefHeader}>
      <div style={ariaMark}>ARIA</div>
      <div>
       <div style={small}>DAILY BRIEFING</div>
       <h1>Here is what matters today.</h1>
      </div>
     </div>

     <AriaVoice briefingText={briefing}/>

     <div style={queue}>
      {items.map((item,i)=><Priority key={`${item.category||'item'}:${item.id||item.person_id||i}`} item={item} index={i}/>)}
      {!items.length&&<div style={quiet}>ARIA has nothing urgent to bring to you right now. I’ll keep watching.</div>}
     </div>
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

const shell={maxWidth:860,margin:'0 auto',padding:'34px 20px 80px',minHeight:'calc(100vh - 80px)'};
const welcome={padding:'30px 4px 30px'};
const eyebrow={fontSize:11,letterSpacing:2,textTransform:'uppercase',color:'rgba(255,255,255,.35)',marginBottom:10};
const heading={fontSize:'clamp(34px,8vw,58px)',lineHeight:1.05,letterSpacing:'-.04em',color:'#f7f7f7',margin:0,fontWeight:600};
const subheading={margin:'10px 0 0',fontSize:17,color:'rgba(255,255,255,.48)'};
const notificationCard={width:'100%',display:'flex',alignItems:'center',gap:14,padding:'16px 18px',borderRadius:22,border:'1px solid rgba(255,255,255,.1)',background:'rgba(255,255,255,.045)',color:'#fff',cursor:'pointer'};
const notificationDot={width:9,height:9,borderRadius:'50%',background:'#fff',boxShadow:'0 0 14px rgba(255,255,255,.5)',flexShrink:0};
const notificationTitle={fontSize:16,fontWeight:600};
const notificationSub={fontSize:12,color:'rgba(255,255,255,.42)',marginTop:4};
const arrow={fontSize:28,color:'rgba(255,255,255,.4)'};
const overlay={position:'fixed',inset:0,zIndex:2000,background:'rgba(3,7,18,.82)',backdropFilter:'blur(22px)',padding:12};
const experience={height:'100%',maxWidth:920,margin:'0 auto',borderRadius:30,background:'#0a1128',border:'1px solid rgba(255,255,255,.1)',overflow:'auto',boxShadow:'0 30px 100px rgba(0,0,0,.45)'};
const header={position:'sticky',top:0,zIndex:2,display:'flex',alignItems:'center',gap:14,padding:'18px 20px',background:'rgba(10,17,40,.9)',backdropFilter:'blur(18px)',borderBottom:'1px solid rgba(255,255,255,.06)'};
const close={width:40,height:40,border:0,borderRadius:'50%',background:'rgba(255,255,255,.07)',color:'#fff',fontSize:25,cursor:'pointer'};
const org={fontSize:15,color:'#f5f5f5',fontWeight:550};
const content={padding:'30px 22px 70px'};
const ask={maxWidth:680,margin:'9vh auto 0'};
const ariaMark={fontSize:12,letterSpacing:2,textTransform:'uppercase',color:'rgba(255,255,255,.38)',marginBottom:12};
const askH={};
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
const logo={letterSpacing:3,color:'rgba(255,255,255,.4)'};

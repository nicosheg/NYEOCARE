// components/OperatorExperiencePulse.js
import{useEffect,useState}from'react';
import{getClientSession}from'../lib/clientSession';

const QUESTIONS=[
 {key:'ease_score',label:'NYEOCARE makes my responsibilities easier to manage.'},
 {key:'clarity_score',label:'I understand what I am expected to do in NYEOCARE.'},
 {key:'confidence_score',label:'I feel confident using NYEOCARE.'}
];

export default function OperatorExperiencePulse(){
 const[status,setStatus]=useState('loading');
 const[scores,setScores]=useState({ease_score:0,clarity_score:0,confidence_score:0});
 const[busy,setBusy]=useState(false);
 const[error,setError]=useState('');
 useEffect(()=>{
  let active=true;
  (async()=>{
   try{
    const session=await getClientSession();
    if(!session?.access_token)throw new Error('Sign in again to share feedback.');
    const response=await fetch('/api/operator-pulse',{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'Unable to check the weekly pulse.');
    if(active)setStatus(data.due?'ready':'hidden');
   }catch(e){if(active){console.warn('[OPERATOR PULSE]',e.message);setStatus('hidden')}}
  })();
  return()=>{active=false};
 },[]);
 const update=(key,value)=>setScores(prev=>({...prev,[key]:value}));
 const send=async action=>{
  if(busy)return;
  if(action==='submit'&&QUESTIONS.some(q=>!scores[q.key])){setError('Please answer all three questions.');return;}
  setBusy(true);setError('');
  try{
   const session=await getClientSession();
   if(!session?.access_token)throw new Error('Sign in again to continue.');
   const response=await fetch('/api/operator-pulse',{
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+session.access_token},
    body:JSON.stringify(action==='dismiss'?{action:'dismiss'}:{action:'submit',...scores})
   });
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(data.error||'Your feedback could not be saved.');
   setStatus(action==='submit'?'thank-you':'hidden');
  }catch(e){setError(e.message||'Your feedback could not be saved.')}
  finally{setBusy(false)}
 };
 if(status==='loading'||status==='hidden')return null;
 return <section className="pulseRoot" aria-label="Weekly operator experience pulse">
  {status==='thank-you'?<div className="pulseThanks" role="status"><span className="pulseEyebrow">THANK YOU</span><strong>Your feedback will help make the work clearer.</strong><p>Your response is linked to your account to prevent duplicates. Leadership sees team-level summaries only.</p></div>:<>
   <div className="pulseHeader"><div><span className="pulseEyebrow">A WEEKLY CHECK-IN</span><h2>How is the work feeling?</h2></div><span className="pulseTime">About 20 seconds</span></div>
   <p className="pulseIntro">There is no score for you. Tell us where NYEOCARE is helping and where it needs to improve.</p>
   <div className="pulseQuestions">{QUESTIONS.map(question=><div className="pulseQuestion" key={question.key}>
    <div className="pulseQuestionLabel">{question.label}</div>
    <div className="pulseScale" role="group" aria-label={question.label}>
     {[1,2,3,4,5].map(value=><button type="button" key={value} aria-pressed={scores[question.key]===value} aria-label={String(value)+' out of 5'} onClick={()=>update(question.key,value)} disabled={busy} className={scores[question.key]===value?'chosen':''}>{value}</button>)}
    </div>
    <div className="pulseScaleLegend"><span>Not at all</span><span>Very much</span></div>
   </div>)}</div>
   {error&&<div className="pulseError" role="alert">{error}</div>}
   <div className="pulseFooter"><p>Your response is linked to your account so you only answer once per week. Leadership sees combined averages only. You can skip this week's check-in.</p><div><button type="button" className="pulseSkip" onClick={()=>send('dismiss')} disabled={busy}>Not now</button><button type="button" className="pulseSubmit" onClick={()=>send('submit')} disabled={busy}>{busy?'Saving…':'Share feedback'}</button></div></div>
  </>}
  <style jsx>{`
   .pulseRoot{margin:15px 0 2px;padding:16px 16px 14px;border:1px solid rgba(143,175,214,.13);border-radius:20px;background:linear-gradient(145deg,rgba(143,175,214,.065),rgba(255,255,255,.018));}
   .pulseHeader{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
   .pulseEyebrow{font-size:8px;letter-spacing:.2em;color:var(--ny-aria);font-weight:700}
   h2{margin:5px 0 0;color:var(--ny-text);font-size:17px;letter-spacing:-.02em;font-weight:620}
   .pulseTime{margin-top:4px;color:var(--ny-text-whisper);font-size:9px;white-space:nowrap}
   .pulseIntro{margin:8px 0 13px;color:var(--ny-text-muted);font-size:11px;line-height:1.55}
   .pulseQuestions{display:grid;gap:11px}
   .pulseQuestion{padding-top:10px;border-top:1px solid var(--ny-border-subtle)}
   .pulseQuestionLabel{color:var(--ny-text-secondary);font-size:11px;line-height:1.45;margin-bottom:7px}
   .pulseScale{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:7px}
   .pulseScale button{min-height:35px;border:1px solid var(--ny-border);border-radius:11px;background:rgba(255,255,255,.025);color:var(--ny-text-muted);font:inherit;font-size:12px;cursor:pointer}
   .pulseScale button.chosen{border-color:rgba(143,175,214,.5);background:rgba(143,175,214,.15);color:#d9e7fa}
   .pulseScale button:disabled{opacity:.6}
   .pulseScaleLegend{display:flex;justify-content:space-between;margin-top:4px;color:var(--ny-text-whisper);font-size:8px}
   .pulseFooter{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px;padding-top:11px;border-top:1px solid var(--ny-border-subtle)}
   .pulseFooter p{max-width:230px;margin:0;color:var(--ny-text-whisper);font-size:9px;line-height:1.45}
   .pulseFooter>div{display:flex;align-items:center;gap:8px;flex-shrink:0}
   .pulseSkip,.pulseSubmit{padding:8px 12px;border-radius:999px;font:inherit;font-size:10px;font-weight:650;cursor:pointer}
   .pulseSkip{border:1px solid var(--ny-border-subtle);background:transparent;color:var(--ny-text-muted)}
   .pulseSubmit{border:1px solid rgba(143,175,214,.28);background:rgba(143,175,214,.13);color:#dce9fa}
   .pulseSubmit:disabled,.pulseSkip:disabled{opacity:.5;cursor:default}
   .pulseError{margin-top:10px;color:#f2a0a0;font-size:11px}
   .pulseThanks{display:grid;gap:5px}
   .pulseThanks strong{color:var(--ny-text);font-size:13px;font-weight:600}
   .pulseThanks p{margin:0;color:var(--ny-text-muted);font-size:10px;line-height:1.5}
   @media(max-width:400px){.pulseFooter{align-items:flex-start;flex-direction:column}.pulseFooter p{max-width:none}.pulseFooter>div{width:100%;justify-content:flex-end}}
  `}</style>
 </section>;
}

// components/FirstExperience.js
import{useEffect,useState}from'react';
import{supabase}from'../lib/supabaseClient';

const EXPERIENCE_COPY={
home:{eyebrow:'A small beginning',title:'Let ARIA help you remember.',body:'Start with the people in your organization. ARIA will help you notice what matters and what may need your attention.',action:'Start with your people'},
scan:{eyebrow:'Your first step',title:'Give ARIA your register.',body:'Take a clear photo of your register. ARIA will turn it into a living memory of the people you know.',action:'Scan the register'},
people:{eyebrow:'Your people',title:'This is where your people live.',body:'Every person ARIA remembers belongs here. Tap a person to enter their journey. ARIA keeps their history, present state and what may come next connected.',action:'Explore your people'},
'person-journey':{eyebrow:'A person, not a card',title:'Meet the journey ARIA remembers.',body:'This is the living record for one person. Confirmed facts, memories, observations, relationships, participation and prepared actions stay connected here. ARIA does not invent what it does not know.',action:'Continue'},
review:{eyebrow:'When ARIA is unsure',title:'You stay in control.',body:'When something needs your decision, ARIA brings it here. Nothing important is silently changed without you.',action:'Got it'},
profile:{eyebrow:'Make ARIA yours',title:'Tell ARIA what to keep in mind.',body:'You can give ARIA a simple message about your organization. You can change it whenever your needs change.',action:'Continue'}
};

export default function FirstExperience({experience,onComplete,onAction}){
const[visible,setVisible]=useState(false);
const[saving,setSaving]=useState(false);
const copy=EXPERIENCE_COPY[experience];

useEffect(()=>{
if(!copy)return;
const timer=setTimeout(()=>setVisible(true),180);
return()=>clearTimeout(timer);
},[copy]);

if(!copy||!visible)return null;

const complete=async()=>{
if(saving)return;
setSaving(true);
try{
const{data:{session}}=await supabase.auth.getSession();
if(!session)return;
const response=await fetch('/api/onboarding',{
method:'POST',
headers:{'Content-Type':'application/json',Authorization:`Bearer ${session.access_token}`},
body:JSON.stringify({action:'experience_completed',experience})
});
if(!response.ok)throw new Error('Unable to save onboarding progress');
onComplete?.();
onAction?.();
}catch(error){
console.error('[ONBOARDING] Experience completion error:',error);
}finally{
setSaving(false);
}
};

return <div className="experienceOverlay">
<div className="experienceCard">
<div className="experienceGlow"/>
<div className="experienceContent">
<div className="eyebrow">{copy.eyebrow}</div>
<h2>{copy.title}</h2>
<p>{copy.body}</p>
<button onClick={complete} disabled={saving} className="experienceButton">{saving?'One moment…':copy.action}</button>
</div>
</div>
<style jsx>{`
.experienceOverlay{position:fixed;inset:0;z-index:9500;display:flex;align-items:flex-end;justify-content:center;padding:24px;pointer-events:none}
.experienceCard{position:relative;width:min(620px,100%);overflow:hidden;pointer-events:auto;border:1px solid rgba(255,255,255,.08);border-radius:28px;background:rgba(12,17,29,.96);backdrop-filter:blur(30px);box-shadow:0 30px 100px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.04);animation:experienceIn .55s cubic-bezier(.22,1,.36,1)}
.experienceGlow{position:absolute;width:280px;height:280px;top:-180px;left:50%;transform:translateX(-50%);border-radius:50%;background:rgba(212,175,55,.09);filter:blur(30px)}
.experienceContent{position:relative;padding:32px}
.eyebrow{color:#d4af37;font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;margin-bottom:12px}
h2{color:#f4f4f4;font-size:27px;line-height:1.2;margin:0 0 12px;font-weight:600}
p{color:rgba(255,255,255,.64);font-size:16px;line-height:1.7;margin:0 0 24px;max-width:520px}
.experienceButton{border:1px solid rgba(212,175,55,.25);background:rgba(212,175,55,.1);color:#d4af37;border-radius:28px;padding:13px 22px;font-size:15px;font-weight:500;cursor:pointer}
.experienceButton:disabled{opacity:.5;cursor:default}
@keyframes experienceIn{from{opacity:0;transform:translateY(30px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}
@media(max-width:600px){.experienceOverlay{padding:14px}.experienceContent{padding:26px 22px}h2{font-size:24px}}
`}</style>
</div>;
  }

// components/FirstExperience.js
import{useEffect,useState}from'react';
import{supabase}from'../lib/supabaseClient';

const STEP_META={home:'1 of 3',scan:'2 of 3',review:'3 of 3',people:'1 of 1','person-journey':'1 of 1',profile:'1 of 1'};

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
.experienceOverlay{position:fixed;inset:0;z-index:9500;display:flex;align-items:center;justify-content:center;padding:18px;pointer-events:none;background:rgba(3,7,16,.68);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);animation:experienceBackdropIn .35s ease-out}
.experienceCard{position:relative;width:min(540px,100%);overflow:hidden;pointer-events:auto;border:1px solid rgba(255,255,255,.11);border-radius:30px;background:linear-gradient(155deg,rgba(17,25,42,.98),rgba(8,13,24,.98));box-shadow:0 34px 110px rgba(0,0,0,.58),inset 0 1px 0 rgba(255,255,255,.06);animation:experienceIn .55s cubic-bezier(.22,1,.36,1)}
.experienceGlow{position:absolute;width:330px;height:330px;top:-235px;left:50%;transform:translateX(-50%);border-radius:50%;background:rgba(214,184,106,.12);filter:blur(36px)}\n.experienceMark{position:absolute;top:22px;right:22px;width:38px;height:38px;border-radius:13px;display:grid;place-items:center;border:1px solid rgba(214,184,106,.18);background:rgba(214,184,106,.07);color:#e8d49a;font-size:12px;letter-spacing:2px;box-shadow:0 0 24px rgba(214,184,106,.07)}
.experienceContent{position:relative;padding:34px 32px 32px}.experienceTop{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-right:48px}.step{font-size:10px;color:rgba(255,255,255,.32);letter-spacing:.08em;white-space:nowrap}
.eyebrow{color:#d6b86a;font-size:11px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;margin-bottom:0}
h2{color:#f4f4f4;font-size:clamp(25px,6vw,31px);line-height:1.12;letter-spacing:-.025em;margin:18px 0 12px;font-weight:620}
p{color:rgba(255,255,255,.64);font-size:15px;line-height:1.7;margin:0 0 26px;max-width:520px}
.experienceButton{border:1px solid rgba(214,184,106,.34);background:linear-gradient(180deg,rgba(214,184,106,.16),rgba(214,184,106,.08));color:#ead79f;border-radius:999px;padding:13px 22px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 8px 26px rgba(0,0,0,.18);transition:transform .2s ease,background .2s ease,border-color .2s ease}.experienceButton:hover{transform:translateY(-1px);background:rgba(214,184,106,.2);border-color:rgba(214,184,106,.5)}
.experienceButton:disabled{opacity:.5;cursor:default}
@keyframes experienceBackdropIn{from{opacity:0}to{opacity:1}}\n@keyframes experienceIn{from{opacity:0;transform:translateY(24px) scale(.975)}to{opacity:1;transform:translateY(0) scale(1)}}
@media(max-width:600px){.experienceOverlay{padding:14px}.experienceCard{border-radius:26px}.experienceContent{padding:30px 22px 24px}.experienceMark{top:18px;right:18px;width:34px;height:34px}.experienceTop{padding-right:42px}h2{font-size:25px;margin-top:16px}.experienceButton{width:100%;padding:14px 20px}}
`}</style>
</div>;
  }

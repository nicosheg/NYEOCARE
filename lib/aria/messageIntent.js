// lib/aria/messageIntent.js
import{inferCohortFromText}from'./cohortIntent.js';

const clean=(v,max=500)=>String(v??'').trim().replace(/\s+/g,' ').slice(0,max);

function inferPurpose(text){
 const thank=/\bthank(?:s|ed|ing| you)?\b|\bappreciat(?:e|ed|ing|ion)\b/i.test(text);
 const attended=/\b(attended|came|joined|were with us|participated|showed up)\b/i.test(text);
 const absent=/\b(didn[’']?t|did not|wasn[’']?t|were not|weren[’']?t|absent|missed|couldn[’']?t make it|could not make it)\b[\s\S]{0,80}\b(attend|come|service|program|event|gathering|make it)\b/i.test(text)
   ||/\b(absentees?|people who missed|those who missed|didn[’']?t attend)\b/i.test(text);
 const follow=/\b(follow[ -]?up|check[ -]?in|care|show(?:ing)?[^.?!]{0,40}care|reach out)\b/i.test(text);
 const next=/\b(next|upcoming|coming up|tomorrow|later this week|this (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i.test(text)
   ||/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(text);

 if(thank&&attended&&next)return'attendance_thanks_next_event';
 if(thank&&attended)return'attendance_thanks';
 if(absent&&follow)return'absence_follow_up';
 if(absent)return'absence_follow_up';
 if(next&&thank&&attended)return'attendance_thanks_next_event';
 if(next)return'next_event_invite';
 if(follow)return'follow_up';
 return'general';
}

function extractNextEventHint(input){
 const text=String(input||'');
 const match=text.match(/\b(?:next|upcoming|coming up)\s+(?:service|event|program)\b[^.!?\n]{0,180}/i);
 const weekday=text.match(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b(?:\s*\([^)]*\))?/i);
 const tomorrow=/\btomorrow\b/i.test(text);
 return{
  hint:clean(match?.[0]||'',300)||null,
  day_hint:clean(weekday?.[0]||(tomorrow?'tomorrow':''),80)||null,
  raw_instruction:clean(text,500)
 };
}

export function inferMessageDraftIntent(input){
 const text=clean(input,4000);
 if(!/\bdraft\b|\bprepare\b|\bwrite\b[\s\S]*\bmessage\b/i.test(text))return{match:false};
 const cohort=inferCohortFromText(text);
 const purpose=inferPurpose(text);
 const context=extractNextEventHint(text);
 const channel=/\bwhatsapp\b/i.test(text)?'whatsapp':'app';
 return{
  match:true,
  cohort:cohort.key||null,
  count:cohort.count,
  all:Boolean(cohort.all),
  purpose,
  channel,
  messageContext:{
   ...context,
   purpose,
   requested_cohort:cohort.key||null,
   requested_count:cohort.count||null
  }
 };
}

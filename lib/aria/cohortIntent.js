// lib/aria/cohortIntent.js
// Legacy cohort vocabulary retained: past_absentees.

export function inferCohortFromText(input){
 const text=String(input||'').toLowerCase();
 let key=null;
 if(/past absentees|recent absentees|people who missed|those who were absent|absentees/.test(text)||/(?:everyone|everybody|all(?: the)? people).*?(?:mentioned|told you).*?(?:yesterday|earlier).*?(?:didn[’']?t|did not|were not|weren[’']?t).*?(?:attend|attendance|service)/.test(text)||/(?:people|everyone|those).*?(?:didn[’']?t|did not).*?(?:attend|attendance|service)/.test(text))key='last_event_absentees';
 else if(/(?:everyone|everybody|all(?: the)? people).*?(?:attended|came|joined|participated)|(?:people|everyone|those).*?(?:attended|came|joined|participated).*?(?:last|latest|most recent).*?(?:service|program|event|gathering)|(?:everyone|everybody|all(?: the)? people).*?(?:last|latest|most recent).*?(?:service|program|event|gathering)/.test(text))key='last_event_attendees';
 else if(/everyone in (?:the )?(?:system|organization)|all people|all members|everyone|everybody/.test(text)&&!/(?:didn[’']?t|did not|absent|missed)/.test(text))key='all_people';
 else if(/who needs follow[- ]?up|people who need follow[- ]?up|needs follow[- ]?up|people needing follow[- ]?up/.test(text))key='needs_follow_up';
 else if(/who needs attention|current attention|people needing attention/.test(text))key='current_attention';
 else if(/new people|newly known|new relationships|newcomers/.test(text))key='new_people';
 const countMatch=text.match(/\b(?:for|to)\s+(\d+)\s+(?:people|persons|members)\b/);
 const count=countMatch?Math.min(Math.max(Number(countMatch[1])||0,1),100):null;
 const all=/\b(all|everyone|everybody|all of them)\b/.test(text);
 return{key,count,all};
}

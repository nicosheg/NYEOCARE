// scripts/aria-message-drafting-regression.js
import{inferMessageDraftIntent}from'../lib/aria/messageIntent.js';

const cases=[
 {
  input:"Draft a follow-up message for everyone who didn't attend showing them we care",
  cohort:'last_event_absentees',
  purpose:'absence_follow_up',
  channel:'app'
 },
 {
  input:"Draft a message for everyone who attended the last program thanking them for attending and suggesting the next service coming up on Tuesday (tomorrow)",
  cohort:'last_event_attendees',
  purpose:'attendance_thanks_next_event',
  day:'Tuesday (tomorrow)'
 },
 {
  input:"Draft a WhatsApp follow-up for everyone in the system",
  cohort:'all_people',
  purpose:'follow_up',
  channel:'whatsapp'
 }
];

for(const test of cases){
 const result=inferMessageDraftIntent(test.input);
 if(!result.match)throw new Error('Did not recognize: '+test.input);
 if(result.cohort!==test.cohort)throw new Error('Wrong cohort for '+test.input+': '+result.cohort);
 if(result.purpose!==test.purpose)throw new Error('Wrong purpose for '+test.input+': '+result.purpose);
 if(test.channel&&result.channel!==test.channel)throw new Error('Wrong channel for '+test.input+': '+result.channel);
 if(test.day&&result.messageContext?.day_hint!=='Tuesday (tomorrow)')throw new Error('Missing day hint for '+test.input);
}

console.log('ARIA message drafting regression passed.');

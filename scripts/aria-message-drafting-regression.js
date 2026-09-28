// scripts/aria-message-drafting-regression.js
import fs from'fs';import path from'path';
import{inferMessageDraftIntent}from'../lib/aria/messageIntent.js';
import{normalizeWhatsAppPhone,whatsappChatUrl,getAddressName,personalizeWhatsAppMessage,getWhatsAppPhone}from'../lib/aria/whatsapp.js';

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

const valid=normalizeWhatsAppPhone('+2348032173632');
if(!valid.valid||valid.waNumber!=='2348032173632')throw new Error('Valid Nigerian WhatsApp number normalization failed.');
const invalid=normalizeWhatsAppPhone('+2342067841674');
if(invalid.valid)throw new Error('Invalid Nigerian mobile range was accepted.');
if(whatsappChatUrl('+2342067841674','Hello'))throw new Error('Invalid WhatsApp number produced a chat URL.');
const bro={display_name:'Bro Eze',first_name:'Eze',last_name:'',metadata:{honorific:'Bro'}};
if(getAddressName(bro)!=='Bro Eze')throw new Error('Honorific addressing failed.');
const personalized=personalizeWhatsAppMessage('Hello Blessing, Hi Blessing, thank you for being with us.',bro);
if(!personalized.startsWith('Hello Bro Eze,'))throw new Error('Message personalization did not replace the model salutation.');
if(/Blessing/i.test(personalized))throw new Error('Wrong recipient name survived personalization.');

const alternate=getWhatsAppPhone({phone:'+2342067841674',phone_numbers:[{normalized:'+2348032173632'}]});
if(!alternate.valid||alternate.waNumber!=='2348032173632')throw new Error('Safe alternate WhatsApp phone candidate was not selected.');
const root=process.cwd(),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const ariaPage=read('pages/aria.js');
for(const needle of ['WHATSAPP_SESSION_KEY','startWhatsAppSession','openWhatsAppFromSession','pageshow','Auto-next ON','Start WhatsApp','pendingReturn']){
 if(!ariaPage.includes(needle))throw new Error('pages/aria.js is missing WhatsApp session contract: '+needle);
}

const batch=read('lib/aria/batchDraftEngine.js'),draft=read('lib/aria/draftEngine.js'),queue=read('pages/api/aria/drafts.js');
for(const [file,...needles] of [
 ['lib/aria/batchDraftEngine.js','whatsapp_v3','phone_not_safe_for_whatsapp','duplicate_whatsapp_recipient'],
 ['lib/aria/draftEngine.js','whatsapp_v3','personalizeWhatsAppMessage','metadata->>\'draft_version\'','address_name'],
 ['pages/api/aria/drafts.js','whatsapp_v2','needs_phone_review_count','whatsappChatUrl']
]){
 const content=read(file);
 for(const needle of needles)if(!content.includes(needle))throw new Error(file+' is missing '+needle);
}
console.log('ARIA message drafting + WhatsApp handoff regression passed.');

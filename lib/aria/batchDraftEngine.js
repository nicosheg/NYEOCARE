import{createHash}from'crypto';
import{createCareDraft}from'./draftEngine';
import{getWhatsAppPhone,getAddressName}from'./whatsapp.js';

const DRAFT_VERSION='whatsapp_v3';

function prepareRecipients(people,channel){
 const seenIds=new Set(),seenPhones=new Set(),ready=[],skipped=[];
 for(const raw of Array.isArray(people)?people:[]){
  const id=String(raw?.person_id||raw?.id||'').trim();
  if(!id||seenIds.has(id))continue;
  seenIds.add(id);
  const person={...raw,person_id:id};
  if(channel==='whatsapp'){
   const selected=getWhatsAppPhone(person);
   const phone=selected.raw||null;
   const normalized=selected;
   if(!normalized.valid){
    skipped.push({person_id:id,name:getAddressName(person),phone:phone||null,reason:'phone_not_safe_for_whatsapp',detail:normalized.reason});
    continue;
   }
   if(seenPhones.has(normalized.waNumber)){
    skipped.push({person_id:id,name:getAddressName(person),phone:phone||null,reason:'duplicate_whatsapp_recipient',detail:'Another selected person already uses this WhatsApp number.'});
    continue;
   }
   seenPhones.add(normalized.waNumber);
  }
  ready.push(person);
  if(ready.length>=100)break;
 }
 return{ready,skipped};
}

export async function createCareDraftBatch({organizationId,people=[],actionType='thoughtful_check_in',actorId=null,idempotencyKey=null,messagePurpose=null,messageContext=null,channel='whatsapp',cohortKey=null,draftVersion=DRAFT_VERSION}){
 if(!organizationId)throw new Error('organizationId is required');
 const prepared=prepareRecipients(people,channel==='whatsapp'?'whatsapp':'app');
 const list=prepared.ready;
 const skipped=prepared.skipped;
 if(!list.length)return{batchId:idempotencyKey||null,count:0,requested_count:Array.isArray(people)?people.length:0,drafts:[],skipped_count:skipped.length,skipped,whatsappNote:channel==='whatsapp'?'No recipients had a phone number that could be safely opened in WhatsApp. The held records need phone review.':null};
 const contextHash=createHash('sha1').update(JSON.stringify({messagePurpose:messagePurpose||actionType,messageContext:messageContext||{},cohortKey:cohortKey||'selected'})).digest('hex').slice(0,12);
 const batchId=idempotencyKey||'care-draft-batch:'+draftVersion+':'+contextHash+':'+list.map(x=>x.person_id).sort().join(',')+':'+(messagePurpose||actionType)+':'+(cohortKey||'selected');
 const drafts=[];
 for(let i=0;i<list.length;i+=4){
  const chunk=list.slice(i,i+4);
  const results=await Promise.all(chunk.map(async person=>{
   try{
    const draft=await createCareDraft({
     organizationId,
     personId:person.person_id,
     actionId:person.action_id||null,
     actionType,
     actorId,
     approvedOnly:false,
     idempotencyKey:batchId+':'+person.person_id,
     batchId,
     messagePurpose:messagePurpose||actionType,
     messageContext:{...(messageContext||{}),source_session:messageContext?.source_session||null,cohort_key:cohortKey||null},
     channel:channel==='whatsapp'?'whatsapp':'app',
     draftVersion
    });
    return{
     person_id:person.person_id,
     name:draft.addressName||getAddressName(person),
     message:draft.message,
     whatsappUrl:draft.whatsappUrl||null,
     whatsappReady:Boolean(draft.whatsappReady),
     communication_id:draft.communication?.id||null
    };
   }catch(error){
    return{
     person_id:person.person_id,
     name:getAddressName(person),
     message:null,
     whatsappUrl:null,
     whatsappReady:false,
     error:String(error?.message||'Unable to prepare this draft.').slice(0,300)
    };
   }
  }));
  drafts.push(...results);
 }
 const readyDrafts=drafts.filter(x=>x.message);
 return{
  batchId,
  count:readyDrafts.length,
  requested_count:Array.isArray(people)?people.length:0,
  drafted_count:readyDrafts.length,
  skipped_count:skipped.length,
  skipped,
  drafts,
  whatsappNote:channel==='whatsapp'
   ?`WhatsApp handoff ready for ${readyDrafts.length} people. Each one opens that recipient's WhatsApp chat with the personalized draft already in the message box; you review and send it yourself. NYEOCARE never sends automatically.${skipped.length?` ${skipped.length} selected record${skipped.length===1?'':'s'} were held back because their phone number could not be safely normalized for WhatsApp.`:''}`
   :'Drafts are saved in NYEOCARE for human review.',
  queueId:batchId,
  draft_version:draftVersion
 };
}

import{createCareDraft}from'./draftEngine';

const uniquePeople=people=>{
 const seen=new Set(),out=[];
 for(const p of Array.isArray(people)?people:[]){
  const id=String(p?.person_id||p?.id||'').trim();
  if(!id||seen.has(id))continue;
  seen.add(id);out.push({...p,person_id:id});
  if(out.length>=50)break;
 }
 return out;
};

export async function createCareDraftBatch({organizationId,people=[],actionType='thoughtful_check_in',actorId=null,idempotencyKey=null}){
 if(!organizationId)throw new Error('organizationId is required');
 const list=uniquePeople(people);
 if(!list.length)return{batchId:idempotencyKey||null,count:0,drafts:[],whatsappNote:null};
 const batchId=idempotencyKey||'care-draft-batch:'+list.map(x=>x.person_id).sort().join(',')+':'+actionType;
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
     idempotencyKey:batchId+':'+person.person_id
    });
    return{
     person_id:person.person_id,
     name:person.name||person.display_name||null,
     message:draft.message,
     whatsappUrl:draft.whatsappUrl||null,
     communication_id:draft.communication?.id||null
    };
   }catch(error){
    return{
     person_id:person.person_id,
     name:person.name||person.display_name||null,
     message:null,
     whatsappUrl:null,
     error:String(error?.message||'Unable to prepare this draft.').slice(0,300)
    };
   }
  }));
  drafts.push(...results);
 }
 return{
  batchId,
  count:drafts.filter(x=>x.message).length,
  requested_count:list.length,
  drafts,
  whatsappNote:'WhatsApp can open each recipient chat with the message pre-filled. You can edit and send each message there. NYEOCARE does not send them automatically.'
 };
}

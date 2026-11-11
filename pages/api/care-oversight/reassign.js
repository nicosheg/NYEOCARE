// pages/api/care-oversight/reassign.js
import {withAdmin} from '../../../lib/apiHelpers';
import {reassignDailyQueueItem} from '../../../lib/dailyQueue';

export default withAdmin(async function handler(req,res){
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Method not allowed'});}
 const queueItemId=String(req.body?.queue_item_id||'').trim();
 const targetUserId=String(req.body?.target_user_id||'').trim();
 const reason=String(req.body?.reason||'').trim().slice(0,500);
 if(!queueItemId||!targetUserId)return res.status(400).json({error:'Choose a responsibility and an active operator.'});
 try{
  const result=await reassignDailyQueueItem({orgId:req.org.id,actorUserId:req.user.id,actorRole:req.user.role,queueItemId,targetUserId,reason});
  if(!result.ok){
   const status=result.code==='TARGET_OPERATOR_UNAVAILABLE'||result.code==='QUEUE_ITEM_NOT_FOUND'?404:result.code==='FORBIDDEN'?403:409;
   const messages={
    QUEUE_ITEM_NOT_FOUND:'That responsibility could not be found in this organization.',
    FORBIDDEN:'You cannot reassign this responsibility.',
    QUEUE_ITEM_NOT_REASSIGNABLE:'That responsibility has already changed or is not eligible for reassignment.',
    TARGET_OPERATOR_UNAVAILABLE:'That operator is no longer available.',
    ALREADY_ASSIGNED:'That responsibility is already assigned to this operator.'
   };
   return res.status(status).json({error:messages[result.code]||'The responsibility could not be reassigned.',code:result.code});
  }
  return res.status(200).json({success:true,assigned_to:result.operator});
 }catch(error){
  console.error('[CARE OVERSIGHT] reassignment failed:',error?.message||error);
  return res.status(500).json({error:'NYEOCARE could not safely reassign this responsibility.'});
 }
});

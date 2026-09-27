import {withOrg} from '../../../lib/apiHelpers';
import {markInternalMessageSeen} from '../../../lib/aria/internalMessaging';

export default withOrg(async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const messageId=String(req.body?.message_id||'').trim();
 const queueItemId=String(req.body?.queue_item_id||'').trim()||null;
 if(!messageId)return res.status(400).json({error:'message_id required'});
 try{
  const result=await markInternalMessageSeen({
   organizationId:req.org.id,
   recipientUserId:req.user.id,
   messageId,
   queueItemId
  });
  if(!result.ok){
   if(result.code==='MESSAGE_UNSENT')return res.status(409).json({error:'That message was unsent before you opened it.',message:result.message});
   return res.status(404).json({error:'Message not found.'});
  }
  return res.status(200).json({success:true,message:result.message});
 }catch(err){
  console.error('[ARIA] internal message read',err);
  return res.status(500).json({error:'Unable to mark this message as seen.'});
 }
});

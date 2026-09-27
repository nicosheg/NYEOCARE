// pages/api/daily-queue/defer.js
import { withOrg } from '../../../lib/apiHelpers';
import { deferDailyQueueItem } from '../../../lib/dailyQueue';

export default withOrg(async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 const queueItemId=String(req.body?.queue_item_id||'').trim();
 if(!queueItemId)return res.status(400).json({error:'Missing queue_item_id',code:'QUEUE_ITEM_ID_MISSING'});
 try{
  const result=await deferDailyQueueItem({orgId:req.org.id,userId:req.user.id,queueItemId});
  if(!result.ok)return res.status(404).json({error:'This queue item is no longer on your daily queue.',code:result.code});
  return res.status(200).json({ok:true,queue_date:result.queue_date,defer_count:result.defer_count});
 }catch(err){
  console.error('[ARIA TODAY] Defer error:',err?.message||err);
  return res.status(500).json({error:'ARIA could not move this item safely. Nothing was changed.'});
 }
});
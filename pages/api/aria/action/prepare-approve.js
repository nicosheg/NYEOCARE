// pages/api/aria/action/prepare-approve.js
import{withAdmin}from'../../../../lib/apiHelpers';
import{prepareAndApproveAction}from'../../../../lib/aria/recommendationEngine';

export default withAdmin(async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 try{
  const{personId,actionType='SEND_MESSAGE',priority='medium',metadata={}}=req.body||{};
  if(!personId)return res.status(400).json({error:'personId required'});
  const action=await prepareAndApproveAction({organizationId:req.org.id,personId,actionType,priority,actionMetadata:metadata,actorId:req.user.id});
  return res.status(200).json({success:true,action});
 }catch(e){console.error('[ARIA] prepare-approve',e);return res.status(e.status||409).json({error:e.message||'Unable to prepare and approve action.'});}
});

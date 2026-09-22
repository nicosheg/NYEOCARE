// pages/api/aria/draft.js
import{withAdmin}from'../../../lib/apiHelpers';
import{createCareDraft}from'../../../lib/aria/draftEngine';

export default withAdmin(async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 try{
  const{personId,actionId,actionType,approvedOnly=false}=req.body||{};
  if(!personId)return res.status(400).json({error:'personId required'});
  const result=await createCareDraft({organizationId:req.org.id,personId,actionId,actionType,actorId:req.user.id,approvedOnly:Boolean(approvedOnly)});
  return res.status(200).json({success:true,...result});
 }catch(e){
  console.error('[ARIA] draft',e);
  return res.status(e.status||500).json({error:e.message||'Unable to prepare care draft.'});
 }
});

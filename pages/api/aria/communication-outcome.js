// pages/api/aria/communication-outcome.js
import{withOrg}from'../../../lib/apiHelpers';
import{recordCommunicationOutcome}from'../../../lib/aria/communicationOutcome';

export default withOrg(async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 try{
  const{person_id,channel='whatsapp',direction='outbound',status,content=null,subject=null,external_id=null,action_id=null,metadata={}}=req.body||{};
  if(!person_id||!status)return res.status(400).json({error:'person_id and status are required'});
  const result=await recordCommunicationOutcome({organizationId:req.org.id,personId:person_id,channel,direction,status,content,subject,externalId:external_id,actorId:req.user.id,actionId:action_id,metadata});
  return res.status(200).json({success:true,...result});
 }catch(err){
  console.error('[ARIA] communication outcome',err);
  return res.status(err.status||500).json({error:err.message||'Unable to record communication outcome.'});
 }
});
// pages/api/aria/communication-outcome.js
import{withOrg}from'../../../lib/apiHelpers';
import{recordCommunicationOutcome}from'../../../lib/aria/communicationOutcome';

export default withOrg(async function handler(req,res){
 if(req.method!=='POST'){
  res.setHeader('Allow','POST');
  return res.status(405).json({error:'Method not allowed'});
 }
 try{
  const{person_id,channel='whatsapp',direction='outbound',status,content=null,subject=null,external_id=null,action_id=null,metadata={}}=req.body||{};
  if(!person_id||!status)return res.status(400).json({error:'person_id and status are required'});
  const result=await recordCommunicationOutcome({organizationId:req.org.id,personId:person_id,channel,direction,status,content,subject,externalId:external_id,actorId:req.user.id,actionId:action_id,metadata});
  return res.status(200).json({success:true,...result});
 }catch(err){
  console.error('[ARIA] communication outcome',err);
  const status=Number(err?.status)||500;
  return res.status(status).json({error:status<500?String(err.message||'Invalid communication outcome.'): 'Could not record communication outcome.'});
 }
});

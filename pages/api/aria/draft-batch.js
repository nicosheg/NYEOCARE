import{withOrg}from'../../../lib/apiHelpers';
import{executeCapability}from'../../../lib/aria/capabilityEngine';

export default withOrg(async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 try{
  const body=req.body||{};
  const personIds=Array.isArray(body.personIds)?body.personIds:body.person_id?[body.person_id]:null;
  const result=await executeCapability({
   organizationId:req.org.id,
   capability:'draft_message_cohort',
   parameters:{
    personIds,
    cohort:body.cohort||'current_attention',
    limit:body.limit==null?10:body.limit,
    all:Boolean(body.all),
    actionType:body.actionType||'thoughtful_check_in',
    channel:body.channel==='whatsapp'?'whatsapp':'app'
   },
   actorId:req.user.id
  });
  return res.status(200).json({success:true,...result});
 }catch(e){
  console.error('[ARIA] draft batch',e);
  const status=[400,401,403,404,409].includes(Number(e.status))?Number(e.status):500;
  return res.status(status).json({error:status<500?String(e.message||'Unable to prepare drafts.'):'Unable to prepare drafts right now.'});
 }
});

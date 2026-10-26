// pages/api/care-feedback.js
import{withOrg}from'../../lib/apiHelpers';
import{isOrganizationOperator}from'../../lib/attendance/access';
import{recordCareFeedback,getCareFeedback}from'../../lib/aria/feedbackEngine';

async function handler(req,res){
 const organizationId=req.org.id;
 if(!isOrganizationOperator(req.user?.role))return res.status(403).json({error:'Care feedback is limited to authorized organization operators.'});
 try{
  if(req.method==='GET'){
   const personId=String(req.query.person_id||'');
   if(!personId)return res.status(400).json({error:'person_id is required'});
   return res.status(200).json(await getCareFeedback({organizationId,personId,limit:100}));
  }
  if(req.method==='POST'){
   const{person_id,action_id,feedback_type,sentiment,note,context,observed_at}=req.body||{};
   if(!person_id||!feedback_type)return res.status(400).json({error:'person_id and feedback_type are required'});
   const result=await recordCareFeedback({organizationId,personId:person_id,actionId:action_id||null,feedbackType:feedback_type,sentiment:sentiment||'neutral',note,context,observedAt:observed_at||null,actorId:req.user.id});
   return res.status(201).json({success:true,...result});
  }
  res.setHeader('Allow','GET,POST');
  return res.status(405).json({error:'Method not allowed'});
 }catch(err){
  console.error('[CARE FEEDBACK]',err);
  return res.status(err.status||500).json({error:err.message||'Unable to process care feedback.'});
 }
}

export default withOrg(handler);

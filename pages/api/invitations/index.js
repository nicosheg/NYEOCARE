// pages/api/invitations/index.js
import{withAdmin}from'../../../lib/apiHelpers';
import{listOrganizationAccess,manageOrganizationAccess}from'../../../lib/organizationAccessEngine';

export default withAdmin(async function handler(req,res){
 try{
  if(req.method==='GET'){
   const result=await listOrganizationAccess({organizationId:req.org.id,actorId:req.user.id});
   return res.status(200).json(result.invitations);
  }
  if(req.method==='DELETE'){
   const id=String(req.query?.id||'').trim();
   if(!id)return res.status(400).json({error:'Missing invitation ID.'});
   const result=await manageOrganizationAccess({organizationId:req.org.id,actorId:req.user.id,operation:'revoke_invitation',invitationId:id,confirmed:true});
   return res.status(200).json({success:true,invitation:result.invitation});
  }
  res.setHeader('Allow','GET, DELETE');
  return res.status(405).end();
 }catch(error){
  console.error('[INVITATIONS]',error?.message||error);
  const status=Number(error?.status)||500;
  return res.status(status).json({error:status<500?(error.message||'Unable to update invitation.'):'Unable to update invitation.',code:error?.code||'INVITATION_MUTATION_FAILED'});
 }
});
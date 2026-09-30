// pages/api/users/invite.js
import{withOrg}from'../../../lib/apiHelpers';
import{createOrganizationInvite}from'../../../lib/organizationMutationEngine';

export default withOrg(async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 if(!['owner','admin'].includes(req.user.role))return res.status(403).json({error:'Only owners and admins can invite users.'});
 const role=req.body?.role;
 try{
  const appUrl=(process.env.NEXT_PUBLIC_APP_URL||process.env.NEXT_PUBLIC_SITE_URL||`${req.headers['x-forwarded-proto']||'https'}://${req.headers.host}`).replace(/\/$/,'');
  const invite=await createOrganizationInvite({organizationId:req.org.id,userId:req.user.id,role,appUrl});
  return res.status(200).json({success:true,role:invite.role,expires_at:invite.expires_at,url:invite.url});
 }catch(error){
  console.error('[INVITE]',error?.message||error);
  const status=Number(error?.status)||500;
  return res.status(status).json({error:status<500?(error.message||'Invalid invitation request.'):'Unable to create invitation.',code:error?.code||'INVITE_CREATE_FAILED'});
 }
});
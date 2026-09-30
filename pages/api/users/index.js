// pages/api/users/index.js
import{withOrg}from'../../../lib/apiHelpers';
import{listOrganizationAccess,createOrganizationInviteCanonical}from'../../../lib/organizationAccessEngine';

export default withOrg(async function handler(req,res){
 const orgId=req.org.id,user=req.user;
 try{
  if(req.method==='GET'){
   const result=await listOrganizationAccess({organizationId:orgId,actorId:user.id});
   return res.status(200).json({users:result.users,invitations:result.invitations});
  }
  if(req.method==='POST'){
   if(!['owner','admin'].includes(user.role))return res.status(403).json({error:'Only owners and admins can invite people.'});
   const{name,role}=req.body||{};
   if(typeof name==='string'&&!name.trim())return res.status(400).json({error:'Please provide the person’s name.'});
   if(!['admin','user'].includes(String(role||'').toLowerCase()))return res.status(400).json({error:'Invalid invitation role.'});
   const appUrl=(process.env.NEXT_PUBLIC_APP_URL||process.env.NEXT_PUBLIC_SITE_URL||`${req.headers['x-forwarded-proto']||'https'}://${req.headers.host}`).replace(/\/$/,'');
   const invite=await createOrganizationInviteCanonical({organizationId:orgId,userId:user.id,role:String(role).toLowerCase(),appUrl});
   return res.status(201).json({success:true,invitation:{...invite,name:typeof name==='string'?name.trim():null}});
  }
  res.setHeader('Allow','GET, POST');
  return res.status(405).json({error:'Method not allowed.'});
 }catch(error){
  console.error('[USERS]',error?.message||error);
  const status=Number(error?.status)||500;
  return res.status(status).json({error:status<500?(error.message||'Unable to complete organization access request.'):'Unable to complete organization access request.',code:error?.code||'ACCESS_REQUEST_FAILED'});
 }
});
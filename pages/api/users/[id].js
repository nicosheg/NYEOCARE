// pages/api/users/[id].js
import{withOrg}from'../../../lib/apiHelpers';
import{manageOrganizationAccess}from'../../../lib/organizationAccessEngine';

export default withOrg(async function handler(req,res){
 const id=String(req.query.id||'').trim();
 if(!id)return res.status(400).json({error:'User id is required.'});
 try{
  if(req.method==='GET'){
   const result=await manageOrganizationAccess({organizationId:req.org.id,actorId:req.user.id,operation:'list_access'});
   const user=result.users.find(x=>String(x.id)===id);
   if(!user)return res.status(404).json({error:'User not found.'});
   return res.status(200).json({user});
  }
  if(req.method==='DELETE'){
   const result=await manageOrganizationAccess({organizationId:req.org.id,actorId:req.user.id,operation:'remove_user',targetUserId:id,confirmed:true});
   return res.status(200).json({success:true,removed:true,user:result.user});
  }
  if(req.method==='PATCH'||req.method==='PUT'){
   const role=req.body?.role;
   if(role==='owner'){
    const result=await manageOrganizationAccess({organizationId:req.org.id,actorId:req.user.id,operation:'transfer_ownership',targetUserId:id,confirmed:true});
    return res.status(200).json({success:true,role:'owner',user:result.user});
   }
   const result=await manageOrganizationAccess({organizationId:req.org.id,actorId:req.user.id,operation:'change_role',targetUserId:id,targetRole:role,confirmed:true});
   return res.status(200).json({success:true,user:result.user});
  }
  res.setHeader('Allow','GET, DELETE, PATCH, PUT');
  return res.status(405).json({error:'Method not allowed.'});
 }catch(error){
  console.error('[USERS]',error?.message||error);
  const status=Number(error?.status)||500;
  return res.status(status).json({error:status<500?(error.message||'Unable to update organization user.'):'Unable to update organization user.',code:error?.code||'ACCESS_MUTATION_FAILED'});
 }
});
// pages/api/profile.js
import pool from'../../lib/db';
import{withOrg}from'../../lib/apiHelpers';
import{updateOrganizationProfile}from'../../lib/organizationMutationEngine';
import{supabaseAdmin}from'../../lib/supabaseClient';

export default withOrg(async function handler(req,res){
 const user=req.user;
 if(req.method==='GET'){
  try{
   const r=await pool.query('SELECT id,name,aria_instructions FROM organizations WHERE id=$1 LIMIT 1',[user.organization_id]);
   if(!r.rows.length)return res.status(404).json({error:'Organization not found.',request_id:req.nyeoRequestId});
   return res.status(200).json({user:{id:user.id,name:user.name,email:user.email,role:user.role,active:user.active,last_login_at:user.last_login_at},organization:r.rows[0]});
  }catch(error){
   console.error('[PROFILE] GET failed:',error?.message||error);
   return res.status(500).json({error:'Unable to load profile.',request_id:req.nyeoRequestId});
  }
 }
 if(req.method!=='PATCH'){
  res.setHeader('Allow','GET, PATCH');
  return res.status(405).json({error:'Method not allowed.',request_id:req.nyeoRequestId});
 }
 const{organizationName,name,ariaInstructions,userName}=req.body||{};
 try{
  const data=await updateOrganizationProfile({
   organizationId:user.organization_id,
   userId:user.id,
   role:user.role,
   fields:{
    ...(userName!==undefined?{userName}:{}),
    ...(organizationName!==undefined?{organizationName}:{...(name!==undefined?{organizationName:name}: {})}),
    ...(ariaInstructions!==undefined?{ariaInstructions}: {})
   }
  });
  let identity_sync_warning=null;
  // users.name is NYEOCARE's canonical display name. Keep Supabase Auth profile
  // metadata aligned so downstream account/profile surfaces do not revert to the
  // original sign-up metadata (which can be different from the organization name).
  if(userName!==undefined&&user.supabase_user_id){
   if(!supabaseAdmin){
    identity_sync_warning='Your name was saved in NYEOCARE, but account-profile metadata could not be synchronized. Check the server Supabase admin configuration and save again.';
   }else{
    try{
     const currentAuth=await supabaseAdmin.auth.admin.getUserById(user.supabase_user_id);
     if(currentAuth.error)throw currentAuth.error;
     const authMetadata=currentAuth.data?.user?.user_metadata||{};
     const canonicalName=String(data.user?.name||userName).trim();
     const updatedAuth=await supabaseAdmin.auth.admin.updateUserById(user.supabase_user_id,{
      user_metadata:{...authMetadata,name:canonicalName,full_name:canonicalName}
     });
     if(updatedAuth.error)throw updatedAuth.error;
    }catch(syncError){
     console.error('[PROFILE] Auth display-name sync failed:',{request_id:req.nyeoRequestId,message:syncError?.message||syncError});
     identity_sync_warning='Your name was saved in NYEOCARE, but the account profile could not be synchronized. Save your name again to retry.';
    }
   }
  }
  return res.status(200).json({success:true,request_id:req.nyeoRequestId,identity_sync_warning,...data});
 }catch(error){
  console.error('[PROFILE] PATCH failed:',{request_id:req.nyeoRequestId,message:error?.message||error,code:error?.code||null});
  const status=Number(error?.status)||500;
  if(status<500)return res.status(status).json({error:error.message||'Unable to save changes.',code:error.code||'PROFILE_UPDATE_FAILED',request_id:req.nyeoRequestId});
  return res.status(500).json({error:'Unable to save changes. Nothing was partially saved.',code:error.code||'PROFILE_UPDATE_FAILED',request_id:req.nyeoRequestId});
 }
});
// pages/api/profile.js
import pool from'../../lib/db';
import{withOrg}from'../../lib/apiHelpers';

const cleanText=(value,max=120)=>String(value??'').trim().slice(0,max);

export default withOrg(async function handler(req,res){
 const user=req.user;
 if(req.method==='GET'){
  try{
   const r=await pool.query('SELECT id,name,aria_instructions FROM organizations WHERE id=$1 LIMIT 1',[user.organization_id]);
   if(!r.rows.length)return res.status(404).json({error:'Organization not found.',request_id:req.nyeoRequestId});
   return res.status(200).json({
    user:{id:user.id,name:user.name,email:user.email,role:user.role,active:user.active,last_login_at:user.last_login_at},
    organization:r.rows[0]
   });
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
 const requestedOrgName=organizationName!==undefined?organizationName:name;
 const wantsUserName=userName!==undefined;
 const wantsOrgName=requestedOrgName!==undefined;
 const wantsAriaInstructions=ariaInstructions!==undefined;

 if(!wantsUserName&&!wantsOrgName&&!wantsAriaInstructions){
  const[org,userRow]=await Promise.all([
   pool.query('SELECT id,name,aria_instructions FROM organizations WHERE id=$1 LIMIT 1',[user.organization_id]),
   pool.query('SELECT id,name,email,role,active,last_login_at FROM users WHERE id=$1 AND organization_id=$2 LIMIT 1',[user.id,user.organization_id])
  ]);
  return res.status(200).json({success:true,user:userRow.rows[0]||null,organization:org.rows[0]||null,no_changes:true});
 }

 if(wantsOrgName&&user.role!=='owner'){
  return res.status(403).json({error:'Only the owner can change the organization name.',code:'ORG_NAME_OWNER_REQUIRED',request_id:req.nyeoRequestId});
 }
 if(wantsAriaInstructions&&!['owner','admin'].includes(user.role)){
  return res.status(403).json({error:'Only owners and admins can edit ARIA organization knowledge.',code:'ARIA_INSTRUCTIONS_ADMIN_REQUIRED',request_id:req.nyeoRequestId});
 }

 const nextUserName=wantsUserName?cleanText(userName,120):null;
 const nextOrgName=wantsOrgName?cleanText(requestedOrgName,120):null;
 const nextAria=wantsAriaInstructions?cleanText(ariaInstructions,2000):null;

 if(wantsUserName&&(!nextUserName||nextUserName.length>120)){
  return res.status(400).json({error:'Your name must be between 1 and 120 characters.',code:'INVALID_USER_NAME',request_id:req.nyeoRequestId});
 }
 if(wantsOrgName&&(!nextOrgName||nextOrgName.length>120)){
  return res.status(400).json({error:'Organization name must be between 1 and 120 characters.',code:'INVALID_ORGANIZATION_NAME',request_id:req.nyeoRequestId});
 }
 if(wantsAriaInstructions&&String(ariaInstructions??'').trim().length>2000){
  return res.status(400).json({error:'ARIA knowledge must be 2000 characters or less.',code:'ARIA_INSTRUCTIONS_TOO_LONG',request_id:req.nyeoRequestId});
 }

 const client=await pool.connect();
 try{
  await client.query('BEGIN');

  if(wantsUserName){
   const r=await client.query(
    'UPDATE users SET name=$1,updated_at=NOW() WHERE id=$2 AND organization_id=$3 AND active=true RETURNING id,name,email,role,active,last_login_at',
    [nextUserName,user.id,user.organization_id]
   );
   if(!r.rows.length)throw Object.assign(new Error('Active user record could not be updated.'),{status:404,code:'USER_NOT_FOUND'});
  }

  if(wantsOrgName){
   const r=await client.query(
    'UPDATE organizations SET name=$1,updated_at=NOW() WHERE id=$2 RETURNING id,name,aria_instructions',
    [nextOrgName,user.organization_id]
   );
   if(!r.rows.length)throw Object.assign(new Error('Organization record could not be updated.'),{status:404,code:'ORGANIZATION_NOT_FOUND'});
  }

  if(wantsAriaInstructions){
   const r=await client.query(
    'UPDATE organizations SET aria_instructions=$1,updated_at=NOW() WHERE id=$2 RETURNING id,name,aria_instructions',
    [nextAria||null,user.organization_id]
   );
   if(!r.rows.length)throw Object.assign(new Error('Organization ARIA settings could not be updated.'),{status:404,code:'ORGANIZATION_NOT_FOUND'});
  }

  const[org,userRow]=await Promise.all([
   client.query('SELECT id,name,aria_instructions FROM organizations WHERE id=$1 LIMIT 1',[user.organization_id]),
   client.query('SELECT id,name,email,role,active,last_login_at FROM users WHERE id=$1 AND organization_id=$2 LIMIT 1',[user.id,user.organization_id])
  ]);
  await client.query('COMMIT');

  return res.status(200).json({
   success:true,
   request_id:req.nyeoRequestId,
   user:userRow.rows[0]||null,
   organization:org.rows[0]||null,
   changed:{userName:wantsUserName,organizationName:wantsOrgName,ariaInstructions:wantsAriaInstructions}
  });
 }catch(error){
  try{await client.query('ROLLBACK')}catch{}
  console.error('[PROFILE] PATCH failed:',{request_id:req.nyeoRequestId,message:error?.message||error,code:error?.code||null});
  const status=Number(error?.status)||500;
  if(status<500)return res.status(status).json({error:error.message||'Unable to save changes.',code:error.code||'PROFILE_UPDATE_FAILED',request_id:req.nyeoRequestId});
  return res.status(500).json({error:'Unable to save changes. Nothing was partially saved.',code:'PROFILE_UPDATE_FAILED',request_id:req.nyeoRequestId});
 }finally{client.release()}
});
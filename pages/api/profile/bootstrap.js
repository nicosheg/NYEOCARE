// pages/api/profile/bootstrap.js
import pool from'../../../lib/db';import{withOrg}from'../../../lib/apiHelpers';
export default withOrg(async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 res.setHeader('Cache-Control','private,no-store,max-age=0,must-revalidate');
 try{
  const[o,u]=await Promise.all([
   pool.query("SELECT id,name,aria_instructions FROM organizations WHERE id=$1 LIMIT 1",[req.org.id]),
   pool.query("SELECT id,email,name,role,active,created_at,updated_at,last_login_at FROM users WHERE organization_id=$1 ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,created_at ASC",[req.org.id])
  ]);
  if(!o.rows.length)return res.status(404).json({error:'Organization not found.'});
  const me=u.rows.find(x=>x.id===req.user.id)||{id:req.user.id,name:req.user.name,email:req.user.email,role:req.user.role,active:req.user.active,last_login_at:req.user.last_login_at};
  return res.status(200).json({user:me,organization:o.rows[0],users:u.rows});
 }catch(e){console.error('[PROFILE] Bootstrap error:',e);return res.status(500).json({error:'Unable to load profile.'})}
});

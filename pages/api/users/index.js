// pages/api/users/index.js
import crypto from'crypto';
import pool from'../../../lib/db';
import{withOrg}from'../../../lib/apiHelpers';

const hash=t=>crypto.createHash('sha256').update(t).digest('hex');
const appUrl=req=>(process.env.NEXT_PUBLIC_APP_URL||process.env.NEXT_PUBLIC_SITE_URL||`${req.headers['x-forwarded-proto']||'https'}://${req.headers.host}`).replace(/\/$/,'');

export default withOrg(async function handler(req,res){
const orgId=req.org.id,user=req.user;

if(req.method==='GET'){
try{
const r=await pool.query(`SELECT id,email,name,role,active,created_at,updated_at,last_login_at FROM users WHERE organization_id=$1 ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,created_at ASC`,[orgId]);
return res.status(200).json({users:r.rows});
}catch(e){return res.status(500).json({error:'Unable to load organization members.'})}
}

if(req.method==='POST'){
if(!['owner','admin'].includes(user.role))return res.status(403).json({error:'Only owners and admins can invite people.'});
const{name,role}=req.body||{},cleanName=typeof name==='string'?name.trim():'';
if(!cleanName)return res.status(400).json({error:'Please provide the person’s name.'});
if(cleanName.length>120)return res.status(400).json({error:'Name is too long.'});
if(!['admin','user'].includes(role))return res.status(400).json({error:'Invalid invitation role.'});
try{
const token=crypto.randomBytes(32).toString('hex'),tokenHash=hash(token),expires=new Date(Date.now()+48*60*60*1000);
await pool.query(`UPDATE organization_invites SET used_at=NOW() WHERE organization_id=$1 AND used_at IS NULL AND expires_at<=NOW()`,[orgId]);
const r=await pool.query(`INSERT INTO organization_invites(organization_id,invited_by,email,role,token_hash,expires_at) VALUES($1,$2,NULL,$3,$4,$5) RETURNING id,role,expires_at`,[orgId,user.id,role,tokenHash,expires]);
return res.status(201).json({success:true,invitation:{id:r.rows[0].id,name:cleanName,role:r.rows[0].role,expires_at:r.rows[0].expires_at,url:`${appUrl(req)}/join/${token}`}});
}catch(e){console.error('[INVITE]',e);return res.status(500).json({error:'Unable to create invitation.'})}
}

res.setHeader('Allow','GET, POST');
return res.status(405).json({error:'Method not allowed.'});
});

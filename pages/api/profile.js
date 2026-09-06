// pages/api/profile.js
import pool from'../../lib/db';
import{getCurrentCareUser}from'../../lib/auth';

export default async function handler(req,res){
const user=await getCurrentCareUser(req);
if(!user)return res.status(401).json({error:'Unauthorized'});
if(req.method==='GET'){
try{
const[r]=await Promise.all([pool.query(`SELECT id,name,aria_instructions FROM organizations WHERE id=$1`,[user.organization_id])]);
if(!r.rows.length)return res.status(404).json({error:'Organization not found.'});
return res.status(200).json({user:{id:user.id,name:user.name,email:user.email,role:user.role,active:user.active,last_login_at:user.last_login_at},organization:r.rows[0]});
}catch(e){return res.status(500).json({error:'Unable to load profile.'})}
}
if(req.method!=='PATCH')return res.status(405).json({error:'Method not allowed.'});

const{name,ariaInstructions,userName}=req.body||{};
const client=await pool.connect();
try{
await client.query('BEGIN');

if(userName!==undefined){
const clean=String(userName||'').trim();
if(!clean||clean.length>120){await client.query('ROLLBACK');return res.status(400).json({error:'Your name must be between 1 and 120 characters.'})}
await client.query(`UPDATE users SET name=$1,updated_at=NOW() WHERE id=$2 AND organization_id=$3 AND active=true`,[clean,user.id,user.organization_id]);
}

if(name!==undefined){
if(user.role!=='owner'){await client.query('ROLLBACK');return res.status(403).json({error:'Only the owner can change the organization name.'})}
const clean=String(name||'').trim();
if(!clean||clean.length>120){await client.query('ROLLBACK');return res.status(400).json({error:'Organization name must be between 1 and 120 characters.'})}
await client.query(`UPDATE organizations SET name=$1,updated_at=NOW() WHERE id=$2`,[clean,user.organization_id]);
}

if(ariaInstructions!==undefined){
if(!['owner','admin'].includes(user.role)){await client.query('ROLLBACK');return res.status(403).json({error:'Only owners and admins can edit ARIA organization knowledge.'})}
const clean=String(ariaInstructions||'').trim();
if(clean.length>2000){await client.query('ROLLBACK');return res.status(400).json({error:'ARIA knowledge must be 2000 characters or less.'})}
await client.query(`UPDATE organizations SET aria_instructions=$1,updated_at=NOW() WHERE id=$2`,[clean||null,user.organization_id]);
}

const[r,u]=await Promise.all([
client.query(`SELECT id,name,aria_instructions FROM organizations WHERE id=$1`,[user.organization_id]),
client.query(`SELECT id,name,email,role,active,last_login_at FROM users WHERE id=$1 AND organization_id=$2`,[user.id,user.organization_id])
]);
await client.query('COMMIT');
return res.status(200).json({success:true,user:u.rows[0],organization:r.rows[0]});
}catch(e){
try{await client.query('ROLLBACK')}catch{}
console.error('[PROFILE]',e?.message||e);
return res.status(500).json({error:'Unable to save changes.'});
}finally{client.release()}
   }

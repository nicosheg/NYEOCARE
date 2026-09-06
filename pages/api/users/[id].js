// pages/api/users/[id].js
import pool from'../../../lib/db';
import{withOrg}from'../../../lib/apiHelpers';

export default withOrg(async function handler(req,res){
const id=String(req.query.id||''),orgId=req.org.id,current=req.user;
if(!id)return res.status(400).json({error:'User id is required.'});

try{
const found=await pool.query(`SELECT id,name,email,role,active FROM users WHERE id=$1 AND organization_id=$2 LIMIT 1`,[id,orgId]);
if(!found.rows.length)return res.status(404).json({error:'User not found.'});
const target=found.rows[0];

if(req.method==='GET')return res.status(200).json({user:target});

if(req.method==='DELETE'){
if(!['owner','admin'].includes(current.role))return res.status(403).json({error:'Only owners and admins can remove users.'});
if(target.id===current.id)return res.status(400).json({error:'You cannot remove yourself.'});
if(target.role==='owner')return res.status(403).json({error:'The organization owner cannot be removed.'});
if(current.role==='admin'&&target.role==='admin')return res.status(403).json({error:'Only the owner can remove another admin.'});
if(!target.active)return res.status(200).json({success:true,removed:false,user:{...target,active:false}});
const r=await pool.query(`UPDATE users SET active=false,updated_at=NOW() WHERE id=$1 AND organization_id=$2 AND active=true RETURNING id,name,email,role,active`,[id,orgId]);
return res.status(200).json({success:true,removed:true,user:r.rows[0]});
}

if(req.method==='PATCH'||req.method==='PUT'){
if(current.role!=='owner')return res.status(403).json({error:'Only the owner can change user responsibilities.'});
const role=req.body?.role;
if(!['admin','user','owner'].includes(role))return res.status(400).json({error:'Invalid role.'});
if(role==='owner'){
if(target.id===current.id)return res.status(400).json({error:'You are already the owner.'});
if(!target.active)return res.status(400).json({error:'The target user is inactive.'});
const client=await pool.connect();
try{
await client.query('BEGIN');
const lock=await client.query(`SELECT id FROM users WHERE id=$1 AND organization_id=$2 AND active=true FOR UPDATE`,[id,orgId]);
if(!lock.rows.length){await client.query('ROLLBACK');return res.status(404).json({error:'User not found.'})}
await client.query(`UPDATE users SET role='admin',updated_at=NOW() WHERE id=$1 AND organization_id=$2`,[current.id,orgId]);
await client.query(`UPDATE users SET role='owner',updated_at=NOW() WHERE id=$1 AND organization_id=$2`,[id,orgId]);
await client.query('COMMIT');
return res.status(200).json({success:true,role:'owner'});
}catch(e){try{await client.query('ROLLBACK')}catch{}throw e}finally{client.release()}
}
if(target.id===current.id)return res.status(400).json({error:'You cannot change your own responsibility here.'});
const r=await pool.query(`UPDATE users SET role=$1,updated_at=NOW() WHERE id=$2 AND organization_id=$3 RETURNING id,name,email,role,active`,[role,id,orgId]);
return res.status(200).json({success:true,user:r.rows[0]});
}

res.setHeader('Allow','GET, DELETE, PATCH, PUT');
return res.status(405).json({error:'Method not allowed.'});
}catch(e){
console.error('[USERS]',e);
return res.status(500).json({error:'Unable to update organization user.'});
}
});

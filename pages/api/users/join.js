// pages/api/users/join.js
import crypto from'crypto';
import pool from'../../../lib/db';
import{getAuthUser}from'../../../lib/auth';

const hash=t=>crypto.createHash('sha256').update(t).digest('hex');

export default async function handler(req,res){
if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
const authUser=await getAuthUser(req);
if(!authUser)return res.status(401).json({error:'Please sign in or create your NYEOCARE account first.'});
const token=typeof req.body?.token==='string'?req.body.token.trim():'';
if(!token)return res.status(400).json({error:'Invitation link is invalid.'});
const email=String(authUser.email||'').trim().toLowerCase();
if(!email)return res.status(400).json({error:'Your account does not have an email address.'});
const suppliedName=typeof req.body?.name==='string'?req.body.name.trim():'';
if(suppliedName.length>120)return res.status(400).json({error:'Your display name is too long.'});

const client=await pool.connect();
try{
await client.query('BEGIN');
const invite=await client.query(`SELECT i.id,i.organization_id,i.email,i.role,i.expires_at,o.name AS organization_name FROM organization_invites i JOIN organizations o ON o.id=i.organization_id WHERE i.token_hash=$1 AND i.used_at IS NULL AND i.expires_at>NOW() FOR UPDATE`,[hash(token)]);
if(!invite.rows.length){await client.query('ROLLBACK');return res.status(410).json({error:'This invitation has expired, been used, or is no longer available.'})}
const i=invite.rows[0];
if(i.email&&String(i.email).trim().toLowerCase()!==email){await client.query('ROLLBACK');return res.status(403).json({error:`This invitation was created for ${i.email}. Please use that email address.`})}

const existing=await client.query(`SELECT id,organization_id,role,name,active FROM users WHERE supabase_user_id=$1 LIMIT 1`,[authUser.id]);
if(existing.rows.length){
const member=existing.rows[0];
if(!member.active){await client.query('ROLLBACK');return res.status(403).json({error:'Your NYEOCARE account is inactive. Please contact an administrator.'})}
if(member.organization_id!==i.organization_id){await client.query('ROLLBACK');return res.status(409).json({error:'Your account already belongs to another organization.'})}
if(suppliedName&&suppliedName!==member.name){await client.query(`UPDATE users SET name=$1,updated_at=NOW() WHERE id=$2`,[suppliedName,member.id]);member.name=suppliedName}
await client.query(`UPDATE organization_invites SET used_at=NOW(),accepted_by=$1 WHERE id=$2 AND used_at IS NULL`,[member.id,i.id]);
await client.query('COMMIT');
return res.status(200).json({success:true,alreadyMember:true,organization_id:i.organization_id,organization_name:i.organization_name,role:member.role,user:{id:member.id,name:member.name,role:member.role}});
}

const name=suppliedName||String(authUser.user_metadata?.name||authUser.user_metadata?.full_name||email.split('@')[0]||'User').trim();
if(!name){await client.query('ROLLBACK');return res.status(400).json({error:'Please provide a display name.'})}

const inserted=await client.query(`INSERT INTO users(organization_id,email,name,role,supabase_user_id,password_hash,active) VALUES($1,$2,$3,$4,$5,$6,true) RETURNING id,name,email,role,organization_id`,[i.organization_id,email,name,i.role,authUser.id,'supabase_managed']);
await client.query(`UPDATE organization_invites SET used_at=NOW(),accepted_by=$1 WHERE id=$2 AND used_at IS NULL`,[inserted.rows[0].id,i.id]);
await client.query('COMMIT');
return res.status(200).json({success:true,alreadyMember:false,organization_id:i.organization_id,organization_name:i.organization_name,user:inserted.rows[0]});
}catch(e){
try{await client.query('ROLLBACK')}catch{}
console.error('[JOIN]',e);
return res.status(500).json({error:'Unable to join the organization.'});
}finally{client.release()}
 }

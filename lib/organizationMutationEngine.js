import crypto from'crypto';
import pool from'./db';

const clean=(v,max=2000)=>String(v??'').trim().slice(0,max);

export async function updateOrganizationProfile({organizationId,userId,role,fields={}}){
 if(!organizationId||!userId)throw Object.assign(new Error('Organization and user are required.'),{status:400});
 const wantsUserName=Object.prototype.hasOwnProperty.call(fields,'userName');
 const wantsOrganizationName=Object.prototype.hasOwnProperty.call(fields,'organizationName');
 const wantsAriaInstructions=Object.prototype.hasOwnProperty.call(fields,'ariaInstructions');
 if(!wantsUserName&&!wantsOrganizationName&&!wantsAriaInstructions){
  const[org,user]=await Promise.all([
   pool.query('SELECT id,name,aria_instructions FROM organizations WHERE id=$1 LIMIT 1',[organizationId]),
   pool.query('SELECT id,name,email,role,active,last_login_at FROM users WHERE id=$1 AND organization_id=$2 LIMIT 1',[userId,organizationId])
  ]);
  return{user:user.rows[0]||null,organization:org.rows[0]||null,no_changes:true};
 }
 if(wantsOrganizationName&&role!=='owner')throw Object.assign(new Error('Only the owner can change the organization name.'),{status:403,code:'ORG_NAME_OWNER_REQUIRED'});
 if(wantsAriaInstructions&&!['owner','admin'].includes(role))throw Object.assign(new Error('Only owners and admins can edit ARIA organization knowledge.'),{status:403,code:'ARIA_INSTRUCTIONS_ADMIN_REQUIRED'});

 const userName=wantsUserName?clean(fields.userName,120):null;
 const organizationName=wantsOrganizationName?clean(fields.organizationName,120):null;
 const ariaInstructions=wantsAriaInstructions?clean(fields.ariaInstructions,2000):null;

 if(wantsUserName&&!userName)throw Object.assign(new Error('Your name must be between 1 and 120 characters.'),{status:400,code:'INVALID_USER_NAME'});
 if(wantsOrganizationName&&!organizationName)throw Object.assign(new Error('Organization name must be between 1 and 120 characters.'),{status:400,code:'INVALID_ORGANIZATION_NAME'});
 if(wantsAriaInstructions&&String(fields.ariaInstructions??'').trim().length>2000)throw Object.assign(new Error('ARIA knowledge must be 2000 characters or less.'),{status:400,code:'ARIA_INSTRUCTIONS_TOO_LONG'});

 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  if(wantsUserName){
   const r=await client.query('UPDATE users SET name=$1,updated_at=NOW() WHERE id=$2 AND organization_id=$3 AND active=true RETURNING id,name,email,role,active,last_login_at',[userName,userId,organizationId]);
   if(!r.rows.length)throw Object.assign(new Error('Active user record could not be updated.'),{status:404,code:'USER_NOT_FOUND'});
  }
  if(wantsOrganizationName){
   const r=await client.query('UPDATE organizations SET name=$1,updated_at=NOW() WHERE id=$2 RETURNING id,name,aria_instructions',[organizationName,organizationId]);
   if(!r.rows.length)throw Object.assign(new Error('Organization record could not be updated.'),{status:404,code:'ORGANIZATION_NOT_FOUND'});
  }
  if(wantsAriaInstructions){
   const r=await client.query('UPDATE organizations SET aria_instructions=$1,updated_at=NOW() WHERE id=$2 RETURNING id,name,aria_instructions',[ariaInstructions||null,organizationId]);
   if(!r.rows.length)throw Object.assign(new Error('Organization ARIA settings could not be updated.'),{status:404,code:'ORGANIZATION_NOT_FOUND'});
  }
  const[org,user]=await Promise.all([
   client.query('SELECT id,name,aria_instructions FROM organizations WHERE id=$1 LIMIT 1',[organizationId]),
   client.query('SELECT id,name,email,role,active,last_login_at FROM users WHERE id=$1 AND organization_id=$2 LIMIT 1',[userId,organizationId])
  ]);
  await client.query('COMMIT');
  return{user:user.rows[0]||null,organization:org.rows[0]||null,changed:{userName:wantsUserName,organizationName:wantsOrganizationName,ariaInstructions:wantsAriaInstructions}};
 }catch(error){
  try{await client.query('ROLLBACK')}catch{}
  throw error;
 }finally{client.release()}
}

const hash=t=>crypto.createHash('sha256').update(t).digest('hex');

export async function createOrganizationInvite({organizationId,userId,role,appUrl}){
 if(!['admin','user'].includes(role))throw Object.assign(new Error('Invalid invitation responsibility.'),{status:400,code:'INVALID_INVITE_ROLE'});
 const token=crypto.randomBytes(7).toString('base64url');
 const tokenHash=hash(token);
 const expires=new Date(Date.now()+48*60*60*1000);
 const row=(await pool.query(
  'INSERT INTO organization_invites(organization_id,invited_by,email,role,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,role,expires_at',
  [organizationId,userId,null,role,tokenHash,expires]
 )).rows[0];
 const base=String(appUrl||'').replace(/\/$/,'');
 if(!base)throw Object.assign(new Error('Application URL is not configured.'),{status:500,code:'APP_URL_MISSING'});
 return{...row,url:base+'/join/'+token};
}

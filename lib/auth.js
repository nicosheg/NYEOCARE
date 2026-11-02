// lib/auth.js
import crypto from'crypto';
import{supabase}from'./supabaseClient';
import pool from'./db';
const TRANSIENT=new Set(['EMAXCONNSESSION','ECONNRESET','ECONNREFUSED','ETIMEDOUT','57P01','53300']);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const transient=e=>TRANSIENT.has(String(e?.code||''))||/max clients reached|too many clients|connection terminated|timeout/i.test(String(e?.message||''));
async function query(sql,params=[]){let last;for(let i=0;i<3;i++){try{return await pool.query(sql,params)}catch(e){last=e;if(!transient(e)||i===2)throw e;await sleep(150*(i+1))}}throw last}
async function connect(){let last;for(let i=0;i<3;i++){try{return await pool.connect()}catch(e){last=e;if(!transient(e)||i===2)throw e;await sleep(200*(i+1))}}throw last}
function getBearerToken(req){const h=req?.headers?.authorization;if(typeof h!=='string')return null;const m=h.match(/^Bearer\s+(.+)$/i);return m?m[1].trim():null}
const authCache=new Map(),AUTH_TTL=2500,AUTH_MAX=512;
function getAuthCache(token){const item=authCache.get(token);if(!item)return null;if(item.expiresAt<=Date.now()){authCache.delete(token);return null}return item.user||null}
function setAuthCache(token,user,expiresAt){if(authCache.size>=AUTH_MAX){const first=authCache.keys().next().value;if(first)authCache.delete(first)}authCache.set(token,{user,expiresAt});return user}
export async function getAuthUser(req){const token=getBearerToken(req);if(!token)return null;const cached=getAuthCache(token);if(cached)return cached;try{const{data:{user},error}=await supabase.auth.getUser(token);if(error||!user)return null;const exp=Number(user.exp||0)*1000,expiresAt=Math.min(exp||Date.now()+AUTH_TTL,Date.now()+AUTH_TTL);return setAuthCache(token,user,expiresAt)}catch(error){console.error('[AUTH] Supabase authentication failed:',error?.message||error);return null}}
export async function getCurrentCareUser(req){const authUser=await getAuthUser(req);if(!authUser)return null;try{
 let result=await query(`SELECT u.*,o.id AS organization_id,o.name AS organization_name FROM users u INNER JOIN organizations o ON o.id=u.organization_id WHERE u.supabase_user_id=$1 AND u.active=true LIMIT 1`,[authUser.id]);
 // Membership resolution is deliberately read-only. An authenticated request must never
 // create a workspace as a side effect: invited operators are attached only by
 // accepting their organization invitation, while standalone workspaces are created
 // through the explicit create-organization action.
 if(!result.rows.length)return null;
 return result.rows[0]||null;
 }catch(error){console.error('[AUTH] Failed to resolve Care user:',error?.message||error);throw Object.assign(new Error('Care authentication storage is temporarily unavailable.'),{code:'AUTH_STORAGE_UNAVAILABLE',cause:error})}}
export async function ensureCareUser(supabaseUser){
 if(!supabaseUser?.id)throw new Error('Invalid Supabase user');
 const client=await connect();
 try{
  await client.query('BEGIN');
  // Serialize organization creation and invitation acceptance for this Auth identity.
  // The unique users.supabase_user_id index remains the database-level backstop.
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,[supabaseUser.id]);
  const existing=await client.query(`SELECT id,organization_id,active FROM users WHERE supabase_user_id=$1 LIMIT 1 FOR UPDATE`,[supabaseUser.id]);
  if(existing.rows.length){
   if(existing.rows[0].active===false)throw Object.assign(new Error('Your NYEOCARE account is inactive. Please contact an administrator.'),{status:403,code:'CARE_USER_INACTIVE'});
   await client.query('COMMIT');
   return existing.rows[0];
  }
  const email=String(supabaseUser.email||'').trim().toLowerCase();
  if(!email)throw new Error('Authenticated user has no email address');
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',[`email:${email}`]);
  const emailOwner=await client.query('SELECT id,organization_id FROM users WHERE lower(email)=lower($1) LIMIT 1 FOR UPDATE',[email]);
  if(emailOwner.rows.length)throw Object.assign(new Error('This email is already assigned to a NYEOCARE organization. Sign in with the existing account or ask an administrator to review it.'),{status:409,code:'EMAIL_ALREADY_ASSIGNED'});
  const metadata=supabaseUser.user_metadata||{};
  const name=String(metadata.name||metadata.full_name||email.split('@')[0]||'User').trim();
  const organizationId=`org_${crypto.randomUUID().replace(/-/g,'')}`;
  await client.query(`INSERT INTO organizations(id,name) VALUES($1,$2)`,[organizationId,`${name}'s Space`]);
  const created=await client.query(
   `INSERT INTO users(supabase_user_id,email,name,role,organization_id,active)
    VALUES($1,$2,$3,'owner',$4,true)
    RETURNING id,organization_id,active`,
   [supabaseUser.id,email,name,organizationId]
  );
  await client.query('COMMIT');
  return created.rows[0];
 }catch(error){
  try{await client.query('ROLLBACK')}catch{}
  console.error('[AUTH] Explicit organization provisioning failed:',error?.message||error);
  throw error;
 }finally{
  client.release();
 }
}

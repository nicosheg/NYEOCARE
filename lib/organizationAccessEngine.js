import pool from'./db';

const roleOf=async(organizationId,userId)=>{
 const r=await pool.query('SELECT id,name,email,role,active FROM users WHERE id=$1 AND organization_id=$2 LIMIT 1',[userId,organizationId]);
 return r.rows[0]||null;
};

const requireAccessActor=async(organizationId,actorId)=>{
 const actor=await roleOf(organizationId,actorId);
 if(!actor||!actor.active)throw Object.assign(new Error('Active organization operator required.'),{status:403,code:'ACCESS_ACTOR_REQUIRED'});
 return actor;
};

const requireOwner=async(organizationId,actorId)=>{
 const actor=await requireAccessActor(organizationId,actorId);
 if(actor.role!=='owner')throw Object.assign(new Error('Owner permission required.'),{status:403,code:'OWNER_REQUIRED'});
 return actor;
};

export async function listOrganizationAccess({organizationId,actorId}){
 const actor=await requireAccessActor(organizationId,actorId);
 const users=(await pool.query(`SELECT id,name,email,role,active,created_at,updated_at,last_login_at
   FROM users WHERE organization_id=$1
   ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,created_at ASC`,[organizationId])).rows;
 const invitations=(await pool.query(`SELECT i.id,i.email,i.role,i.expires_at,i.used_at,i.accepted_by,i.created_at,u.name AS invited_by_name
   FROM organization_invites i
   LEFT JOIN users u ON u.id=i.invited_by
   WHERE i.organization_id=$1
   ORDER BY i.created_at DESC LIMIT 100`,[organizationId])).rows;
 const visibleUsers=actor.role==='owner'
  ? users
  : users.map(u=>{
    if(u.id===actor.id||u.role==='user')return u;
    return{...u,name:u.name,email:null,last_login_at:null};
   });
 return{users:visibleUsers,invitations};
}

async function findUser(organizationId,name){
 const q=String(name||'').trim();
 if(!q)return[];
 const normalized=q.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 const tokens=normalized.split(/\s+/).filter(Boolean);
 if(!tokens.length)return[];
 const pattern=`(^| )${tokens.join(' ')}( |$)`;
 return(await pool.query(`SELECT id,name,email,role,active
   FROM users WHERE organization_id=$1 AND active=true
   AND(
     lower(regexp_replace(trim(COALESCE(name,'')),'[^a-z0-9]+',' ','g')) ~ $2
     OR lower(COALESCE(email,''))=lower($3)
   )
   ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,name
   LIMIT 10`,[organizationId,pattern,q])).rows;
}

export async function manageOrganizationAccess({organizationId,actorId,operation,targetUserId=null,targetUserName=null,targetRole=null,invitationId=null,confirmed=false}){
 const actor=await requireAccessActor(organizationId,actorId);
 const op=String(operation||'').trim();
 if(!op)throw Object.assign(new Error('Access operation is required.'),{status:400,code:'ACCESS_OPERATION_REQUIRED'});

 if(['list_users','list_invitations','list_access'].includes(op)){
  const data=await listOrganizationAccess({organizationId,actorId});
  return{capability:'manage_organization_access',operation:'list_access',...data};
 }

 if(['remove_user','change_role','transfer_ownership'].includes(op)){
  let target=targetUserId?await roleOf(organizationId,targetUserId):null;
  if(!target&&targetUserName){
   const matches=await findUser(organizationId,targetUserName);
   if(!matches.length)throw Object.assign(new Error(`I could not find an active organization user named “${targetUserName}”.`),{status:404,code:'ACCESS_TARGET_NOT_FOUND'});
   if(matches.length>1)throw Object.assign(new Error(`I found several active organization users matching “${targetUserName}”.`),{status:409,code:'ACCESS_TARGET_AMBIGUOUS',matches}),{status:409,code:'ACCESS_TARGET_AMBIGUOUS',matches});
   target=matches[0];
  }
  if(!target)throw Object.assign(new Error('The target organization user is required.'),{status:400,code:'ACCESS_TARGET_REQUIRED'});
  if(target.id===actor.id)throw Object.assign(new Error('You cannot change your own organization access this way.'),{status:400,code:'SELF_ACCESS_CHANGE'});
  if(target.role==='owner'&&op!=='transfer_ownership')throw Object.assign(new Error('The organization owner cannot be removed or downgraded.'),{status:403,code:'OWNER_PROTECTED'});
  if(actor.role==='admin'&&target.role==='admin')throw Object.assign(new Error('Only the owner can change another admin.’s access.'),{status:403,code:'ADMIN_TARGET_OWNER_REQUIRED'});

  if(!confirmed)return{capability:'manage_organization_access',operation:op,requires_confirmation:true,target:{id:target.id,name:target.name,email:target.email,role:target.role},requested_role:targetRole||null};

  if(op==='remove_user'){
   if(!['owner','admin'].includes(actor.role))throw Object.assign(new Error('Owner or admin permission required.'),{status:403});
   const r=await pool.query('UPDATE users SET active=false,updated_at=NOW() WHERE id=$1 AND organization_id=$2 AND active=true RETURNING id,name,email,role,active',[target.id,organizationId]);
   if(!r.rows.length)throw Object.assign(new Error('That user is no longer active.'),{status:409,code:'ACCESS_TARGET_STALE'});
   return{capability:'manage_organization_access',operation:op,completed:true,user:r.rows[0]};
  }

  if(op==='change_role'){
   if(actor.role!=='owner')throw Object.assign(new Error('Only the owner can change user responsibilities.'),{status:403,code:'OWNER_REQUIRED'});
   if(!['admin','user'].includes(String(targetRole||'').toLowerCase()))throw Object.assign(new Error('Role must be admin or user.'),{status:400,code:'INVALID_TARGET_ROLE'});
   const r=await pool.query('UPDATE users SET role=$1,updated_at=NOW() WHERE id=$2 AND organization_id=$3 AND active=true RETURNING id,name,email,role,active',[String(targetRole).toLowerCase(),target.id,organizationId]);
   if(!r.rows.length)throw Object.assign(new Error('That user could not be updated.'),{status:409,code:'ACCESS_TARGET_STALE'});
   return{capability:'manage_organization_access',operation:op,completed:true,user:r.rows[0]};
  }

  if(op==='transfer_ownership'){
   await requireOwner(organizationId,actorId);
   if(target.role==='owner')throw Object.assign(new Error('That user is already the owner.'),{status:400,code:'ALREADY_OWNER'});
   const client=await pool.connect();
   try{
    await client.query('BEGIN');
    const lock=(await client.query('SELECT id,name,role,active FROM users WHERE id=$1 AND organization_id=$2 AND active=true FOR UPDATE',[target.id,organizationId])).rows[0];
    if(!lock)throw Object.assign(new Error('That user is no longer active.'),{status:409,code:'ACCESS_TARGET_STALE'});
    await client.query(`UPDATE users SET role='admin',updated_at=NOW() WHERE id=$1 AND organization_id=$2 AND active=true`,[actor.id,organizationId]);
    const promoted=(await client.query(`UPDATE users SET role='owner',updated_at=NOW() WHERE id=$1 AND organization_id=$2 AND active=true RETURNING id,name,email,role,active`,[target.id,organizationId])).rows[0];
    await client.query('COMMIT');
    return{capability:'manage_organization_access',operation:op,completed:true,user:promoted,previous_owner_id:actor.id};
   }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error}finally{client.release()}
  }
 }

 if(op==='revoke_invitation'){
  if(!['owner','admin'].includes(actor.role))throw Object.assign(new Error('Owner or admin permission required.'),{status:403});
  if(!invitationId)throw Object.assign(new Error('Invitation id is required.'),{status:400,code:'INVITATION_ID_REQUIRED'});
  if(!confirmed)return{capability:'manage_organization_access',operation:op,requires_confirmation:true,invitation_id:invitationId};
  const r=await pool.query(`UPDATE organization_invites SET used_at=NOW()
    WHERE id=$1 AND organization_id=$2 AND used_at IS NULL AND expires_at>NOW()
    RETURNING id,role,expires_at,used_at`,[invitationId,organizationId]);
  if(!r.rows.length)throw Object.assign(new Error('Invitation not found, already used, or expired.'),{status:404,code:'INVITATION_NOT_ACTIVE'});
  return{capability:'manage_organization_access',operation:op,completed:true,invitation:r.rows[0]};
 }

 throw Object.assign(new Error(`Unsupported organization access operation: ${op}`),{status:400,code:'UNSUPPORTED_ACCESS_OPERATION'});
}

export async function createOrganizationInviteCanonical({organizationId,userId,role,appUrl}){
 const actor=await requireAccessActor(organizationId,userId);
 if(!['owner','admin'].includes(actor.role))throw Object.assign(new Error('Only owners and admins can invite users.'),{status:403,code:'INVITE_PERMISSION_REQUIRED'});
 if(!['admin','user'].includes(String(role||'').toLowerCase()))throw Object.assign(new Error('Invitation role must be admin or user.'),{status:400,code:'INVALID_INVITE_ROLE'});
 const engine=await import('./organizationMutationEngine');
 return engine.createOrganizationInvite({organizationId,userId,role:String(role).toLowerCase(),appUrl});
}

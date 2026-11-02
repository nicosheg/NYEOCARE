// pages/api/users/join.js
import crypto from 'crypto';
import pool from '../../../lib/db';
import {getAuthUser} from '../../../lib/auth';

const hash=token=>crypto.createHash('sha256').update(token).digest('hex');
const sameInstant=(left,right,maxMilliseconds)=>Math.abs(new Date(left).getTime()-new Date(right).getTime())<=maxMilliseconds;

async function isRecoverableAutoCreatedWorkspace(client,memberId,authUser){
  const identity=await client.query(`
    SELECT u.id,u.organization_id,u.name,u.email,u.role,u.active,u.created_at,
           o.name AS organization_name,o.created_at AS organization_created_at,
           a.created_at AS auth_created_at,
           (SELECT COUNT(*)::int FROM public.users m WHERE m.organization_id=u.organization_id) AS organization_member_count,
           (SELECT COUNT(*)::int FROM public.users x WHERE x.supabase_user_id=$2) AS account_membership_count
    FROM public.users u
    JOIN public.organizations o ON o.id=u.organization_id
    JOIN auth.users a ON a.id=u.supabase_user_id
    WHERE u.id=$1 AND u.supabase_user_id=$2
    FOR UPDATE OF u,o
  `,[memberId,authUser.id]);
  if(!identity.rows.length)return false;
  const row=identity.rows[0];
  const authEmail=String(authUser.email||'').trim().toLowerCase();
  const memberEmail=String(row.email||'').trim().toLowerCase();
  const expectedWorkspaceName=`${String(row.name||'').trim()}'s Space`;
  if(
    row.role!=='owner'||
    row.active!==true||
    !authEmail||
    memberEmail!==authEmail||
    String(row.organization_name||'')!==expectedWorkspaceName||
    Number(row.organization_member_count)!==1||
    Number(row.account_membership_count)!==1||
    !sameInstant(row.created_at,row.organization_created_at,2000)||
    !sameInstant(row.auth_created_at,row.organization_created_at,5000)
  )return false;

  // A personal workspace is recoverable only when it contains no actual tenant
  // data. Keep technical activity/diagnostic evidence in the old workspace;
  // every other public table with organization_id is checked dynamically.
  const scopedTables=await client.query(`
    SELECT c.relname AS table_name
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    JOIN information_schema.columns col
      ON col.table_schema=n.nspname
     AND col.table_name=c.relname
     AND col.column_name='organization_id'
    WHERE n.nspname='public'
      AND c.relkind IN ('r','p')
      AND c.relname NOT IN ('users','aria_activity_log','system_diagnostic_events')
    ORDER BY c.relname
  `);
  if(!scopedTables.rows.length)return false;
  const emptyChecks=scopedTables.rows.map(({table_name})=>{
    const identifier='"'+String(table_name).replace(/"/g,'""')+'"';
    return `EXISTS (SELECT 1 FROM public.${identifier} WHERE organization_id=$1)`;
  });
  const dataCheck=await client.query(
    `SELECT (${emptyChecks.join(' OR ')}) AS has_business_data`,
    [row.organization_id]
  );
  return dataCheck.rows[0]?.has_business_data===false;
}

export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store, max-age=0');
  if(req.method!=='POST'){
    res.setHeader('Allow','POST');
    return res.status(405).json({error:'Method not allowed'});
  }
  const authUser=await getAuthUser(req);
  if(!authUser)return res.status(401).json({error:'Please sign in or create your NYEOCARE account first.'});
  const token=typeof req.body?.token==='string'?req.body.token.trim():'';
  if(!token)return res.status(400).json({error:'Invitation link is invalid.'});
  const email=String(authUser.email||'').trim().toLowerCase();
  if(!email)return res.status(400).json({error:'Your account does not have an email address.'});
  if(!authUser.email_confirmed_at)return res.status(403).json({error:'Verify your email address before joining an organization.',code:'EMAIL_NOT_VERIFIED'});
  const suppliedName=typeof req.body?.name==='string'?req.body.name.trim():'';
  if(suppliedName.length>120)return res.status(400).json({error:'Your display name is too long.'});

  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,[authUser.id]);
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,[`email:${email}`]);
    const invite=await client.query(`
      SELECT i.id,i.organization_id,i.email,i.role,i.expires_at,o.name AS organization_name
      FROM public.organization_invites i
      JOIN public.organizations o ON o.id=i.organization_id
      WHERE i.token_hash=$1 AND i.used_at IS NULL AND i.expires_at>NOW()
      FOR UPDATE OF i
    `,[hash(token)]);
    if(!invite.rows.length){
      await client.query('ROLLBACK');
      return res.status(410).json({error:'This invitation has expired, been used, or is no longer available.'});
    }
    const invitation=invite.rows[0];
    if(invitation.email&&String(invitation.email).trim().toLowerCase()!==email){
      await client.query('ROLLBACK');
      return res.status(403).json({error:`This invitation was created for ${invitation.email}. Please use that email address.`});
    }

    const existing=await client.query(`
      SELECT id,organization_id,role,name,email,active
      FROM public.users
      WHERE supabase_user_id=$1
      LIMIT 1
      FOR UPDATE
    `,[authUser.id]);

    if(existing.rows.length){
      const member=existing.rows[0];
      if(!member.active){
        await client.query('ROLLBACK');
        return res.status(403).json({error:'Your NYEOCARE account is inactive. Please contact an administrator.'});
      }

      let movedFromPersonalWorkspace=false;
      if(member.organization_id!==invitation.organization_id){
        const recoverable=await isRecoverableAutoCreatedWorkspace(client,member.id,authUser);
        if(!recoverable){
          await client.query('ROLLBACK');
          return res.status(409).json({
            error:'This account is linked to a different NYEOCARE workspace. No data was moved. Ask a Havilah administrator to review the account before changing its organization.',
            code:'ORGANIZATION_MEMBERSHIP_CONFLICT'
          });
        }
        const duplicateEmail=await client.query(`
          SELECT id FROM public.users
          WHERE organization_id=$1 AND lower(email)=lower($2) AND id<>$3
          LIMIT 1
        `,[invitation.organization_id,email,member.id]);
        if(duplicateEmail.rows.length){
          await client.query('ROLLBACK');
          return res.status(409).json({
            error:'A Havilah account already uses this email address. Ask an administrator to review the duplicate account.',
            code:'ORGANIZATION_EMAIL_CONFLICT'
          });
        }
        const moved=await client.query(`
          UPDATE public.users
          SET organization_id=$1,role=$2,updated_at=NOW()
          WHERE id=$3 AND organization_id=$4 AND supabase_user_id=$5
          RETURNING id,name,role,organization_id
        `,[invitation.organization_id,invitation.role,member.id,member.organization_id,authUser.id]);
        if(!moved.rows.length){
          await client.query('ROLLBACK');
          return res.status(409).json({error:'Your account changed while the invitation was being accepted. Please reopen the invitation.'});
        }
        member.organization_id=invitation.organization_id;
        member.role=invitation.role;
        movedFromPersonalWorkspace=true;
      }

      if(suppliedName&&suppliedName!==member.name){
        await client.query(`UPDATE public.users SET name=$1,updated_at=NOW() WHERE id=$2`,[suppliedName,member.id]);
        member.name=suppliedName;
      }
      await client.query(`
        UPDATE public.organization_invites
        SET used_at=NOW(),accepted_by=$1
        WHERE id=$2 AND used_at IS NULL
      `,[member.id,invitation.id]);
      await client.query('COMMIT');
      return res.status(200).json({
        success:true,
        alreadyMember:!movedFromPersonalWorkspace,
        movedFromPersonalWorkspace,
        organization_id:invitation.organization_id,
        organization_name:invitation.organization_name,
        role:member.role,
        user:{id:member.id,name:member.name,role:member.role}
      });
    }

    const emailOwner=await client.query(`
      SELECT id,organization_id FROM public.users
      WHERE lower(email)=lower($1)
      LIMIT 1
      FOR UPDATE
    `,[email]);
    if(emailOwner.rows.length){
      await client.query('ROLLBACK');
      return res.status(409).json({
        error:'This email is already assigned to another NYEOCARE organization. Sign in with the existing account or ask an administrator to review the account.',
        code:'EMAIL_ALREADY_ASSIGNED'
      });
    }
    const name=suppliedName||String(authUser.user_metadata?.name||authUser.user_metadata?.full_name||email.split('@')[0]||'User').trim();
    if(!name){
      await client.query('ROLLBACK');
      return res.status(400).json({error:'Please provide a display name.'});
    }
    const inserted=await client.query(`
      INSERT INTO public.users(organization_id,email,name,role,supabase_user_id,password_hash,active)
      VALUES($1,$2,$3,$4,$5,$6,true)
      RETURNING id,name,email,role,organization_id
    `,[invitation.organization_id,email,name,invitation.role,authUser.id,'supabase_managed']);
    await client.query(`
      UPDATE public.organization_invites
      SET used_at=NOW(),accepted_by=$1
      WHERE id=$2 AND used_at IS NULL
    `,[inserted.rows[0].id,invitation.id]);
    await client.query('COMMIT');
    return res.status(200).json({
      success:true,
      alreadyMember:false,
      movedFromPersonalWorkspace:false,
      organization_id:invitation.organization_id,
      organization_name:invitation.organization_name,
      user:inserted.rows[0]
    });
  }catch(error){
    try{await client.query('ROLLBACK')}catch{}
    console.error('[JOIN]',error?.message||error);
    if(error?.code==='23505'){
      return res.status(409).json({error:'This email is already assigned to another NYEOCARE organization. Sign in with the existing account or ask an administrator to review the account.',code:'EMAIL_ALREADY_ASSIGNED'});
    }
    return res.status(500).json({error:'Unable to join the organization.'});
  }finally{
    client.release();
  }
}

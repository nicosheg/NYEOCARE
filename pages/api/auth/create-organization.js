// pages/api/auth/create-organization.js
import pool from '../../../lib/db';
import {getAuthUser,ensureCareUser,getCurrentCareUser} from '../../../lib/auth';

export default async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store, max-age=0');
  if(req.method!=='POST'){
    res.setHeader('Allow','POST');
    return res.status(405).json({error:'Method not allowed.'});
  }
  if(req.body?.intent!=='create_organization'){
    return res.status(400).json({error:'An explicit create-organization request is required.'});
  }
  const authUser=await getAuthUser(req);
  if(!authUser)return res.status(401).json({error:'Please sign in before creating an organization.'});

  try{
    const existing=await getCurrentCareUser(req);
    if(existing){
      return res.status(200).json({
        success:true,
        created:false,
        organization:{id:existing.organization_id,name:existing.organization_name},
        user:{id:existing.id,name:existing.name,role:existing.role}
      });
    }

    const membership=await ensureCareUser(authUser);
    const result=await pool.query(`
      SELECT u.id,u.name,u.role,o.id AS organization_id,o.name AS organization_name
      FROM public.users u
      JOIN public.organizations o ON o.id=u.organization_id
      WHERE u.id=$1 AND u.supabase_user_id=$2 AND u.active=true
      LIMIT 1
    `,[membership.id,authUser.id]);
    if(!result.rows.length)return res.status(503).json({error:'Your organization was not ready. Please try again.'});
    const user=result.rows[0];
    return res.status(200).json({
      success:true,
      created:true,
      organization:{id:user.organization_id,name:user.organization_name},
      user:{id:user.id,name:user.name,role:user.role}
    });
  }catch(error){
    console.error('[AUTH] Explicit organization creation failed:',error?.message||error);
    const status=Number(error?.status)||500;
    return res.status(status).json({
      error:status<500?(error.message||'Unable to create this organization.'):'Unable to create your organization right now.',
      code:error?.code||'ORGANIZATION_CREATE_FAILED'
    });
  }
}

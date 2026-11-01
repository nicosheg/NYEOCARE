// pages/api/attendance/create-session.js
// Normal Attendance and ARIA share the same server-owned session lifecycle.

import pool from '../../../lib/db';
import { withAdmin } from '../../../lib/apiHelpers';
import { createAttendanceSession } from '../../../lib/attendance/sessionLifecycle';

export default withAdmin(async function handler(req,res){
  if(req.method!=='POST'){
    res.setHeader('Allow','POST');
    return res.status(405).json({error:'Method not allowed'});
  }

  const parameters=req.body||{};
  if(typeof parameters.name!=='string'||!parameters.name.trim()){
    return res.status(400).json({error:'Event name is required.'});
  }

  const orgId=req.org.id;
  const userId=req.user.id;
  let client=null;

  try{
    client=await pool.connect();
    await client.query('BEGIN');
    const created=await createAttendanceSession({
      db:client,
      organizationId:orgId,
      actorId:userId,
      actorRole:req.user.role,
      parameters
    });
    await client.query('COMMIT');

    return res.status(201).json({
      success:true,
      id:created.session.id,
      session:created.session,
      sections:created.sections,
      joined:true,
      can_discard:['owner','admin'].includes(req.user.role),
      background_processing_not_blocking:true
    });
  }catch(err){
    if(client)await client.query('ROLLBACK').catch(()=>{});
    if(err.code==='ATTENDANCE_SESSION_ACTIVE'||err.code==='23505'){
      return res.status(409).json({
        success:false,
        blocked:true,
        can_discard:['owner','admin'].includes(req.user.role),
        reason:'active',
        error:'An attendance session is already active.',
        session:err.session||null
      });
    }
    const requestId=String(req.nyeoRequestId||'').slice(0,160)||null;
    console.error('[ATTENDANCE_SESSION_CREATE_FAILED]',JSON.stringify({request_id:requestId,error_code:String(err?.code||'ATTENDANCE_SESSION_CREATE_FAILED'),error_name:String(err?.name||'Error'),message:String(err?.message||'Unknown attendance session creation failure').slice(0,1200),stack:String(err?.stack||'').slice(0,4000)}));
    return res.status(err.status||500).json({error:err.status?err.message:'Could not start attendance.',code:String(err?.code||'ATTENDANCE_SESSION_CREATE_FAILED'),request_id:requestId});
  }finally{
    client?.release();
  }
});

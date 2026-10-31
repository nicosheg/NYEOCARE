// pages/api/people/attendance-group.js
import pool from '../../../lib/db';
import { withOrg } from '../../../lib/apiHelpers';

const GROUPS=new Set(['men','women','youth']);
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default withOrg(async function handler(req,res){
  if(req.method!=='POST'){
    res.setHeader('Allow','POST');
    return res.status(405).json({error:'Method not allowed'});
  }
  const role=String(req.user?.role||'').trim().toLowerCase();
  if(!['owner','admin','leader','worker','user'].includes(role))return res.status(403).json({error:'Authorized organization operator permissions required.'});
  const rawIds=Array.isArray(req.body?.ids)?req.body.ids:(req.body?.id?[req.body.id]:[]);
  const ids=[...new Set(rawIds.map(value=>String(value||'').trim()).filter(Boolean))];
  if(!ids.length)return res.status(400).json({error:'Select at least one person.'});
  if(ids.length>5000)return res.status(413).json({error:'Assign up to 5,000 people at a time.',max_ids:5000});
  if(ids.some(id=>!UUID_RE.test(id)))return res.status(400).json({error:'One or more selected person IDs are invalid.'});
  const rawGroup=String(req.body?.attendance_group??'').trim().toLowerCase();
  const attendanceGroup=rawGroup==='unassigned'||rawGroup===''?null:rawGroup;
  if(attendanceGroup!==null&&!GROUPS.has(attendanceGroup))return res.status(400).json({error:'Choose Men, Women, Youth, or Unassigned.',code:'INVALID_ATTENDANCE_GROUP'});
  const organizationId=req.org.id;
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const locked=await client.query(
      `SELECT id FROM public.people
       WHERE organization_id=$1::text AND id=ANY($2::uuid[])
         AND status IN('active','inactive') FOR UPDATE`,
      [organizationId,ids]
    );
    if(locked.rows.length!==ids.length){
      await client.query('ROLLBACK');
      return res.status(404).json({error:'Some selected people are no longer available in this organization. Refresh the list; no sections were changed.'});
    }
    const updated=await client.query(
      `UPDATE public.people SET attendance_group=$1::text,updated_at=NOW()
       WHERE organization_id=$2::text AND id=ANY($3::uuid[])
         AND status IN('active','inactive')
         AND attendance_group IS DISTINCT FROM $1::text RETURNING id`,
      [attendanceGroup,organizationId,ids]
    );
    await client.query('COMMIT');
    return res.status(200).json({success:true,requested:ids.length,updated:updated.rows.length,unchanged:ids.length-updated.rows.length,attendance_group:attendanceGroup||'unassigned'});
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    console.error('[PEOPLE_ATTENDANCE_GROUP] Assignment failed:',{request_id:req.nyeoRequestId||null,organization_id:organizationId,message:error?.message||String(error)});
    return res.status(500).json({error:'Unable to update attendance sections. No partial assignment was saved.'});
  }finally{client.release()}
});

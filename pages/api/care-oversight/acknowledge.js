// pages/api/care-oversight/acknowledge.js
import pool from '../../../lib/db';
import {withAdmin} from '../../../lib/apiHelpers';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default withAdmin(async function handler(req,res){
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Method not allowed'});}
 const messageId=String(req.body?.message_id||'').trim();
 if(!uuid.test(messageId))return res.status(400).json({error:'Choose a valid support request.'});
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const message=(await client.query(`SELECT id,recipient_user_id,seen_at,support_acknowledged_at
   FROM aria_internal_messages
   WHERE id=$1::uuid AND organization_id=$2 AND status='sent'
     AND metadata->>'kind'='operator_support_request'
   FOR UPDATE`,[messageId,req.org.id])).rows[0];
  if(!message){await client.query('ROLLBACK');return res.status(404).json({error:'That support request is no longer available.'});}
  const updated=(await client.query(`UPDATE aria_internal_messages
   SET support_acknowledged_at=COALESCE(support_acknowledged_at,NOW()),support_acknowledged_by=$3,updated_at=NOW()
   WHERE id=$1 AND organization_id=$2 RETURNING support_acknowledged_at`,[messageId,req.org.id,req.user.id])).rows[0];
  // Only mark the internal message as read when the acknowledging leader
  // is also its actual recipient. Another admin's acknowledgement must not
  // silently clear someone else's inbox item.
  if(String(message.recipient_user_id)===String(req.user.id)){
   await client.query(`UPDATE aria_internal_messages
    SET seen_at=COALESCE(seen_at,NOW()),updated_at=NOW()
    WHERE id=$1 AND organization_id=$2 AND recipient_user_id=$3`,
    [messageId,req.org.id,req.user.id]);
   await client.query(`UPDATE aria_daily_queue_items
    SET status='completed',completed_at=COALESCE(completed_at,NOW()),updated_at=NOW()
    WHERE organization_id=$1 AND task_kind='internal_message' AND source_id=$2
      AND assigned_user_id=$3 AND status IN('pending','deferred')`,
    [req.org.id,messageId,req.user.id]);
  }
  await client.query(`INSERT INTO aria_activity_log
   (organization_id,actor_id,actor_role,route,method,action_kind,status_code,success,entity_type,entity_id,metadata)
   VALUES($1,$2,$3,'/api/care-oversight/acknowledge','POST','support_request_acknowledged',200,true,'aria_internal_message',$4,$5::jsonb)`,
   [req.org.id,req.user.id,req.user.role,messageId,JSON.stringify({recipient_user_id:message.recipient_user_id})]);
  await client.query('COMMIT');
  return res.status(200).json({success:true,acknowledged_at:updated?.support_acknowledged_at||message.support_acknowledged_at});
 }catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  console.error('[CARE OVERSIGHT] acknowledge failed:',error?.message||error);
  return res.status(500).json({error:'Unable to acknowledge this support request safely.'});
 }finally{client.release();}
});

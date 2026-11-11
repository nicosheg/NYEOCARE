// pages/api/operator-support.js
import pool from '../../lib/db';
import {withOrg} from '../../lib/apiHelpers';
import {sendInternalMessage} from '../../lib/aria/internalMessaging';

const REASONS={
 unclear:'I am not sure what the next step should be.',
 capacity:'I do not have the capacity to complete this right now.',
 reassignment:'Someone else may be better placed to handle this.',
 blocked:'Something is blocking me from completing this.'
};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default withOrg(async function handler(req,res){
 if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return res.status(405).json({error:'Method not allowed'});}
 const queueItemId=String(req.method==='GET'?req.query?.queue_item_id:req.body?.queue_item_id||'').trim();
 const reason=String(req.body?.reason||'unclear');
 const note=String(req.body?.note||'').trim().slice(0,500);
 if(!uuid.test(queueItemId))return res.status(400).json({error:'Choose a valid responsibility first.'});
 if(req.method==='POST'&&!REASONS[reason])return res.status(400).json({error:'Choose the kind of help you need.'});
 try{
  if(req.method==='GET'){
   const existing=(await pool.query(\`SELECT support_acknowledged_at,sent_at FROM aria_internal_messages
    WHERE organization_id=$1 AND sender_user_id=$2 AND status='sent'
      AND metadata->>'kind'='operator_support_request' AND metadata->>'queue_item_id'=$3
    ORDER BY sent_at DESC LIMIT 1\`,[req.org.id,req.user.id,queueItemId])).rows[0]||null;
   return res.status(200).json({requested:Boolean(existing),acknowledged:Boolean(existing?.support_acknowledged_at),sent_at:existing?.sent_at||null});
  }
  const item=(await pool.query(`SELECT id,task_kind,status,assigned_user_id,queue_date
   FROM aria_daily_queue_items
   WHERE id=$1::uuid AND organization_id=$2 AND assigned_user_id=$3
     AND status IN('pending','deferred') AND task_kind<>'internal_message'
   LIMIT 1`,[queueItemId,req.org.id,req.user.id])).rows[0];
  if(!item)return res.status(404).json({error:'This responsibility is no longer assigned to you.'});

  const org=(await pool.query(`SELECT settings FROM organizations WHERE id=$1 LIMIT 1`,[req.org.id])).rows[0];
  const championId=String(org?.settings?.adoption?.operator_champion_user_id||'');
  let recipient=null;
  if(uuid.test(championId)&&championId!==String(req.user.id)){
   recipient=(await pool.query(`SELECT id,name,role FROM users WHERE id=$1::uuid AND organization_id=$2 AND active=true AND role='user' LIMIT 1`,[championId,req.org.id])).rows[0]||null;
  }
  if(!recipient){
   recipient=(await pool.query(`SELECT id,name,role FROM users
    WHERE organization_id=$1 AND active=true AND role IN('owner','admin') AND id<>$2
    ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END,created_at ASC
    LIMIT 1`,[req.org.id,req.user.id])).rows[0]||null;
  }
  if(!recipient)return res.status(409).json({error:'No active support contact is available. Please speak to your organization owner or administrator.'});

  const timezone=String(org?.settings?.timezone||'Africa/Lagos');
  let day;
  try{day=new Intl.DateTimeFormat('en-CA',{timeZone:timezone}).format(new Date())}
  catch{day=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lagos'}).format(new Date())}
  const idempotencyKey='operator-help:'+queueItemId+':'+req.user.id+':'+day;
  const messageBody=['I need help with a responsibility assigned to me.',REASONS[reason],note?('Additional context: '+note):''].filter(Boolean).join(' ');
  const sent=await sendInternalMessage({
   organizationId:req.org.id,senderUserId:req.user.id,recipientUserId:recipient.id,
   body:messageBody,idempotencyKey,
   metadata:{kind:'operator_support_request',source:'operator_support_request',queue_item_id:String(item.id),task_kind:item.task_kind,reason,requested_at:new Date().toISOString()}
  });
  const actualRecipientName=sent.message?.recipient_name||recipient.name||'your support contact';
  const actualRecipientRole=sent.message?.recipient_role||recipient.role;
  return res.status(200).json({
   success:true,already_requested:!sent.created,
   recipient:{name:actualRecipientName,role:actualRecipientRole},
   message:sent.created
    ?'Your request has been shared with '+actualRecipientName+'. They can see the responsibility you linked and help coordinate the next step.'
    :'Your request was already shared with '+actualRecipientName+'. It remains linked to this responsibility.'
  });
 }catch(error){
  console.error('[OPERATOR SUPPORT] request failed:',error?.message||error);
  return res.status(Number(error?.status)||500).json({error:Number(error?.status)?error.message:'NYEOCARE could not send the help request safely.'});
 }
});

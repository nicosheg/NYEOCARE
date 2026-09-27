// lib/aria/internalMessaging.js
import pool from '../db';

const clean=(value,max=4000)=>String(value??'').trim().slice(0,max);
const displayName=row=>String(row?.name||'').trim()||'Unnamed operator';

async function actor(orgId,userId,client=pool){
  const r=await client.query(
    \`SELECT id,name,email,role,active
     FROM users
     WHERE id=$1 AND organization_id=$2 AND active=true
     LIMIT 1\`,
    [userId,orgId]
  );
  return r.rows[0]||null;
}

export async function resolveInternalRecipient({organizationId,name}){
  const q=clean(name,120);
  if(!q)return {kind:'missing'};
  const exact=await pool.query(
    \`SELECT id,name,email,role
     FROM users
     WHERE organization_id=$1 AND active=true
       AND lower(trim(name))=lower(trim($2))
     ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,name
     LIMIT 10\`,
    [organizationId,q]
  );
  if(exact.rows.length===1)return {kind:'resolved',operator:exact.rows[0]};
  const partial=await pool.query(
    \`SELECT id,name,email,role
     FROM users
     WHERE organization_id=$1 AND active=true
       AND lower(name) LIKE '%'||lower($2)||'%'
     ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,name
     LIMIT 10\`,
    [organizationId,q]
  );
  if(partial.rows.length===1)return {kind:'resolved',operator:partial.rows[0]};
  if(!partial.rows.length)return {kind:'not_found',query:q};
  return {
    kind:'ambiguous',
    query:q,
    matches:partial.rows.map(row=>({name:displayName(row),role:row.role}))
  };
}

export async function sendInternalMessage({
  organizationId,
  senderUserId,
  recipientUserId,
  body,
  idempotencyKey=null
}){
  const text=clean(body);
  if(!text)throw Object.assign(new Error('Message text is required.'),{status:400});
  if(text.length>4000)throw Object.assign(new Error('That message is too long. Keep it under 4000 characters.'),{status:400});

  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const sender=await actor(organizationId,senderUserId,client);
    if(!sender)throw Object.assign(new Error('Sender is not an active organization operator.'),{status:403});
    const recipient=await actor(organizationId,recipientUserId,client);
    if(!recipient)throw Object.assign(new Error('Recipient is not an active organization operator.'),{status:404});
    if(String(sender.id)===String(recipient.id))throw Object.assign(new Error('Choose another organization operator.'),{status:400});

    if(idempotencyKey){
      const prior=await client.query(
        \`SELECT id,organization_id,sender_user_id,recipient_user_id,body,status,sent_at,seen_at,unsent_at
         FROM aria_internal_messages
         WHERE organization_id=$1 AND sender_user_id=$2 AND idempotency_key=$3
         LIMIT 1\`,
        [organizationId,senderUserId,String(idempotencyKey)]
      );
      if(prior.rows.length){
        await client.query('COMMIT');
        return {created:false,message:formatMessage(prior.rows[0],sender,recipient)};
      }
    }

    const inserted=await client.query(
      \`INSERT INTO aria_internal_messages
       (organization_id,sender_user_id,recipient_user_id,body,idempotency_key,metadata)
       VALUES($1,$2,$3,$4,$5,$6::jsonb)
       RETURNING id,organization_id,sender_user_id,recipient_user_id,body,status,sent_at,seen_at,unsent_at\`,
      [organizationId,senderUserId,recipientUserId,text,idempotencyKey||null,JSON.stringify({channel:'aria_internal',source:'aria_conversation'})]
    );
    await client.query('COMMIT');
    return {created:true,message:formatMessage(inserted.rows[0],sender,recipient)};
  }catch(err){
    await client.query('ROLLBACK').catch(()=>{});
    if(err?.code==='23505'&&idempotencyKey){
      const prior=await pool.query(
        \`SELECT m.id,m.organization_id,m.sender_user_id,m.recipient_user_id,m.body,m.status,m.sent_at,m.seen_at,m.unsent_at,
                s.name sender_name,s.role sender_role,r.name recipient_name,r.role recipient_role
         FROM aria_internal_messages m
         JOIN users s ON s.id=m.sender_user_id AND s.organization_id=m.organization_id
         JOIN users r ON r.id=m.recipient_user_id AND r.organization_id=m.organization_id
         WHERE m.organization_id=$1 AND m.sender_user_id=$2 AND m.idempotency_key=$3
         LIMIT 1\`,
        [organizationId,senderUserId,String(idempotencyKey)]
      );
      if(prior.rows.length)return {created:false,message:formatRow(prior.rows[0])};
    }
    throw err;
  }finally{client.release();}
}

export async function markInternalMessageSeen({organizationId,recipientUserId,messageId,queueItemId=null}){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const row=(await client.query(
      \`SELECT m.id,m.organization_id,m.sender_user_id,m.recipient_user_id,m.body,m.status,m.sent_at,m.seen_at,m.unsent_at,
              s.name sender_name,s.role sender_role,r.name recipient_name,r.role recipient_role
       FROM aria_internal_messages m
       JOIN users s ON s.id=m.sender_user_id AND s.organization_id=m.organization_id
       JOIN users r ON r.id=m.recipient_user_id AND r.organization_id=m.organization_id
       WHERE m.id=$1 AND m.organization_id=$2 AND m.recipient_user_id=$3
       FOR UPDATE\`,
      [messageId,organizationId,recipientUserId]
    )).rows[0];
    if(!row){await client.query('ROLLBACK');return {ok:false,code:'MESSAGE_NOT_FOUND'};}
    if(row.status==='unsent'){await client.query('ROLLBACK');return {ok:false,code:'MESSAGE_UNSENT',message:formatRow(row)};}
    const updated=(await client.query(
      \`UPDATE aria_internal_messages
       SET seen_at=COALESCE(seen_at,NOW()),updated_at=NOW()
       WHERE id=$1 AND organization_id=$2 AND recipient_user_id=$3 AND status='sent'
       RETURNING seen_at\`,
      [messageId,organizationId,recipientUserId]
    )).rows[0];
    if(queueItemId){
      await client.query(
        \`UPDATE aria_daily_queue_items
         SET status='completed',completed_at=NOW(),updated_at=NOW()
         WHERE id=$1 AND organization_id=$2 AND assigned_user_id=$3 AND task_kind='internal_message'\`,
        [queueItemId,organizationId,recipientUserId]
      );
    }else{
      await client.query(
        \`UPDATE aria_daily_queue_items
         SET status='completed',completed_at=NOW(),updated_at=NOW()
         WHERE organization_id=$1 AND assigned_user_id=$2 AND task_kind='internal_message'
           AND source_id=$3 AND status IN('pending','deferred')\`,
        [organizationId,recipientUserId,String(messageId)]
      );
    }
    await client.query('COMMIT');
    return {ok:true,message:{...formatRow(row),seen_at:updated?.seen_at||row.seen_at}};
  }catch(err){
    await client.query('ROLLBACK').catch(()=>{});
    throw err;
  }finally{client.release();}
}

export async function unsendInternalMessage({
  organizationId,
  senderUserId,
  messageId=null,
  recipientUserId=null,
  idempotencyKey=null
}){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const sender=await actor(organizationId,senderUserId,client);
    if(!sender)throw Object.assign(new Error('Sender is not an active organization operator.'),{status:403});
    const params=[organizationId,senderUserId];
    const filters=['m.organization_id=$1','m.sender_user_id=$2'];
    if(messageId){params.push(String(messageId));filters.push(\`m.id=$\${params.length}\`);}
    if(recipientUserId){params.push(recipientUserId);filters.push(\`m.recipient_user_id=$\${params.length}\`);}
    if(idempotencyKey){params.push(String(idempotencyKey));filters.push(\`m.idempotency_key=$\${params.length}\`);}
    const row=(await client.query(
      \`SELECT m.id,m.organization_id,m.sender_user_id,m.recipient_user_id,m.body,m.status,m.sent_at,m.seen_at,m.unsent_at,
              s.name sender_name,s.role sender_role,r.name recipient_name,r.role recipient_role
       FROM aria_internal_messages m
       JOIN users s ON s.id=m.sender_user_id AND s.organization_id=m.organization_id
       JOIN users r ON r.id=m.recipient_user_id AND r.organization_id=m.organization_id
       WHERE \${filters.join(' AND ')}
       ORDER BY m.sent_at DESC,m.id DESC
       LIMIT 1
       FOR UPDATE\`,
      params
    )).rows[0];
    if(!row){await client.query('ROLLBACK');return {ok:false,code:'MESSAGE_NOT_FOUND'};}
    if(row.status==='unsent'){
      await client.query('COMMIT');
      return {ok:true,alreadyUnsent:true,recipientSaw:!!row.seen_at,message:formatRow(row)};
    }
    const recipientSaw=Boolean(row.seen_at);
    const updated=(await client.query(
      \`UPDATE aria_internal_messages
       SET status='unsent',unsent_at=NOW(),unsent_by=$3,updated_at=NOW()
       WHERE id=$1 AND organization_id=$2 AND sender_user_id=$3 AND status='sent'
       RETURNING unsent_at\`,
      [row.id,organizationId,senderUserId]
    )).rows[0];
    await client.query(
      \`UPDATE aria_daily_queue_items
       SET status='dismissed',completed_at=NOW(),updated_at=NOW()
       WHERE organization_id=$1 AND task_kind='internal_message' AND source_id=$2 AND status IN('pending','deferred')\`,
      [organizationId,String(row.id)]
    );
    await client.query('COMMIT');
    return {
      ok:true,alreadyUnsent:false,recipientSaw,
      message:{...formatRow(row),status:'unsent',unsent_at:updated?.unsent_at||null}
    };
  }catch(err){
    await client.query('ROLLBACK').catch(()=>{});
    throw err;
  }finally{client.release();}
}

export async function listInternalMessages({organizationId,userId,limit=20,includeSent=false}){
  const bounded=Math.min(Math.max(Number(limit)||20,1),50);
  const r=await pool.query(
    \`SELECT m.id,m.body,m.status,m.sent_at,m.seen_at,m.unsent_at,
            s.name sender_name,s.role sender_role,
            r.name recipient_name,r.role recipient_role
     FROM aria_internal_messages m
     JOIN users s ON s.id=m.sender_user_id AND s.organization_id=m.organization_id
     JOIN users r ON r.id=m.recipient_user_id AND r.organization_id=m.organization_id
     WHERE m.organization_id=$1
       AND \${includeSent?'(m.recipient_user_id=$2 OR m.sender_user_id=$2)':'m.recipient_user_id=$2'}
       AND (m.status='sent' OR m.sender_user_id=$2)
     ORDER BY m.sent_at DESC,m.id DESC
     LIMIT $3\`,
    [organizationId,userId,bounded]
  );
  const unread=(await pool.query(
    \`SELECT COUNT(*)::int AS count
     FROM aria_internal_messages
     WHERE organization_id=$1 AND recipient_user_id=$2 AND status='sent' AND seen_at IS NULL\`,
    [organizationId,userId]
  )).rows[0]?.count||0;
  return{messages:r.rows.map(formatRow),unread_count:Number(unread)||0};
}

function formatMessage(row,sender,recipient){
  return {
    id:row.id,organization_id:row.organization_id,sender_user_id:row.sender_user_id,
    recipient_user_id:row.recipient_user_id,sender_name:displayName(sender),sender_role:sender.role,
    recipient_name:displayName(recipient),recipient_role:recipient.role,body:row.body,status:row.status,
    sent_at:row.sent_at,seen_at:row.seen_at||null,unsent_at:row.unsent_at||null
  };
}
function formatRow(row){
  return {
    id:row.id,organization_id:row.organization_id,sender_user_id:row.sender_user_id,recipient_user_id:row.recipient_user_id,
    sender_name:row.sender_name||null,sender_role:row.sender_role||null,recipient_name:row.recipient_name||null,
    recipient_role:row.recipient_role||null,body:row.body,status:row.status,sent_at:row.sent_at,seen_at:row.seen_at||null,unsent_at:row.unsent_at||null
  };
}

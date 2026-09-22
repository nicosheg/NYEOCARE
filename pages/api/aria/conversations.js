// pages/api/aria/conversations.js
import pool from'../../../lib/db';
import{withOrg}from'../../../lib/apiHelpers';

export default withOrg(async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const limit=Math.min(Math.max(Number(req.query?.limit)||12,1),30);
 try{
  const r=await pool.query(`SELECT c.id,c.person_id,c.updated_at,
    COALESCE(p.display_name,TRIM(CONCAT_WS(' ',p.first_name,p.last_name)),'Organization') AS person_name,
    COALESCE((SELECT m.content FROM aria_messages m WHERE m.conversation_id=c.id AND m.role='user' ORDER BY m.created_at ASC LIMIT 1),'Conversation') AS first_message
    FROM aria_conversations c
    LEFT JOIN people p ON p.id=c.person_id AND p.organization_id=c.organization_id
    WHERE c.organization_id=$1 AND c.status='active' AND(c.user_id=$2 OR c.user_id IS NULL)
    ORDER BY c.updated_at DESC
    LIMIT $3`,[req.org.id,req.user.id,limit]);
  return res.status(200).json({conversations:r.rows});
 }catch(e){console.error('[ARIA] conversation list',e);return res.status(500).json({error:'Unable to load recent conversations.'})}
});

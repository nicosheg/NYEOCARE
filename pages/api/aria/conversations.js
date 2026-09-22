// pages/api/aria/conversations.js
import pool from'../../../lib/db';
import{withOrg}from'../../../lib/apiHelpers';

export default withOrg(async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 try{
  const id=String(req.query?.conversationId||'').trim();
  if(id){
   const c=await pool.query(`SELECT id,user_id,person_id,created_at,updated_at FROM aria_conversations WHERE id=$1 AND organization_id=$2 AND status='active' AND(user_id=$3 OR user_id IS NULL) LIMIT 1`,[id,req.org.id,req.user.id]);
   if(!c.rows.length)return res.status(404).json({error:'Conversation not found.'});
   const m=await pool.query(`SELECT id,role,content,created_at FROM aria_messages WHERE conversation_id=$1 ORDER BY created_at ASC,id ASC LIMIT 40`,[id]);
   return res.status(200).json({conversation:c.rows[0],messages:m.rows});
  }
  const limit=Math.min(Math.max(Number(req.query?.limit)||30,1),30);
  const r=await pool.query(`SELECT c.id,c.person_id,c.created_at,c.updated_at,
    COALESCE(p.display_name,TRIM(CONCAT_WS(' ',p.first_name,p.last_name)),'Organization') AS person_name,
    COALESCE((SELECT LEFT(m.content,160) FROM aria_messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC LIMIT 1),'Conversation') AS preview
    FROM aria_conversations c
    LEFT JOIN people p ON p.id=c.person_id AND p.organization_id=c.organization_id
    WHERE c.organization_id=$1 AND c.status='active' AND(c.user_id=$2 OR c.user_id IS NULL)
    ORDER BY c.updated_at DESC
    LIMIT $3`,[req.org.id,req.user.id,limit]);
  return res.status(200).json({conversations:r.rows});
 }catch(e){console.error('[ARIA] conversations',e);return res.status(500).json({error:'Unable to load ARIA conversations.'})}
});

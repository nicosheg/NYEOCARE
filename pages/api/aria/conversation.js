// pages/api/aria/conversation.js
import pool from'../../../lib/db';
import{withOrg}from'../../../lib/apiHelpers';

async function handler(req,res){
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const orgId=req.org.id,userId=req.user.id,id=String(req.query?.conversationId||'').trim(),personId=String(req.query?.personId||'').trim()||null;
 try{
  if(id){
   const c=await pool.query(
    `SELECT id,user_id,person_id,status,created_at,updated_at
     FROM aria_conversations
     WHERE id=$1 AND organization_id=$2 AND status='active'
       AND(user_id=$3 OR user_id IS NULL)
     LIMIT 1`,[id,orgId,userId]);
   if(!c.rows.length)return res.status(404).json({error:'Conversation not found.'});
   const m=await pool.query(
    `SELECT id,role,content,created_at
     FROM aria_messages
     WHERE conversation_id=$1
     ORDER BY created_at ASC
     LIMIT 80`,[id]);
   return res.status(200).json({conversation:c.rows[0],messages:m.rows});
  }
  const c=await pool.query(
   `SELECT id,user_id,person_id,status,created_at,updated_at
    FROM aria_conversations
    WHERE organization_id=$1 AND status='active'
      AND(user_id=$2 OR user_id IS NULL)
      AND(person_id IS NOT DISTINCT FROM $3::uuid)
    ORDER BY updated_at DESC
    LIMIT 1`,[orgId,userId,personId]);
  if(!c.rows.length)return res.status(200).json({conversation:null,messages:[]});
  const m=await pool.query(
   `SELECT id,role,content,created_at
    FROM aria_messages
    WHERE conversation_id=$1
    ORDER BY created_at ASC
    LIMIT 80`,[c.rows[0].id]);
  return res.status(200).json({conversation:c.rows[0],messages:m.rows});
 }catch(e){
  console.error('[ARIA] conversation load',e);
  return res.status(500).json({error:'Unable to load this conversation.'});
 }
}
export default withOrg(handler);

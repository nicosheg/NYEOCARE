// pages/api/aria/chat.js
import{withOrg}from'../../../lib/apiHelpers';
import{handleConversation}from'../../../lib/aria/conversationEngine';

export default withOrg(async function handler(req,res){
 if(req.method!=='POST'){
  res.setHeader('Allow','POST');
  return res.status(405).json({error:'Method not allowed'});
 }
 const message=typeof req.body?.message==='string'?req.body.message.trim():'';
 if(!message)return res.status(400).json({error:'Message is required.'});
 try{
  const result=await handleConversation({organizationId:req.org.id,userId:req.user.id,message,conversationId:req.body?.conversationId||null,personId:req.body?.personId||null});
  return res.status(200).json(result);
 }catch(err){
  console.error('[ARIA] Conversation:',err);
  const status=[400,401,403,404,409].includes(Number(err.status))?Number(err.status):500;
  const raw=String(err?.message||'');
  const safe=status<500&&!/(uuid|syntax|operator|relation|column|query|database|postgres|sql|constraint|cast)/i.test(raw)?raw:null;
  return res.status(status).json({error:safe||'I could not complete that request right now. I do not want to expose an internal system error or guess at the answer.'});
 }
});

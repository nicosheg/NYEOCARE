// lib/aria/conversationEngine.js
import pool from'../db';
import{runCommand}from'./commandEngine';
import{generateText}from'../aiGateway';

const clean=(v,max=5000)=>String(v??'').trim().slice(0,max);

function summarizeResult(result){
 if(!result)return'';
 if(result.type==='clarification'||result.type==='action_prepared')return result.text||'';
 if(result.type==='completed'){
  const parts=[];
  for(const item of result.results||[]){
   if(item.capability==='find_person')parts.push(`Found ${item.results?.length||0} matching people.`);
   if(item.capability==='get_pending_actions')parts.push(`There are ${item.actions?.length||0} pending actions.`);
   if(item.capability==='get_care_recommendations')parts.push(`There are ${item.recommendations?.length||0} care opportunities.`);
   if(item.capability==='get_person_context'||item.capability==='explain_person')parts.push('I retrieved the person’s current context.');
   if(item.capability==='prepare_message')parts.push('A message has been prepared for review.');
   if(item.capability==='prepare_action')parts.push('An action has been prepared for approval.');
  }
  return parts.join(' ');
 }
 return'';
}

async function naturalResponse({organizationId,message,result,history=[]}){
 const direct=summarizeResult(result);
 if(result.type==='clarification'||result.type==='action_prepared')return direct;
 try{
  const ai=await generateText({organizationId,purpose:'aria_conversation_response',maxTokens:450,temperature:.25,system:`You are ARIA inside NYEOCARE. Speak naturally and briefly. Use only supplied results. Never invent facts. Never claim an action happened when it was only prepared. Never expose implementation details. If something requires approval, say so clearly.`,messages:[...history.slice(-8).map(x=>({role:x.role==='assistant'?'assistant':'user',content:clean(x.content,2500)})),{role:'user',content:`Request: ${message}\nResult: ${JSON.stringify(result).slice(0,18000)}`}]});
  return clean(ai.text,5000);
 }catch{return direct||'I completed the part of that request I could safely process.'}
}

export async function handleConversation({organizationId,message,history=[],conversationId=null,userId=null,personId=null}){
 if(!organizationId)throw new Error('organizationId required');
 if(!userId)throw Object.assign(new Error('userId required'),{status:401});
 const input=clean(message);
 if(!input)throw Object.assign(new Error('Message required'),{status:400});
 const targetId=personId?String(personId):null;
 if(targetId){
  const person=await pool.query(`SELECT id FROM people WHERE id=$1 AND organization_id=$2 AND COALESCE(status,'active')='active' LIMIT 1`,[targetId,organizationId]);
  if(!person.rows.length)throw Object.assign(new Error('Person not found'),{status:404});
 }
 let conversation;
 if(conversationId){
  const existing=await pool.query(`SELECT id,user_id,person_id FROM aria_conversations WHERE id=$1 AND organization_id=$2 AND status='active' LIMIT 1`,[conversationId,organizationId]);
  if(!existing.rows.length)throw Object.assign(new Error('Conversation not found'),{status:404});
  if(existing.rows[0].user_id&&existing.rows[0].user_id!==userId)throw Object.assign(new Error('Conversation access denied'),{status:403});
  if(targetId&&existing.rows[0].person_id&&existing.rows[0].person_id!==targetId)throw Object.assign(new Error('Conversation belongs to another person'),{status:403});
  if(targetId&&!existing.rows[0].person_id)await pool.query(`UPDATE aria_conversations SET person_id=$1,updated_at=NOW() WHERE id=$2 AND organization_id=$3`,[targetId,existing.rows[0].id,organizationId]);
  conversation=existing.rows[0];
 }else{
  conversation=(await pool.query(`INSERT INTO aria_conversations(organization_id,user_id,person_id,status) VALUES($1,$2,$3,'active') RETURNING id,user_id,person_id`,[organizationId,userId,targetId])).rows[0];
 }
 const persisted=await pool.query(`SELECT role,content FROM aria_messages WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 20`,[conversation.id]);
 const safeHistory=persisted.rows.reverse();
 await pool.query(`INSERT INTO aria_messages(conversation_id,role,content,metadata) VALUES($1,'user',$2,$3)`,[conversation.id,input,targetId?{person_id:targetId}:{}]);
 const result=await runCommand({organizationId,userId,message:input,history:safeHistory,personId:targetId});
 const text=await naturalResponse({organizationId,message:input,result,history:safeHistory});
 await pool.query(`INSERT INTO aria_messages(conversation_id,role,content,metadata) VALUES($1,'assistant',$2,$3)`,[conversation.id,text,{result_type:result.type||null,person_id:targetId}]);
 await pool.query(`UPDATE aria_conversations SET updated_at=NOW() WHERE id=$1 AND organization_id=$2 AND(user_id=$3 OR user_id IS NULL)`,[conversation.id,organizationId,userId]);
 return{...result,text,conversationId:conversation.id};
}

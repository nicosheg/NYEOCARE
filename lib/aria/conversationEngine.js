// lib/aria/conversationEngine.js
import pool from'../db';
import{runCommand}from'./commandEngine';
import{generateText}from'../aiGateway';import{ARIA_CORE_PERSONALITY}from'./corePersonality';

const clean=(v,max=5000)=>String(v??'').trim().slice(0,max);

function suggestedActionFromResult(result,personId){
 if(!result)return null;
 for(const item of result.results||[]){
  if(item.capability==='get_person_context'||item.capability==='explain_person'){
   const a=item.intelligence?.next_best_action;
   if(a)return{personId,actionType:a==='SEND_MESSAGE'?'SEND_MESSAGE':'REQUEST_REVIEW',label:a==='SEND_MESSAGE'?'Prepare a check-in':'Review next step',reason:item.intelligence?.action_reason||'ARIA identified a meaningful next step.',approved:false,requiresApproval:true};
   const pending=(item.pending_actions||[]).find(x=>x.status==='proposed'||x.status==='approved');
   if(pending)return{personId,actionId:pending.id,actionType:pending.type,label:pending.type==='SEND_MESSAGE'?(pending.status==='approved'?'Draft message':'Prepare message'):'Review action',reason:pending.action_metadata?.reason||'ARIA has a prepared next step.',approved:pending.status==='approved',requiresApproval:pending.status!=='approved'};
  }
  if(item.capability==='get_care_recommendations'&&item.recommendations?.[0]){
   const r=item.recommendations[0];
   return{personId:r.person_id,actionId:r.action_id||null,actionType:r.action_type||'SEND_MESSAGE',label:r.action_type==='SEND_MESSAGE'?'Prepare message':'Review next step',reason:r.care_reason||r.reason||'ARIA identified a care opportunity.',approved:r.action_status==='approved',requiresApproval:r.action_status!=='approved'};
  }
 }
 return null;
}
function summarizeResult(result){
 if(!result)return'';
 if(result.type==='clarification'||result.type==='action_prepared')return result.text||'';
 if(result.type!=='completed')return'';
 const parts=[];
 for(const item of result.results||[]){
  if(item.capability==='find_person'){
   const people=item.results||[];
   if(!people.length)parts.push('I could not find a matching person.');
   else {const names=people.slice(0,4).map(p=>p.display_name||[p.first_name,p.last_name].filter(Boolean).join(' ')).join(', ');parts.push('I found '+people.length+' matching '+(people.length===1?'person.':'people.')+(names?' '+names:''));}
  }
  if(item.capability==='get_pending_actions'){
   const actions=item.actions||[];parts.push(actions.length?'There '+(actions.length===1?'is 1 pending action':'are '+actions.length+' pending actions')+' for review.':'There are no pending actions right now.');
   if(actions.length)parts.push(actions.slice(0,3).map(a=>(a.display_name||[a.first_name,a.last_name].filter(Boolean).join(' ')||'Someone')+' · '+a.type).join('; '));
  }
  if(item.capability==='get_care_recommendations'){
   const rec=item.recommendations||[];parts.push(rec.length?'ARIA found '+rec.length+' care opportunit'+(rec.length===1?'y.':'ies.'):'ARIA does not have a care opportunity to surface right now.');
   if(rec[0])parts.push('One current opportunity: '+(rec[0].care_reason||rec[0].reason||'review the person context')+'.');
  }
  if(item.capability==='get_person_context'||item.capability==='explain_person'){
   const p=item.person||{};const i=item.intelligence||{};const memory=(item.memory||[]).length;const history=(item.timeline||[]).length;
   parts.push('I checked '+(p.display_name||[p.first_name,p.last_name].filter(Boolean).join(' ')||'this person')+'’s current context.');
   if(i.lifecycle_state)parts.push('Current journey state: '+i.lifecycle_state+'.');
   if(i.next_best_action)parts.push('Next best action: '+(i.next_best_action==='SEND_MESSAGE'?'prepare a personal check-in':'review the next step')+'.');
   if(memory||history)parts.push('ARIA has '+memory+' remembered detail'+(memory===1?'':'s')+' and '+history+' recent timeline record'+(history===1?'':'s')+' in the loaded context.');
  }
  if(item.capability==='get_organization_context'){
   const c=item.counts||{};const o=item.operatorSupport||{};parts.push('I checked the organization context: '+(c.people||item.people?.length||0)+' people, '+(c.pending_followups||item.followups?.length||0)+' open follow-ups, and '+(c.attention_items||item.attention?.length||0)+' attention items.');
   if(o.overdueTasks)parts.push(o.overdueTasks+' task'+(o.overdueTasks===1?' is':'s are')+' overdue.');
  }
  if(item.capability==='prepare_message')parts.push('A message has been prepared for review; it has not been sent.');
  if(item.capability==='prepare_action')parts.push('An action has been prepared and still requires human approval.');
 }
 return parts.filter(Boolean).join(' ');
}
async function naturalResponse({organizationId,message,result,history=[]}){
 const direct=summarizeResult(result);
 if(result.type==='clarification'||result.type==='action_prepared')return direct;
 const needsNarrative=/\b(why|explain|interpret|compare|should i|how should i|what does this mean|help me decide|think through|talk me through)\b/i.test(message);
 if(direct&&!needsNarrative)return direct;
 try{
  const ai=await generateText({
   organizationId,
   purpose:'aria_conversation_response',
   maxTokens:360,
   temperature:.25,
   system:`${ARIA_CORE_PERSONALITY}\n\nSpeak naturally and briefly. Use only supplied results. Never invent facts. Never claim an action happened when it was only prepared. Never expose implementation details. If something requires approval, say so clearly.`,
   messages:[...history.slice(-6).map(x=>({role:x.role==='assistant'?'assistant':'user',content:clean(x.content,1800)})),{role:'user',content:`Request: ${message}\nResult: ${JSON.stringify(result).slice(0,14000)}`}]
  });
  return clean(ai.text,5000);
 }catch{return direct||'I completed the part of that request I could safely process.'}
}
export async function handleConversation({organizationId,message,history=[],conversationId=null,userId=null,personId=null}){
 if(!organizationId)throw new Error('organizationId required');if(!userId)throw Object.assign(new Error('userId required'),{status:401});const input=clean(message);if(!input)throw Object.assign(new Error('Message required'),{status:400});const targetId=personId?String(personId):null;let personName='';
 if(targetId){const person=await pool.query(`SELECT id,first_name,last_name,display_name FROM people WHERE id=$1 AND organization_id=$2 AND COALESCE(status,'active')='active' LIMIT 1`,[targetId,organizationId]);if(!person.rows.length)throw Object.assign(new Error('Person not found'),{status:404});const p=person.rows[0];personName=p.display_name||[p.first_name,p.last_name].filter(Boolean).join(' ')}
 let conversation;
 if(conversationId){const existing=await pool.query(`SELECT id,user_id,person_id FROM aria_conversations WHERE id=$1 AND organization_id=$2 AND status='active' LIMIT 1`,[conversationId,organizationId]);if(!existing.rows.length)throw Object.assign(new Error('Conversation not found'),{status:404});if(existing.rows[0].user_id&&existing.rows[0].user_id!==userId)throw Object.assign(new Error('Conversation access denied'),{status:403});if(targetId&&existing.rows[0].person_id&&existing.rows[0].person_id!==targetId)throw Object.assign(new Error('Conversation belongs to another person'),{status:403});if(targetId&&!existing.rows[0].person_id)await pool.query(`UPDATE aria_conversations SET person_id=$1,updated_at=NOW() WHERE id=$2 AND organization_id=$3`,[targetId,existing.rows[0].id,organizationId]);conversation=existing.rows[0];
 }else conversation=(await pool.query(`INSERT INTO aria_conversations(organization_id,user_id,person_id,status) VALUES($1,$2,$3,'active') RETURNING id,user_id,person_id`,[organizationId,userId,targetId])).rows[0];
 const persisted=await pool.query(`SELECT role,content FROM aria_messages WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 20`,[conversation.id]);const safeHistory=persisted.rows.reverse();await pool.query(`INSERT INTO aria_messages(conversation_id,role,content,metadata) VALUES($1,'user',$2,$3)`,[conversation.id,input,targetId?{person_id:targetId}:{}]);
 const commandMessage=targetId?`The current Person Journey is for ${personName||'this person'} (person id ${targetId}). Answer or act specifically about this person unless the user clearly asks about someone else. User request: ${input}`:input;
 const result=await runCommand({organizationId,userId,message:commandMessage,history:safeHistory});const text=await naturalResponse({organizationId,message:input,result,history:safeHistory});
 const suggestedAction=suggestedActionFromResult(result,targetId);await pool.query(`INSERT INTO aria_messages(conversation_id,role,content,metadata) VALUES($1,'assistant',$2,$3)`,[conversation.id,text,{result_type:result.type||null,person_id:targetId}]);await pool.query(`UPDATE aria_conversations SET updated_at=NOW() WHERE id=$1 AND organization_id=$2 AND(user_id=$3 OR user_id IS NULL)`,[conversation.id,organizationId,userId]);return{...result,text,conversationId:conversation.id,suggestedAction};
}

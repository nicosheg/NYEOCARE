// lib/aria/conversationEngine.js
import pool from'../db';
import{runCommand}from'./commandEngine';import{executeCapability}from'./capabilityEngine';
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
 if(result.type!=='completed'&&result.type!=='conversation_context')return'';
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
const ACTION_WORDS=/\b(draft|prepare|send|message|approve|reject|execute|follow up|check in|contact|invite|assign|create an action)\b/i;
const SIMPLE_MATCHERS=[
 [/^(hi|hello|hey|good morning|good afternoon|good evening)\b/i,'Hello. What would you like me to help you with in NYEOCARE?'],
 [/what can you do|what are you able to do|help me|how can you help/i,'I can help you find people, understand their history, surface care priorities, prepare messages, review pending actions and prepare NYEOCARE actions for your approval. I can also explain how to use any part of the system.'],
 [/who created|who built|who made|creator of nyeocare|founder of nyeocare/i,'NYEOCARE was created by Egwame Oshiogwe Nicholas. ARIA is the intelligence layer designed to help organizations remember people and act with care while keeping important decisions with humans.'],
 [/what is nyeocare|what does nyeocare do|tell me about nyeocare|how does nyeocare work/i,'NYEOCARE is a people memory and care operating system for organizations. It helps you remember people, capture attendance, reconcile identities, surface meaningful care opportunities and prepare actions without taking human approval away.'],
 [/how does attendance work|how do i take attendance|how to take attendance|start attendance/i,'Open Attendance, start a session, mark people as you see them, then save the session. Your attendance is stored immediately; ARIA continues understanding the session in the background, so you can start the next session without waiting for her.'],
 [/how does scanning work|how do i scan|how to scan|scan a register/i,'Open Scan, take a clear photo or upload the register, then let ARIA read the rows, audit name-and-phone relationships and reconcile the identities she can safely match. Uncertain results go to Review Center rather than being guessed.']
];
function simpleConversation(message){for(const[m,text]of SIMPLE_MATCHERS)if(m.test(message))return text;return null}

function joinContinuation(left,right){
 const a=String(left??'').trimEnd(),b=String(right??'').trimStart();
 if(!a)return b;if(!b)return a;
 if(/^[,.;:!?%)\\]]/.test(b))return a+b;
 return a+' '+b;
}


function responseProfile(message,result,history=[]){
 const text=String(message??'').trim().toLowerCase();
 const explicitLong=/\b(detailed|in detail|deep|deep dive|thorough|comprehensive|full explanation|explain fully|step[- ]by[- ]step|walk me through|break (it|this) down|teach me|compare|pros and cons|reasoning|why exactly)\b/.test(text);
 const explicitShort=/\b(brief|briefly|quick|quickly|short|shortly|one sentence|just tell me|simply)\b/.test(text);
 const decision=/\b(what should i do next|what do i do next|what matters most|what needs my attention|who needs attention|what changed today|what changed recently)\b/.test(text);
 const complexResult=(result?.results||[]).reduce((score,item)=>{
  score+=(item.people?.length||0)+(item.attention?.length||0)+(item.followups?.length||0)+(item.timeline?.length||0)+(item.memory?.length||0)+(item.feedback?.length||0);
  score+=(item.recommendations?.length||0)+(item.actions?.length||0);
  return score;
 },0);
 const multiPart=(text.match(/[?;]/g)||[]).length>=2||text.split(/\s+/).filter(Boolean).length>=22;
 if(explicitShort)return{mode:'concise',maxTokens:280,continuationTokens:420};
 if(explicitLong)return{mode:'deep',maxTokens:900,continuationTokens:900};
 if(decision)return{mode:'decision',maxTokens:520,continuationTokens:650};
 if(multiPart||complexResult>=18)return{mode:'standard',maxTokens:600,continuationTokens:700};
 if(history.length>=4)return{mode:'concise',maxTokens:340,continuationTokens:500};
 return{mode:'concise',maxTokens:360,continuationTokens:500};
}

function responseInstructions(profile){
 if(profile.mode==='deep')return'Give a genuinely detailed explanation because the user asked for depth. Structure it clearly and include the reasoning and evidence needed; remove filler.';
 if(profile.mode==='decision')return'Give focused decision support. Lead with the priority, then the smallest set of reasons or actions needed. Usually 3–6 bullets or a few short paragraphs. Do not dump every available record.';
 if(profile.mode==='standard')return'Handle the multiple or complex parts cleanly. Cover the necessary evidence and implications, but prefer summaries over exhaustive lists.';
 return'Lead with the answer. Usually use 2–5 sentences or a short list. Stop once the user has what they need. Do not add a recap, ceremonial intro, or unnecessary closing question.';
}
async function naturalResponse({organizationId,message,result,history=[]}){
 const direct=summarizeResult(result);
 if(result.type==='clarification'||result.type==='action_prepared')return direct;
 if(result.type==='response'&&result.text)return result.text;
 const profile=responseProfile(message,result,history);
 const needsNarrative=profile.mode!=='concise';
 if(direct&&!needsNarrative)return direct;
 const system=`${ARIA_CORE_PERSONALITY}\\n\\nCognitive response behavior:\\n- Brevity is the default. Match length to the user's cognitive need, not to the amount of data available.\\n- Lead with the most useful point and use progressive disclosure. Answer the core first; add context only when it materially helps.\\n- Do not repeat facts already established unless repetition prevents confusion.\\n- Prefer a small number of high-value signals over exhaustive lists.\\n- Ask for clarification when a critical piece of context is missing rather than filling space with assumptions.\\n- Expand only when the user asks for depth or the task genuinely needs multiple or complex reasoning steps.\\n- Never use length to sound intelligent. Stop when the thought is complete.\\n- Use only supplied results. Never invent facts, hide uncertainty, or claim an action happened when it was only prepared.\\n- Consequential actions require human approval.\\n\\nCurrent response mode: ${profile.mode}.\\n${responseInstructions(profile)}\\n\\nUse Markdown when it improves readability: headings, numbered or bulleted lists, bold emphasis and italics are welcome. Never deliberately end on an incomplete sentence.`;
 const baseMessages=[...history.slice(-6).map(x=>({role:x.role==='assistant'?'assistant':'user',content:clean(x.content,1800)})),{role:'user',content:`Request: ${message}\\nResult: ${JSON.stringify(result).slice(0,14000)}`}];
 try{
  let pass=await generateText({
   organizationId,
   purpose:'aria_conversation_response',
   maxTokens:profile.maxTokens,
   temperature:.25,
   system,
   messages:baseMessages
  });
  let text=pass.text,finishReason=pass.finishReason||'stop';
  for(let attempt=0;attempt<2&&finishReason==='length';attempt++){
   const continuation=await generateText({
    organizationId,
    purpose:'aria_conversation_response_continuation',
    maxTokens:profile.continuationTokens,
    temperature:.2,
    system,
    messages:[...baseMessages,{role:'assistant',content:text},{role:'user',content:'The response above was cut off by the output limit. Continue exactly from where it stopped without repeating completed content. Finish the incomplete thought, then complete the answer. Output only the continuation.'}]
   });
   text=joinContinuation(text,continuation.text);
   finishReason=continuation.finishReason||'stop';
  }
  if(finishReason==='length'){
   if(direct)return direct;
   throw Object.assign(new Error('ARIA could not finish the response. Please try that question again.'),{status:503,retryable:true});
  }
  return clean(text,12000);
 }catch(err){
  if(err?.status===503)throw err;
  return direct||'I completed the part of that request I could safely process.';
 }
}
export async function handleConversation({organizationId,message,history=[],conversationId=null,userId=null,personId=null}){
 if(!organizationId)throw new Error('organizationId required');
 if(!userId)throw Object.assign(new Error('userId required'),{status:401});
 const input=clean(message);if(!input)throw Object.assign(new Error('Message required'),{status:400});
 const targetId=personId?String(personId):null;let personName='';
 if(targetId){
  const person=await pool.query(`SELECT id,first_name,last_name,display_name FROM people WHERE id=$1 AND organization_id=$2 AND COALESCE(status,'active')='active' LIMIT 1`,[targetId,organizationId]);
  if(!person.rows.length)throw Object.assign(new Error('Person not found'),{status:404});
  const p=person.rows[0];personName=p.display_name||[p.first_name,p.last_name].filter(Boolean).join(' ');
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
 let result;
 const simple=simpleConversation(input);
 if(simple){
  result={type:'response',text:simple,plan:{goal:'deterministic_conversation',confidence:1,steps:[]},results:[]};
 }else if(!ACTION_WORDS.test(input)){
  const cap=targetId
   ?await executeCapability({organizationId,capability:'get_person_context',personId:targetId,actorId:userId})
   :await executeCapability({organizationId,capability:'get_organization_context',actorId:userId});
  result={type:'conversation_context',plan:{goal:'conversational_context',confidence:1,steps:[]},results:[cap]};
 }else{
  const commandMessage=targetId?`The current Person Journey is for ${personName||'this person'} (person id ${targetId}). Answer or act specifically about this person unless the user clearly asks about someone else. User request: ${input}`:input;
  result=await runCommand({organizationId,userId,message:commandMessage,history:safeHistory});
 }
 const text=await naturalResponse({organizationId,message:input,result,history:safeHistory});
 const suggestedAction=suggestedActionFromResult(result,targetId);
 await pool.query(`INSERT INTO aria_messages(conversation_id,role,content,metadata) VALUES($1,'assistant',$2,$3)`,[conversation.id,text,{result_type:result.type||null,person_id:targetId}]);
 await pool.query(`UPDATE aria_conversations SET updated_at=NOW() WHERE id=$1 AND organization_id=$2 AND(user_id=$3 OR user_id IS NULL)`,[conversation.id,organizationId,userId]);
 return{...result,text,conversationId:conversation.id,suggestedAction};
}

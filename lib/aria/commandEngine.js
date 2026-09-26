// lib/aria/commandEngine.js
import{generateText}from'../aiGateway';import{ARIA_CORE_PERSONALITY}from'./corePersonality';
import{getCapability,isValidActionType}from'./capabilityRegistry';
import{executeCapability}from'./capabilityEngine';
import{planActionFromObservation}from'./recommendationEngine';
import{inferCohortFromText}from'./cohortEngine';

const clean=(v,max=5000)=>String(v??'').trim().slice(0,max);

const SYSTEM=`${ARIA_CORE_PERSONALITY}\n\nYou are the operating intelligence inside NYEOCARE.

Capabilities:
- find_person
- get_organization_context
- get_person_context
- explain_person
- get_care_recommendations
- get_pending_actions
- get_operator_context
- get_organization_changes
- get_director_briefing
- get_attention_summary
- get_person_timeline
- get_person_evidence
- get_observation_context
- resolve_people_cohort
- draft_message
- draft_message_cohort
- remember_person_fact
- remember_organization_fact
- remember_relationship
- set_event_semantics
 - prepare_message
- prepare_action

Rules:
- Never invent capabilities.
- Be proactive when evidence supports a helpful next step; positive opportunities such as welcome, recognition, belonging and contribution are first-class care signals.
- Never turn retention into pressure, guilt, fear, or dependency.
- Never infer a person’s calling, personality, health, motives, or private circumstances from weak signals.
- Consequential external actions remain preparation-only and require explicit human confirmation.
- Explicit memory/correction requests may write provenance-aware memory when the current actor is authorized; never create durable memory merely from an inference or a retrieved record.
- Drafting text is an internal preparation step and may happen immediately when the user explicitly requests a draft. External sending or consequential state changes remain approval-gated.
- Never claim an external action was executed when it was only prepared.
- Never send messages autonomously.
- Never guess a person when multiple people match.
- For organization-wide questions about people, birthdays, follow-ups, attention, invitations, operators, access, or what NYEOCARE knows about the organization, use get_organization_context.
- For what changed, what happened recently, or time-window questions, prefer get_organization_changes.
- For who needs attention, what matters now, or what should I review, prefer get_attention_summary.
- For one person's history, use get_person_timeline.
- For what do you know, remember, why are you saying that, or evidence/uncertainty questions about one person, use get_person_evidence.
- For questions about one specific ARIA observation, use get_observation_context.
- For cohort/group questions, use resolve_people_cohort before drafting or recommending anything for multiple people.
- For drafting a message, use draft_message for one named person and draft_message_cohort for a bounded group. A draft is not a send and does not require a confirmation step. If the user says "on WhatsApp", preserve channel=whatsapp so the UI opens WhatsApp with each message pre-filled.
- Explicit quantity language is binding: "for 5 people" means at most 5 people; "for only [person]" means one person; a named person wins over a generic cohort. Never silently expand a requested quantity.
- For one named operator's activity, invitation/joining history, role or access, use get_operator_context and pass operator_name.
- Server-side role filtering is mandatory: owners may see detailed operator records; admins may see detailed user records but only basic owner/admin records; users may see detailed user records but only basic owner/admin records; every operator may see their own detailed record.
- Never treat an organization operator as a People record unless the user explicitly asks about that person's People profile.
- Keep the organization boundary strict: use only current-organization data for organizational questions; never expose internal IDs, invitation tokens, passwords or authentication secrets.
- Read operations may execute immediately.
- State-changing external operations are preparation only. Explicit memory writes are permitted only when the actor directly asks ARIA to remember/correct something and the capability enforces the required role boundary.
- If the request is ambiguous, return no steps.
- Return only JSON.

Return:
{"goal":"string","confidence":0,"steps":[{"capability":"string","person_name":null,"operator_name":null,"parameters":{}}]}`;

function deterministicPlan(input){
 const text=input.toLowerCase();

 if(/^(hi|hello|hey|good morning|good afternoon|good evening)\b/.test(text))return{goal:'greeting',confidence:1,steps:[]};

 if(/what can you do|what are you able to do|help me|how can you help/.test(text))return{goal:'help',confidence:1,steps:[]};

 if(/who created|who built|who made|creator of nyeocare|founder of nyeocare/.test(text))return{goal:'creator',confidence:1,steps:[]};
 if(/what is nyeocare|what does nyeocare do|tell me about nyeocare|how does nyeocare work/.test(text))return{goal:'about_nyeocare',confidence:1,steps:[]};
 if(/how does attendance work|how do i take attendance|how to take attendance|start attendance/.test(text))return{goal:'attendance_help',confidence:1,steps:[]};
 if(/how does scanning work|how do i scan|how to scan|scan a register/.test(text))return{goal:'scan_help',confidence:1,steps:[]};

 if(/\bdraft\b/.test(text)&&/\bmessage\b/.test(text)){
  const channel=/\bon whatsapp\b|\bwhatsapp\b/.test(text)?'whatsapp':'app';
  const onlyPerson=input.match(/\bonly\s+(?:for\s+)?([a-z][a-z0-9.'-]*(?:\s+[a-z][a-z0-9.'-]*){0,5})\s*(?:person)?$/i);
  if(onlyPerson&&!/\b(?:people|persons|members)\b/i.test(onlyPerson[1])){
   return{goal:'draft one message for the explicitly selected person',confidence:.99,steps:[{capability:'draft_message',person_name:clean(onlyPerson[1],160),operator_name:null,parameters:{channel}}]};
  }
  const scope=inferCohortFromText(input);
  if(scope.key||scope.all){
   return{goal:'draft messages for a selected cohort',confidence:.98,steps:[{capability:'draft_message_cohort',person_name:null,operator_name:null,parameters:{cohort:scope.key||'current_attention',limit:scope.count||null,all:scope.all,channel}}]};
  }
  if(scope.count){
   return{goal:'missing_draft_cohort',confidence:1,steps:[]};
  }
 }
 if(/pending|awaiting approval|waiting for approval|actions? (to )?review/.test(text))return{goal:'view pending actions',confidence:.98,steps:[{capability:'get_pending_actions',person_name:null,operator_name:null,parameters:{}}]};

 if(/newly invited|recently invited|pending invitation|invitation|who was invited|who joined|who has access|organization admins?|organization users?|operators?|staff|operator activity|admin activity|user activity/.test(text))return{goal:'view organization access and operator context',confidence:.98,steps:[{capability:'get_organization_context',person_name:null,operator_name:null,parameters:{}}]};

 if(/what changed|what happened recently|recent changes|changed this week|changed today/.test(text))return{goal:'view recent organization changes',confidence:.98,steps:[{capability:'get_organization_changes',person_name:null,parameters:{days:30,limit:25}}]};

 if(/walk me through.*briefing|today'?s briefing|what matters most|who needs attention|what matters now|what matters today|who should i check|needs my attention/.test(text))return{goal:'view_aria_director_briefing',confidence:.99,steps:[{capability:'get_director_briefing',person_name:null,parameters:{limit:8}}]};

 if(/what do i need to know|what should i know|brief me|give me a briefing|catch me up/.test(text))return{goal:'brief current organization state',confidence:.97,steps:[{capability:'get_director_briefing',person_name:null,operator_name:null,parameters:{limit:8}}]};

 if(/recommend|care opportunit|people need care/.test(text))return{goal:'view care recommendations',confidence:.95,steps:[{capability:'get_care_recommendations',person_name:null,parameters:{}}]};

 return null;
}

export async function planCommand({organizationId,message,history=[],idempotencyKey=null}){
 const input=clean(message);
 const deterministic=deterministicPlan(input);
 if(deterministic)return deterministic;

 try{
  const result=await generateText({
   organizationId,
   purpose:'aria_command_planning',
   maxTokens:700,
   temperature:0,
   json:true,
   system:SYSTEM,
   messages:Array.isArray(history)?history.slice(-10).map(x=>({role:x.role==='assistant'?'assistant':'user',content:clean(x.content,2500)})):[],
   user:input,
   idempotencyKey
  });

  const parsed=JSON.parse(result.text);
  const steps=Array.isArray(parsed.steps)?parsed.steps:[];

  for(const step of steps)getCapability(clean(step.capability,80));

  return{
   goal:clean(parsed.goal,1000)||input,
   confidence:Math.max(0,Math.min(1,Number(parsed.confidence)||0)),
   steps:steps.map(step=>({
    capability:clean(step.capability,80),
    person_name:clean(step.person_name,160)||null,
    operator_name:clean(step.operator_name,160)||null,
    parameters:step.parameters&&typeof step.parameters==='object'?step.parameters:{}
   }))
  };
 }catch{
  return{goal:input,confidence:0,steps:[]};
 }
}

async function resolvePerson(organizationId,name,userId){
 const result=await executeCapability({
  organizationId,
  capability:'find_person',
  personName:name,
  actorId:userId
 });

 if(result.results.length===1)return{personId:result.results[0].id};

 if(!result.results.length)return{
  clarification:{text:`I couldn't identify “${name}”. Please give me their full name or another detail that identifies them.`}
 };

 return{
  clarification:{
   text:`I found several people matching “${name}”. Which one do you mean?`,
   matches:result.results.map(p=>({
    id:p.id,
    name:p.display_name||`${p.first_name||''} ${p.last_name||''}`.trim(),
    phone:p.phone||null,
    email:p.email||null
   }))
  }
 };
}

export async function runCommand({organizationId,userId,message,history=[],conversationId=null,requestMessageId=null,defaultPersonId=null,defaultPersonName=null}){
 const input=clean(message);
 const plan=await planCommand({organizationId,message:input,history,idempotencyKey:requestMessageId?`aria-command:${requestMessageId}`:null});

 if(!plan.steps.length){
  if(plan.goal==='greeting')return{type:'response',text:'Hello. What would you like me to help you with in NYEOCARE?',plan};
  if(plan.goal==='help')return{type:'response',text:'I can help you find people, understand their history, surface care priorities, prepare messages, review pending actions and prepare NYEOCARE actions for your approval. I can also explain how to use any part of the system.',plan};
  if(plan.goal==='creator')return{type:'response',text:'NYEOCARE was created by Egwame Oshiogwe Nicholas. ARIA is the intelligence layer designed to help organizations remember people and act with care while keeping important decisions with humans.',plan};
  if(plan.goal==='about_nyeocare')return{type:'response',text:'NYEOCARE is a people memory and care operating system for organizations. It helps you remember people, capture attendance, reconcile identities, surface meaningful care opportunities and prepare actions without taking human approval away.',plan};
  if(plan.goal==='attendance_help')return{type:'response',text:'Open Attendance, start a session, mark people as you see them, then save the session. Your attendance is stored immediately; ARIA continues understanding the session in the background, so you can start the next session without waiting for her.',plan};
  if(plan.goal==='scan_help')return{type:'response',text:'Open Scan, take a clear photo or upload the register, then let ARIA read the rows, audit name-and-phone relationships and reconcile the identities she can safely match. Uncertain results go to Review Center rather than being guessed.',plan};
  if(plan.goal==='view_aria_director_briefing')return{type:'completed',plan,results:[await executeCapability({organizationId,capability:'get_director_briefing',parameters:{limit:8},actorId:userId})]};
  if(plan.goal==='missing_draft_cohort')return{type:'clarification',text:'I can draft exactly that number of messages, but I need the group. Say “for 3 past absentees”, “for 3 people who need follow-up”, or name the people.',plan,results:[]};
  return{type:'response',text:'I understand the request, but I need a little more detail before I can help safely.',plan};
 }

 if(plan.confidence<.55){
  return{type:'clarification',text:'I want to make sure I understand you correctly. Could you say that another way?',plan,results:[]};
 }

 const results=[];

 for(const [stepIndex,step] of plan.steps.entries()){
  let capability;
  try{capability=getCapability(step.capability)}catch{return{type:'clarification',text:'I do not have a safe way to answer that request yet.',plan,results};}
  let personId=null;

  if(capability.requiresPerson||step.person_name){
   if(defaultPersonId&&!step.person_name)personId=defaultPersonId;
   else{
    if(!step.person_name)return{type:'clarification',text:'Which person are you referring to?',plan,results};
    const resolved=await resolvePerson(organizationId,step.person_name,userId);
    if(resolved.clarification)return{type:'clarification',...resolved.clarification,plan,results};
    personId=resolved.personId;
   }
  }

  if(step.capability==='prepare_action'){
   const actionType=step.parameters?.actionType||'SEND_MESSAGE';
   if(!isValidActionType(actionType))return{type:'clarification',text:'What kind of action should I prepare?',plan,results};
  }

  if(capability.approval){
   const actionType=step.capability==='prepare_message'?'SEND_MESSAGE':String(step.parameters?.actionType||'SEND_MESSAGE');
   if(!isValidActionType(actionType))return{type:'clarification',text:'What kind of action should I prepare?',plan,results};
   const actionMetadata={
    ...(step.parameters?.metadata&&typeof step.parameters.metadata==='object'?step.parameters.metadata:{}),
    source:'aria_conversation',
    conversation_id:conversationId,
    request:input,
    reason:clean(step.parameters?.reason||step.parameters?.metadata?.reason||'ARIA identified a meaningful next step.',900),
    channel:actionType==='SEND_MESSAGE'?'whatsapp':null,
    draft_action_type:step.capability==='prepare_message'?clean(step.parameters?.actionType||'thoughtful_check_in',120):null,
    requires_confirmation:true,
    requires_human_approval:true,
    requires_human_send:actionType==='SEND_MESSAGE'
   };
   const action=await planActionFromObservation({
    organizationId,personId,actionType,priority:step.parameters?.priority||'medium',
    actionMetadata,
    actionKey:`aria-chat:${conversationId||'none'}:${requestMessageId||Date.now()}:${stepIndex}:${personId||'global'}:${actionType}`
   });
   if(!action)return{type:'clarification',text:'I could not safely prepare that proposal. Please try again.',plan,results};
   results.push({capability:step.capability,action,requiresApproval:true});
   const name=defaultPersonName||step.person_name||'this person';
   const text=actionType==='SEND_MESSAGE'
    ?`I can prepare a WhatsApp message for ${name}, using the context I have. I will not draft or send anything until you confirm. Prepare it?`
    :'I can prepare that action for your approval. Nothing will be changed until you confirm. Prepare it?';
   return{type:'action_confirmation',text,plan,results,action,requiresHumanApproval:true,requiresHumanSend:actionType==='SEND_MESSAGE'};
  }

  const result=await executeCapability({
   organizationId,
   capability:step.capability,
   personId,
   personName:step.person_name||defaultPersonName||null,
   parameters:{...(step.parameters||{}),...(step.operator_name?{operator_name:step.operator_name}:{})},
   actorId:userId
  });

  results.push(result);
 }

 return{type:'completed',plan,results,requiresHumanApproval:false,requiresHumanSend:false};
   }

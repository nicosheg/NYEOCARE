// lib/aria/commandEngine.js
import{generateText}from'../aiGateway';
import{getCapability,isValidActionType}from'./capabilityRegistry';
import{executeCapability}from'./capabilityEngine';

const clean=(v,max=5000)=>String(v??'').trim().slice(0,max);

const SYSTEM=`You are ARIA, the operating intelligence inside NYEOCARE.

Capabilities:
- find_person
- get_organization_context
- get_person_context
- explain_person
- get_care_recommendations
- get_pending_actions
- prepare_message
- prepare_action

Rules:
- Never invent capabilities.
- Never claim an action was executed when it was only prepared.
- Never send messages autonomously.
- Never guess a person when multiple people match.
- For organization-wide questions about people, birthdays, follow-ups, attention, or what NYEOCARE knows about the organization, use get_organization_context.
- Read operations may execute immediately.
- State-changing operations are preparation only.
- If the request is ambiguous, return no steps.
- Return only JSON.

Return:
{"goal":"string","confidence":0,"steps":[{"capability":"string","person_name":null,"parameters":{}}]}`;

function deterministicPlan(input){
 const text=input.toLowerCase();

 if(/^(hi|hello|hey|good morning|good afternoon|good evening)\b/.test(text))return{goal:'greeting',confidence:1,steps:[]};

 if(/what can you do|what are you able to do|help me|how can you help/.test(text))return{goal:'help',confidence:1,steps:[]};

 if(/who created|who built|who made|creator of nyeocare|founder of nyeocare/.test(text))return{goal:'creator',confidence:1,steps:[]};
 if(/what is nyeocare|what does nyeocare do|tell me about nyeocare|how does nyeocare work/.test(text))return{goal:'about_nyeocare',confidence:1,steps:[]};
 if(/how does attendance work|how do i take attendance|how to take attendance|start attendance/.test(text))return{goal:'attendance_help',confidence:1,steps:[]};
 if(/how does scanning work|how do i scan|how to scan|scan a register/.test(text))return{goal:'scan_help',confidence:1,steps:[]};

 if(/pending|awaiting approval|waiting for approval|actions? (to )?review/.test(text))return{goal:'view pending actions',confidence:.98,steps:[{capability:'get_pending_actions',person_name:null,parameters:{}}]};

 if(/recommend|who needs attention|who should i check|care opportunit|people need care/.test(text))return{goal:'view care recommendations',confidence:.95,steps:[{capability:'get_care_recommendations',person_name:null,parameters:{}}]};

 return null;
}

export async function planCommand({organizationId,message,history=[]}){
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
   user:input
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

export async function runCommand({organizationId,userId,message,history=[]}){
 const input=clean(message);
 const plan=await planCommand({organizationId,message:input,history});

 if(!plan.steps.length){
  if(plan.goal==='greeting')return{type:'response',text:'Hello. What would you like me to help you with in NYEOCARE?',plan};
  if(plan.goal==='help')return{type:'response',text:'I can help you find people, understand their history, surface care priorities, prepare messages, review pending actions and prepare NYEOCARE actions for your approval. I can also explain how to use any part of the system.',plan};
  if(plan.goal==='creator')return{type:'response',text:'NYEOCARE was created by Egwame Oshiogwe Nicholas. ARIA is the intelligence layer designed to help organizations remember people and act with care while keeping important decisions with humans.',plan};
  if(plan.goal==='about_nyeocare')return{type:'response',text:'NYEOCARE is a people memory and care operating system for organizations. It helps you remember people, capture attendance, reconcile identities, surface meaningful care opportunities and prepare actions without taking human approval away.',plan};
  if(plan.goal==='attendance_help')return{type:'response',text:'Open Attendance, start a session, mark people as you see them, then save the session. Your attendance is stored immediately; ARIA continues understanding the session in the background, so you can start the next session without waiting for her.',plan};
  if(plan.goal==='scan_help')return{type:'response',text:'Open Scan, take a clear photo or upload the register, then let ARIA read the rows, audit name-and-phone relationships and reconcile the identities she can safely match. Uncertain results go to Review Center rather than being guessed.',plan};
  return{type:'response',text:'I understand the request, but I need a little more detail before I can help safely.',plan};
 }

 if(plan.confidence<.55){
  return{type:'clarification',text:'I want to make sure I understand you correctly. Could you say that another way?',plan,results:[]};
 }

 const results=[];

 for(const step of plan.steps){
  const capability=getCapability(step.capability);
  let personId=null;

  if(capability.requiresPerson||step.person_name){
   if(!step.person_name)return{type:'clarification',text:'Which person are you referring to?',plan,results};

   const resolved=await resolvePerson(organizationId,step.person_name,userId);
   if(resolved.clarification)return{type:'clarification',...resolved.clarification,plan,results};
   personId=resolved.personId;
  }

  if(step.capability==='prepare_action'){
   const actionType=step.parameters?.actionType||'SEND_MESSAGE';
   if(!isValidActionType(actionType))return{type:'clarification',text:'What kind of action should I prepare?',plan,results};
  }

  const result=await executeCapability({
   organizationId,
   capability:step.capability,
   personId,
   personName:step.person_name,
   parameters:step.parameters,
   actorId:userId
  });

  results.push(result);

  if(result.requiresApproval){
   return{
    type:'action_prepared',
    text:step.capability==='prepare_message'
     ?'I prepared the message for your review. I will not send it without your approval.'
     :'I prepared the action. It is waiting for your approval.',
    plan,
    results,
    requiresHumanApproval:true,
    requiresHumanSend:Boolean(result.requiresHumanSend)
   };
  }
 }

 return{type:'completed',plan,results,requiresHumanApproval:false,requiresHumanSend:false};
   }

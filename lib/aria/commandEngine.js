// lib/aria/commandEngine.js
import pool from'../db';
import{generateText}from'../aiGateway';import{ARIA_CORE_PERSONALITY}from'./corePersonality';
import{getCapability,isValidActionType,listCapabilitiesForRole}from'./capabilityRegistry';
import{executeCapability}from'./capabilityEngine';
import{planActionFromObservation}from'./recommendationEngine';
import{inferCohortFromText}from'./cohortEngine';import{inferMessageDraftIntent}from'./messageIntent';import{inferPeopleRosterIntent}from'./peopleRosterParser';import{resolveInternalRecipient,sendInternalMessage,unsendInternalMessage,listInternalMessages}from'./internalMessaging';

const clean=(v,max=5000)=>String(v??'').trim().slice(0,max);

const SYSTEM=`${ARIA_CORE_PERSONALITY}\n\nYou are the operating intelligence inside NYEOCARE.

Capabilities:
- current_time
- get_latest_attendance
- get_recent_activity
- get_today_attention
- get_workspace_snapshot
- operate_workspace
  Supported operations: mark_attendance, create_session, close_session, discard_session, join_session, leave_session, create_task, complete_task, add_note, record_feedback, set_lifecycle, archive_person, restore_person, create_group, update_group, delete_group, add_membership, remove_membership, add_person_role, remove_person_role, add_relationship, remove_relationship.
- find_person
- create_person
- get_organization_context
- get_person_context
- explain_person
- get_care_recommendations
- get_pending_actions
- get_operator_context
- get_organization_changes
- get_aria_continuity
- get_director_briefing
- get_attention_summary
- get_people_review_summary
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
- send_internal_message
- unsend_internal_message
- get_internal_messages
- prepare_action
- import_people_roster
- update_person_record

Rules:
- First understand the user's actual goal, not just isolated keywords.
- Distinguish a question about what ARIA can do from a request to actually do it.
- Match natural language, misspellings, compressed speech, pasted text, and multi-part requests to the closest verified capability.
- When the user has already supplied enough information to act, do not ask them to restate it merely because the wording is informal.
- Prefer one high-confidence capability over several speculative capabilities.
- For a pasted list of names/phones, use import_people_roster; never route it to observation explanation.
- Never use get_observation_context unless the user is explicitly referring to an observation or observation evidence.
- If a known capability fails, do not pretend the request was completed. Return a safe blocked result so ARIA can explain what was attempted, what prevented it, and what access or integration is needed next.
- If no capability supports the requested action, say so clearly and explain the nearest available path rather than producing a generic clarification.
- When the request contains multiple independent tasks, execute the high-confidence safe task(s) in order and preserve the remainder for the response.
- Never invent capabilities.
- Be proactive when evidence supports a helpful next step; positive opportunities such as welcome, recognition, belonging and contribution are first-class care signals.
- Never turn retention into pressure, guilt, fear, or dependency.
- Never infer a person’s calling, personality, health, motives, or private circumstances from weak signals.
- Consequential external actions remain preparation-only and require explicit human confirmation.
- Explicit memory/correction requests may write provenance-aware memory when the current actor is authorized; never create durable memory merely from an inference or a retrieved record.
- Drafting text is an internal preparation step and may happen immediately when the user explicitly requests a draft. External sending or consequential state changes remain approval-gated.
- Never claim an external action was executed when it was only prepared.
- Never send messages autonomously except when the current authenticated operator explicitly instructs ARIA to send an internal NYEOCARE message with a specific active organization operator and exact message text. Never infer or invent either.
- Internal messages are organization-only and must never be sent to people records, external channels, or inferred recipients.
- Never guess a person when multiple people match.
- For organization-wide questions about people, birthdays, follow-ups, attention, invitations, operators, access, or what NYEOCARE knows about the organization, use get_organization_context.
- For prior ARIA conversation continuity, “what was the last thing we spoke about”, “where did we leave off”, or explicit requests for past/present/future organizational memory, use get_aria_continuity.
- For what changed, what happened recently, or time-window questions, prefer get_organization_changes.
- For briefings, “what matters”, “walk me through today”, “how is the organization doing”, or broad organizational state questions, always use get_director_briefing. It is the canonical interpretation layer; do not assemble a briefing from independent capabilities.
- For who needs attention, what matters now, what should I review, or any broad question about organizational priority, prefer get_director_briefing. Use get_attention_summary only for a narrow raw attention query where the user explicitly wants the signal list.
- For one person's history, use get_person_timeline.
- For what do you know, remember, why are you saying that, or evidence/uncertainty questions about one person, use get_person_evidence.
- For questions about one specific ARIA observation, use get_observation_context.
- For cohort/group questions, use resolve_people_cohort before drafting or recommending anything for multiple people.
- For drafting a message, use draft_message for one named person and draft_message_cohort for a bounded group. A draft is not a send and does not require a confirmation step. If the user says "on WhatsApp", preserve channel=whatsapp so the UI opens WhatsApp with each message pre-filled.
- Explicit quantity language is binding: "for 5 people" means at most 5 people; "for only [person]" means one person; a named person wins over a generic cohort. Never silently expand a requested quantity.
- For one named operator's activity, invitation/joining history, role or access, use get_operator_context and pass operator_name.
- Treat profile, organization settings and access requests as real organization operations, not generic conversation. “Change my name”, “rename the organization”, “tell ARIA to remember this organization rule”, and “invite a user/admin” should map to the corresponding canonical capabilities when the operator is authorized.
- When a user asks to change something on the current Profile page, infer the field from ordinary language and preserve all unrelated profile fields. Do not ask them to restate the field if the target is clear.
- When the user asks to invite someone, distinguish an invitation link from adding a People record. Invitations create organization access; People creation changes the directory.

- Server-side role filtering is mandatory: owners may see detailed operator records; admins may see detailed user records but only basic owner/admin records; users may see detailed user records but only basic owner/admin records; every operator may see their own detailed record.
- Never treat an organization operator as a People record unless the user explicitly asks about that person's People profile.
- Keep the organization boundary strict: use only current-organization data for organizational questions; never expose internal IDs, invitation tokens, passwords or authentication secrets.
- Read operations may execute immediately.
- Routine organization operations may execute immediately when the server-side capability permits them. High-impact, destructive, access-changing, external, or irreversible operations are always confirmation-gated by the server.
- State-changing external operations are preparation only. Explicit memory writes are permitted only when the actor directly asks ARIA to remember/correct something and the capability enforces the required role boundary.
- If the request is ambiguous, return no steps.
- Return only JSON.

Return:
{"goal":"string","confidence":0,"steps":[{"capability":"string","person_name":null,"operator_name":null,"parameters":{}}]}`;

function parseInternalMessageIntent(input){
 const text=String(input||'').trim();
 const sendPatterns=[
  /^(?:please\s+)?send\s+(?:a\s+)?message\s+to\s+(.+?)\s+(?:saying|that)\s+([\s\S]+)$/i,
  /^(?:please\s+)?send\s+message\s+to\s+(.+?)\s*:\s*([\s\S]+)$/i,
  /^(?:please\s+)?message\s+(.+?)\s*:\s*([\s\S]+)$/i,
  /^(?:please\s+)?tell\s+(.+?)\s*:\s*([\s\S]+)$/i
 ];
 for(const re of sendPatterns){
  const m=text.match(re);
  if(m)return{kind:'send',recipientName:String(m[1]).trim(),body:String(m[2]).trim()};
 }
 const unsendPatterns=[
  /^(?:please\s+)?(?:unsend|delete|remove)\s+(?:the\s+)?message(?:\s+i\s+(?:just\s+)?sent)?(?:\s+(?:to|sent\s+to)\s+(.+))?$/i,
  /^(?:please\s+)?unsend\s+my\s+last\s+message(?:\s+(?:to|sent\s+to)\s+(.+))?$/i
 ];
 for(const re of unsendPatterns){
  const m=text.match(re);
  if(m)return{kind:'unsend',recipientName:m[1]?String(m[1]).trim():null};
 }
 if(/^(?:show|list|view)\s+(?:my\s+)?(?:internal\s+)?messages?$|^(?:what|any)\s+(?:messages|message)\s+(?:do\s+i\s+have|for\s+me)\b/i.test(text)){
  return{kind:'list'};
 }
 return null;
}

function parseNaturalDate(value){
 const raw=String(value||'').trim().replace(/^(?:the\s+)?/i,'').replace(/(\d+)(?:st|nd|rd|th)\b/gi,'$1').replace(/,/g,' ').replace(/\s+/g,' ');
 const months={january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12,jan:1,feb:2,mar:3,apr:4,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12};
 let m=raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
 if(m){
  const day=Number(m[1]),month=Number(m[2]),year=Number(m[3]);const d=new Date(Date.UTC(year,month-1,day));
  if(d.getUTCFullYear()===year&&d.getUTCMonth()===month-1&&d.getUTCDate()===day)return year+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
  return null;
 }
 m=raw.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/)||raw.match(/^([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})$/);
 if(!m)return null;
 const day=Number(m[1].match(/^\d/) ? m[1] : m[2]);
 const monthName=String(m[1].match(/^[A-Za-z]/)?m[1]:m[2]).toLowerCase();
 const year=Number(m[3]);const month=months[monthName];
 if(!month)return null;
 const d=new Date(Date.UTC(year,month-1,day));
 if(d.getUTCFullYear()!==year||d.getUTCMonth()!==month-1||d.getUTCDate()!==day)return null;
 return year+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
}

function deterministicPlan(input,timeZone=null){
 const text=input.toLowerCase();
 const internal=parseInternalMessageIntent(input);
 if(internal?.kind==='send')return{goal:'send an internal message',confidence:1,steps:[{capability:'send_internal_message',person_name:null,operator_name:null,parameters:{recipient_name:internal.recipientName,body:internal.body,explicit:true}}]};
 if(internal?.kind==='unsend')return{goal:'unsend an internal message',confidence:1,steps:[{capability:'unsend_internal_message',person_name:null,operator_name:null,parameters:{recipient_name:internal.recipientName,explicit:true}}]};
 if(internal?.kind==='list')return{goal:'view internal messages',confidence:1,steps:[{capability:'get_internal_messages',person_name:null,operator_name:null,parameters:{limit:20}}]};

 if(/^(hi|hello|hey|good morning|good afternoon|good evening)\b/.test(text))return{goal:'greeting',confidence:1,steps:[]};

 if(/\b(?:what(?:'s| is)\s+)?(?:the\s+)?(?:current\s+)?(?:date\s+and\s+time|time\s+and\s+date|time\s+now|current\s+time)\b|\bwhat\s+time\s+is\s+it\b/i.test(input))return{goal:'current date and time',confidence:1,steps:[{capability:'current_time',person_name:null,operator_name:null,parameters:{timeZone:timeZone||null}}]};
 if(/\b(?:last|most recent)\s+attendance\b|\bwhen\s+(?:was|did)\s+(?:the\s+)?(?:last|most recent)\s+attendance\b/i.test(input))return{goal:'latest attendance',confidence:1,steps:[{capability:'get_latest_attendance',person_name:null,operator_name:null,parameters:{timeZone:timeZone||null}}]};
 if(/\b(?:last activity|what did we do last|what was the last thing we did|what happened last|recent activity|recent actions|what have we done recently)\b/i.test(input))return{goal:'recent NYEOCARE activity',confidence:1,steps:[{capability:'get_recent_activity',person_name:null,operator_name:null,parameters:{limit:25,days:30}}]};
 if(/\b(?:what was the last thing we spoke about|what did we talk about last|what did we discuss last|what was our last conversation|do you remember our last conversation|where did we leave off|continue where we left off|what were we talking about last)\b/i.test(input))return{goal:'retrieve prior ARIA conversation continuity',confidence:1,steps:[{capability:'get_aria_continuity',person_name:null,operator_name:null,parameters:{scope:'conversation',limit:12}}]};
 if(/\b(?:what do you remember from our conversations|what have we discussed|what have we established|show me the full organizational memory|show me our organizational memory|what do you remember about the organization|what do you know about the organization over time|past present and future|past,? present(?:,? and)? future)\b/i.test(input))return{goal:'retrieve full organizational continuity',confidence:.99,steps:[{capability:'get_aria_continuity',person_name:null,operator_name:null,parameters:{scope:'full',limit:24}}]};
 if(/\b(?:list|show|tell me)\b[\s\S]*\b(?:people|persons)\b[\s\S]*\b(?:need|needs|requiring)\b[\s\S]*\battention\b|\bwho\b[\s\S]*\bneeds\b[\s\S]*\battention\b|\bpeople\b[\s\S]*\battention\b[\s\S]*\btoday\b/i.test(input))return{goal:'people needing attention today',confidence:1,steps:[{capability:'get_today_attention',person_name:null,operator_name:null,parameters:{limit:20}}]};
 if(/\b(?:check|inspect|review|scan|look through|show me)\b[\s\S]*\b(?:everything|whole system|whole organization|entire organization|all of nyeocare|all organization data)\b|\bwhat can you see in (?:nyeocare|the organization)\b|\bwhat do you know about (?:everything|the whole organization|our organization)\b/i.test(input))return{goal:'synchronized workspace snapshot',confidence:.99,steps:[{capability:'get_workspace_snapshot',person_name:null,operator_name:null,parameters:{activity_limit:25}}]};
 const messageIntent=inferMessageDraftIntent(input);
 if(messageIntent.match&&messageIntent.cohort){
  return{goal:'draft_message_cohort',confidence:.99,steps:[{capability:'draft_message_cohort',person_name:null,operator_name:null,parameters:{cohort:messageIntent.cohort,limit:messageIntent.count||null,all:Boolean(messageIntent.all),channel:messageIntent.channel,messagePurpose:messageIntent.purpose,messageContext:messageIntent.messageContext,explicit:true}}]};
 }

 const createAttendance=input.match(/^(?:please\s+)?(?:create|start|open|begin)\s+(?:a\s+)?(?:live\s+)?attendance(?:\s+session)?\s+(?:called|named|name(?:\s+it)?)\s+["']?([^"']+?)["']?\s*$/i);
 if(createAttendance)return{goal:'create attendance session',confidence:1,steps:[{capability:'operate_workspace',person_name:null,operator_name:null,parameters:{operation:'create_session',name:clean(createAttendance[1],160),explicit:true}}]};
 if(/^(?:please\s+)?(?:create|start|open|begin)\s+(?:a\s+)?(?:live\s+)?attendance\s*$/i.test(input))return{goal:'create attendance session',confidence:1,steps:[{capability:'operate_workspace',person_name:null,operator_name:null,parameters:{operation:'create_session',name:'Today',explicit:true}}]};

 const createPersonPrefix=input.match(/^(?:please\s+)?(?:create|add)\s+(?:a\s+)?person\s+(?:called|named)\s+(.+)$/i);
 if(createPersonPrefix){
  let remainder=createPersonPrefix[1].trim();
  let birthday=null;
  const dobMatch=remainder.match(/\s+(?:and\s+)?(?:has|with)\s+(?:a\s+)?date\s+of\s+birth\s+(.+)$/i);
  if(dobMatch){
   birthday=parseNaturalDate(dobMatch[1]);
   if(!birthday)return{goal:'create_person_invalid_birthday',confidence:1,steps:[]};
   remainder=remainder.slice(0,dobMatch.index).trim();
  }
  let phone=null;
  remainder=remainder.replace(/\s+(?:without|with\s+no)\s+phone(?:\s+number)?\s*$/i,'').trim();
  const phoneMatch=remainder.match(/\s+(?:with|phone(?:\s+number)?(?:\s+is|:)?)\s+([+\d][+\d\s().-]{7,20})$/i);
  if(phoneMatch){phone=phoneMatch[1].trim();remainder=remainder.slice(0,phoneMatch.index).trim();}
  const name=clean(remainder.replace(/^(?:["'])(.*)(?:["'])$/,'$1').trim(),200);
  if(name)return{goal:'create_person',confidence:1,steps:[{capability:'create_person',person_name:null,operator_name:null,parameters:{name,phone,birthday,explicit:true}}]};
 }
 const profileName=input.match(/^(?:please\s+)?(?:change|update|edit)\s+my\s+name\s+(?:to|as)\s+(.+)$/i);
 if(profileName)return{goal:'update_organization_profile',confidence:1,steps:[{capability:'update_organization_profile',person_name:null,operator_name:null,parameters:{user_name:clean(profileName[1],120),explicit:true}}]};
 const organizationRename=input.match(/^(?:please\s+)?(?:change|rename|update|edit)\s+(?:the\s+)?(?:organization|org|church|space)(?:\s+name)?\s+(?:to|as)\s+(.+)$/i);
 if(organizationRename)return{goal:'update_organization_profile',confidence:1,steps:[{capability:'update_organization_profile',person_name:null,operator_name:null,parameters:{organization_name:clean(organizationRename[1],120),explicit:true}}]};
 const ariaKnowledge=input.match(/^(?:please\s+)?(?:tell|teach|set|update|change)\s+ARIA\s+(?:to\s+remember|to\s+know|knowledge|instructions?|about)\s*[:,-]?\s*([\s\S]+)$/i);
 if(ariaKnowledge)return{goal:'update_organization_profile',confidence:.98,steps:[{capability:'update_organization_profile',person_name:null,operator_name:null,parameters:{aria_instructions:clean(ariaKnowledge[1],2000),explicit:true}}]};
 const inviteRole=input.match(/\b(?:invite|add)\b[\s\S]*\b(?:as\s+an?\s+)?(admin|user)\b/i);
 if(inviteRole&&/\b(?:invite|invitation|access)\b/i.test(input))return{goal:'create_organization_invite',confidence:.97,steps:[{capability:'create_organization_invite',person_name:null,operator_name:null,parameters:{role:String(inviteRole[1]).toLowerCase(),explicit:true}}]};
 if(/^(?:what can you do|what are you able to do|how can you help|what are you capable of|what can you currently do|what can you handle)\b/.test(text)||/^(?:help me)\s+(?:understand|learn|use|navigate)\b/.test(text))return{goal:'capability_overview',confidence:1,steps:[]};
 if(/\bcall\b[\s\S]*\b(?:every|everyone|all|each)\b|\bcall\b[\s\S]*\bpeople\b/i.test(input))return{goal:'external_call_people_not_supported',confidence:1,steps:[]};
 const retractedPhoneQuestion=input.match(/(?:actually|wait|no)[\s\S]*\b(?:don['’]t|do not|not)\s+(?:change|update|correct|edit)\b[\s\S]*\bwhat\s+(?:number|phone)\b[\s\S]*\bfor\s+([a-z][a-z .'-]{0,80})\??$/i);
 if(retractedPhoneQuestion)return{goal:'verify_current_person_phone',confidence:1,steps:[{capability:'find_person',person_name:clean(retractedPhoneQuestion[1],160),operator_name:null,parameters:{name:clean(retractedPhoneQuestion[1],160)}}]};
 if(/who created|who built|who made|creator of nyeocare|founder of nyeocare/.test(text))return{goal:'creator',confidence:1,steps:[]};
 if(/what is nyeocare|what does nyeocare do|tell me about nyeocare|how does nyeocare work/.test(text))return{goal:'about_nyeocare',confidence:1,steps:[]};
 if(/how does attendance work|how do i take attendance|how to take attendance|start attendance/.test(text))return{goal:'attendance_help',confidence:1,steps:[]};
 if(/how does scanning work|how do i scan|how to scan|scan a register/.test(text))return{goal:'scan_help',confidence:1,steps:[]};

 const cleanupRequested=/\b(?:remove|delete|archive|clean(?:\s+up)?)\b[\s\S]*\b(?:garbage|junk|suspicious|malformed|nonsense|bad|wrong|weird)\b[\s\S]*\b(?:names?|entries?|records?|people)\b/i.test(input);
 const peopleDataQualityReview=/\b(?:garbage|junk|suspicious|malformed|nonsense)\s+(?:names?|entries?|records?|people)\b/i.test(input)||cleanupRequested||(/\b(?:review|check|inspect|audit|look(?:\s+through|\s+at)?)\b[\s\S]*\b(?:list|people|names?|directory|records?|entries)\b/i.test(input)&&/\b(?:garbage|junk|suspicious|malformed|bad|wrong|weird)\b/i.test(input));
 if(peopleDataQualityReview)return{goal:'review_people_data_quality',confidence:.99,steps:[{capability:'get_people_review_summary',person_name:null,operator_name:null,parameters:{cleanup_requested:cleanupRequested}}]};
 if(/(?:check|review|inspect|look at|tell me).*\b(?:people|peoples)(?:['’]s)?\s+page\b|\b(?:people|peoples)(?:['’]s)?\s+page\b.*(?:review|check|needs? review|issues)|\bwhat needs review\b.*\bpeople\b|\bpeople\b.*\b(?:needs? review|need reviewing|data issues|duplicates?)\b/.test(text))return{goal:'review_people_page',confidence:.99,steps:[{capability:'get_people_review_summary',person_name:null,operator_name:null,parameters:{}}]};

 const rosterIntent=inferPeopleRosterIntent(input);
 if(rosterIntent.match){
  const steps=[{capability:'import_people_roster',person_name:null,operator_name:null,parameters:{text:input,explicit:true,source:'semantic_roster_intent'}}];
  const draftRequested=/\b(?:prepare|draft)\b[\s\S]*\b(?:message|something(?:\s+kind)?|send)\b/i.test(input);
  if(draftRequested){
   const scope=inferCohortFromText(input);
   if(scope.key||scope.all)steps.push({capability:'draft_message_cohort',person_name:null,operator_name:null,parameters:{cohort:scope.key||'past_absentees',limit:scope.count||null,all:Boolean(scope.all),channel:/\bwhatsapp\b/i.test(input)?'whatsapp':'app'}});
  }
  return{goal:draftRequested?'import_people_and_prepare_messages':'import_people_roster',confidence:.995,steps};
 }
 if(/^(?:please\s+)?(?:add|import|save|put|create)\b.*\b(?:people|persons|members|contacts)\b/i.test(input))return{goal:'people_import_request',confidence:1,steps:[]};
 const phoneUpdate=input.match(/^(?:change|update|correct|edit)\s+(.+?)['’]s?\s+(?:phone|number)\s+(?:to|as)\s+([+\d][+\d\s().-]{7,18})$/i);
 if(phoneUpdate){
  return{goal:'update_person_record',confidence:.99,steps:[{capability:'update_person_record',person_name:clean(phoneUpdate[1],160),operator_name:null,parameters:{fields:{phone:String(phoneUpdate[2]).trim()},explicit:true}}]};
 }
 const nameUpdate=input.match(/^(?:change|update|correct|edit)\s+(.+?)['’]s?\s+name\s+(?:to|as)\s+(.+)$/i);
 if(nameUpdate){
  return{goal:'update_person_record',confidence:.99,steps:[{capability:'update_person_record',person_name:clean(nameUpdate[1],160),operator_name:null,parameters:{fields:{full_name:clean(nameUpdate[2],160)},explicit:true}}]};
 }
 const dobUpdate=input.match(/^(?:add|change|update|set)\s+(.+?)['’]s?\s+(?:date of birth|birthday|dob)\s+(?:to|as)\s+(\d{4}-\d{2}-\d{2})$/i);
 if(dobUpdate){
  return{goal:'update_person_record',confidence:.99,steps:[{capability:'update_person_record',person_name:clean(dobUpdate[1],160),operator_name:null,parameters:{fields:{birthday:dobUpdate[2]},explicit:true}}]};
 }
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

 if(/walk me through.*briefing|today.?s briefing|briefing|what matters most|what matters today|what matters now|who needs attention|who should i check|needs my attention|how is the organization doing|how are things|state of the organization|what should i know|what do i need to know|brief me|catch me up/.test(text))return{goal:'brief current organization state',confidence:1,steps:[{capability:'get_director_briefing',person_name:null,parameters:{limit:8}}]};

 if(/what changed|what happened recently|recent changes|changed this week|changed today/.test(text))return{goal:'view recent organization changes',confidence:.98,steps:[{capability:'get_organization_changes',person_name:null,parameters:{days:30,limit:25}}]};

 if(/walk me through.*briefing|today'?s briefing|what matters most|who needs attention|what matters now|what matters today|who should i check|needs my attention/.test(text))return{goal:'view_aria_director_briefing',confidence:.99,steps:[{capability:'get_director_briefing',person_name:null,parameters:{limit:8}}]};

 if(/how is the organization doing|how are we doing|state of the organization|organization health|how are things going|what have you noticed|what did you notice|what do you know about (?:the )?organization|what do you remember about (?:the )?organization|anything i missed|what am i missing|surprise me|show me something interesting/.test(text))return{goal:'view_aria_director_briefing',confidence:.99,steps:[{capability:'get_director_briefing',person_name:null,parameters:{limit:8}}]};

 if(/what do i need to know|what should i know|brief me|give me a briefing|catch me up/.test(text))return{goal:'brief current organization state',confidence:.97,steps:[{capability:'get_director_briefing',person_name:null,operator_name:null,parameters:{limit:8}}]};

 if(/recommend|care opportunit|people need care/.test(text))return{goal:'view care recommendations',confidence:.95,steps:[{capability:'get_care_recommendations',person_name:null,parameters:{}}]};

 return null;
}

export async function planCommand({organizationId,message,history=[],idempotencyKey=null,userRole='user',timeZone=null}){
 const input=clean(message);
 const deterministic=deterministicPlan(input,timeZone);
 if(deterministic)return deterministic;

 try{
  const result=await generateText({
   organizationId,
   purpose:'aria_command_planning',
   maxTokens:700,
   temperature:0,
   json:true,
   system:`${SYSTEM}\n\nCURRENT OPERATOR ROLE: ${userRole}\n\nVERIFIED CAPABILITY CATALOG:\n${JSON.stringify(listCapabilitiesForRole(userRole))}\n\nPlanning contract: return JSON only with goal, confidence, and steps. Use only capability names from the catalog. Do not choose get_observation_context unless the user is explicitly referring to an observation. Treat a request to understand what ARIA can do as capability_overview. If the action is not supported, return an empty steps array and a clear goal explaining the capability gap.`,
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
    parameters:{...(step.parameters&&typeof step.parameters==='object'?step.parameters:{}),...(step.capability==='create_person'?{explicit:true}: {})}
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

const CONFIRMATION_REQUIRED_CAPABILITIES=new Set(['remember_organization_fact','remember_relationship','set_event_semantics']);

export async function runCommand({organizationId,userId,message,history=[],conversationId=null,requestMessageId=null,defaultPersonId=null,defaultPersonName=null,timeZone=null}){
 const roleRow=(await pool.query(`SELECT role FROM users WHERE id=$1 AND organization_id=$2 AND active=true LIMIT 1`,[userId,organizationId])).rows[0];
 const userRole=roleRow?.role||'user';
 const input=clean(message);
 const plan=await planCommand({organizationId,message:input,history,idempotencyKey:requestMessageId?`aria-command:${requestMessageId}`:null,userRole,timeZone});

 if(!plan.steps.length){
  if(plan.goal==='greeting')return{type:'response',text:'Hello. What would you like me to help you with in NYEOCARE?',plan};
  if(plan.goal==='review_people_page')return{type:'completed',plan,results:[await executeCapability({organizationId,capability:'get_people_review_summary',parameters:{},actorId:userId})]};
  if(plan.goal==='people_import_request')return{type:'response',text:'Yes. I can add people to the People page from names and phone numbers you provide. Paste the list exactly as you have it—even messy or packed together—and I will extract the person rows, save safe matches, and flag anything uncertain instead of guessing.',plan};
 if(plan.goal==='capability_overview')return{type:'capability_overview',text:'Here is what I can currently do from this organization account.',plan,results:[{capability:'capability_catalog',capabilities:listCapabilitiesForRole(userRole)}]};
  if(plan.goal==='creator')return{type:'response',text:'NYEOCARE was created by Egwame Oshiogwe Nicholas. ARIA is the intelligence layer designed to help organizations remember people and act with care while keeping important decisions with humans.',plan};
  if(plan.goal==='about_nyeocare')return{type:'response',text:'NYEOCARE is a people memory and care operating system for organizations. It helps you remember people, capture attendance, reconcile identities, surface meaningful care opportunities and prepare actions without taking human approval away.',plan};
  if(plan.goal==='attendance_help')return{type:'response',text:'Open Attendance, start a session, mark people as you see them, then save the session. Your attendance is stored immediately; ARIA continues understanding the session in the background, so you can start the next session without waiting for her.',plan};
  if(plan.goal==='scan_help')return{type:'response',text:'Open Scan, take a clear photo or upload the register, then let ARIA read the rows, audit name-and-phone relationships and reconcile the identities she can safely match. Uncertain results go to Review Center rather than being guessed.',plan};
  if(plan.goal==='view_aria_director_briefing')return{type:'completed',plan,results:[await executeCapability({organizationId,capability:'get_director_briefing',parameters:{limit:8},actorId:userId})]};
  if(plan.goal==='missing_draft_cohort')return{type:'clarification',text:'I can draft exactly that number of messages, but I need the group. Say “for 3 past absentees”, “for 3 people who need follow-up”, or name the people.',plan,results:[]};
  if(/(?:unsupported|not supported|not available|no verified capability|capability gap|cannot|can't|unable|requires an integration)/i.test(String(plan.goal||'')))return{type:'capability_boundary',text:'I understand what you want, but that capability is not available or verified in NYEOCARE yet. I will not pretend it is done.',plan,results:[{capability:'capability_catalog',capabilities:listCapabilitiesForRole(userRole),requested_goal:plan.goal}]};
  return{type:'conversation',text:null,plan,results:[],conversation:true};
 }

 if(plan.confidence<.55){
  return{type:'capability_boundary',text:'I could not confidently map that request to a supported NYEOCARE capability, so I did not take action.',plan,results:[{capability:'capability_catalog',capabilities:listCapabilitiesForRole(userRole),requested_goal:plan.goal}]};
 }

 const results=[];

 for(const [stepIndex,step] of plan.steps.entries()){
  let capability;
  try{capability=getCapability(step.capability)}catch{return{type:'clarification',text:'I do not have a safe way to answer that request yet.',plan,results};}
  let personId=null;

  if(step.capability==='send_internal_message'){
   if(step.parameters?.explicit!==true||!step.parameters?.recipient_name||!step.parameters?.body){
    return{type:'clarification',text:'Tell me exactly who I should message and the exact words you want sent.',plan,results};
   }
   const resolved=await resolveInternalRecipient({organizationId,name:step.parameters.recipient_name});
   if(resolved.kind==='not_found')return{type:'clarification',text:`I could not find an active organization operator named “${resolved.query}”.`,plan,results};
   if(resolved.kind==='ambiguous')return{type:'clarification',text:`I found several active operators matching “${resolved.query}”. Tell me which one you mean.`,matches:resolved.matches,plan,results};
   const sent=await sendInternalMessage({organizationId,senderUserId:userId,recipientUserId:resolved.operator.id,body:step.parameters.body,idempotencyKey:requestMessageId?`aria-internal-send:${requestMessageId}`:null});
   results.push({capability,internal_message:sent.message,created:sent.created});
   continue;
  }

  if(step.capability==='unsend_internal_message'){
   if(step.parameters?.explicit!==true)return{type:'clarification',text:'Tell me which message you want me to unsend.',plan,results};
   let recipientId=null;
   const recipientName=String(step.parameters?.recipient_name||'').trim();
   if(recipientName){
    const resolved=await resolveInternalRecipient({organizationId,name:recipientName});
    if(resolved.kind==='not_found')return{type:'clarification',text:`I could not find an active organization operator named “${resolved.query}”.`,plan,results};
    if(resolved.kind==='ambiguous')return{type:'clarification',text:`I found several active operators matching “${resolved.query}”. Tell me which one you mean.`,matches:resolved.matches,plan,results};
    recipientId=resolved.operator.id;
   }
   const result=await unsendInternalMessage({organizationId,senderUserId:userId,recipientUserId:recipientId,messageId:step.parameters?.message_id||null,idempotencyKey:step.parameters?.idempotency_key||null});
   if(!result.ok)return{type:'response',text:result.code==='MESSAGE_NOT_FOUND'?'I could not find one of your sent messages to unsend.':'That message is no longer available to unsend.',plan,results};
   results.push({capability,internal_message:result.message,recipientSaw:result.recipientSaw,alreadyUnsent:result.alreadyUnsent});
   continue;
  }

  if(step.capability==='get_internal_messages'){
   const result=await listInternalMessages({organizationId,userId,limit:step.parameters?.limit||20,includeSent:Boolean(step.parameters?.includeSent)});
   results.push({capability,messages:result.messages,unread_count:result.unread_count});
   continue;
  }

  if(capability.requiresPerson||step.person_name){
   if(defaultPersonId&&!step.person_name)personId=defaultPersonId;
   else{
    if(!step.person_name)return{type:'clarification',text:'Which person are you referring to?',plan,results};
    const resolved=await resolvePerson(organizationId,step.person_name,userId);
    if(resolved.clarification)return{type:'clarification',...resolved.clarification,plan,results};
    personId=resolved.personId;
   }
  }

  if(step.capability==='update_person_record'){
   const fields=step.parameters?.fields&&typeof step.parameters.fields==='object'?step.parameters.fields:{};
   if(!Object.keys(fields).length)return{type:'clarification',text:'Tell me which person field to change: name, phone number, or date of birth.',plan,results:[]};
   const requested=Object.entries(fields).map(([key])=>key==='full_name'?'name':key==='phone'?'phone number':key==='birthday'?'date of birth':key).join(', ');
   const valueText=Object.entries(fields).map(([key,value])=>key+'='+String(value)).join('; ');
   const name=defaultPersonName||step.person_name||'this person';
   return{type:'person_update_confirmation',text:'I found '+name+'. I can update '+requested+' ('+valueText+'). Nothing has changed yet. Confirm?',plan,results:[],pending_person_update:{person_id:personId,person_name:name,fields,requested}};
  }

  if(step.capability==='prepare_action'){
   const actionType=step.parameters?.actionType||'SEND_MESSAGE';
   if(!isValidActionType(actionType))return{type:'clarification',text:'What kind of action should I prepare?',plan,results};
  }

  if(step.capability==='import_people_roster'){
   const result=await executeCapability({organizationId,capability:'import_people_roster',parameters:{...(step.parameters||{}),explicit:true},actorId:userId});
   results.push(result);
   continue;
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

  let result;
  try{
   if(step.capability==='operate_workspace'){
    result=await executeCapability({
     organizationId,
     capability:step.capability,
     personId,
     personName:step.person_name||defaultPersonName||null,
     parameters:{...(step.parameters||{}),confirmed:false},
     actorId:userId
    });
    if(result?.requires_confirmation){
     const operation=clean(step.parameters?.operation||result.operation||'that action',100);
     return{
      type:'workspace_action_confirmation',
      text:'I can '+operation.replace(/_/g,' ')+' here. This changes organizational data, so I need your confirmation before I do it. Continue?',
      plan,results:[],requiresHumanApproval:true,
      pending_workspace_action:{
       capability:'operate_workspace',
       operation,
       person_id:personId||null,
       parameters:{...(step.parameters||{})}
      }
     };
    }
   }else if(CONFIRMATION_REQUIRED_CAPABILITIES.has(step.capability)){
    return{
     type:'capability_action_confirmation',
     text:'I can do that, but it changes organizational memory or operating rules. Confirm and I will apply it exactly as requested.',
     plan,results:[],requiresHumanApproval:true,
     pending_capability_action:{
      capability:step.capability,
      person_id:personId||null,
      parameters:{...(step.parameters||{})}
     }
    };
   }else{
    result=await executeCapability({
     organizationId,
     capability:step.capability,
     personId,
     personName:step.person_name||defaultPersonName||null,
     parameters:{...(step.parameters||{}),...(step.operator_name?{operator_name:step.operator_name}:{}),...(step.capability==='current_time'?{timeZone:timeZone||step.parameters?.timeZone||null}:{}),...(step.capability==='get_aria_continuity'?{current_conversation_id:conversationId||null}: {})},
     actorId:userId
    });
   }
   if(step.capability==='get_people_review_summary'&&step.parameters?.cleanup_requested===true&&result?.name_anomalies?.length){
    const candidate=result.name_anomalies[0];
    const count=result.name_anomalies.length;
    const name=candidate.name||'that malformed People record';
    return{
     type:'workspace_action_confirmation',
     text:'I checked the live People directory and found '+count+' high-confidence malformed record'+(count===1?'':'s')+'. The clearest one is “'+name+'”. I can archive that record using the existing reversible People cleanup flow. Nothing will be removed until you confirm. Continue?',
     plan,results,requiresHumanApproval:true,
     pending_workspace_action:{
      capability:'operate_workspace',
      operation:'archive_person',
      person_id:candidate.person_id,
      parameters:{operation:'archive_person'}
     }
    };
   }
  }catch(error){
   console.error('[ARIA] capability execution failed:',step.capability,error?.message||error);
   const status=Number(error?.status)||500;
   const boundary=status===403
    ?'I can do that, but this account does not have the required permission.'
    :status===404
     ?'I could not find the specific record needed to complete that request.'
     :status===409
      ?'I found a conflict, so I stopped before changing anything.'
      :'I tried to complete that request, but the required capability did not finish successfully. Nothing was claimed as completed.';
   return{type:'capability_blocked',text:boundary,plan,results,blocked_capability:step.capability,blocked_status:status,capability_catalog:listCapabilitiesForRole(userRole)};
  }
 }

 if(plan.goal==='verify_current_person_phone'){
  const people=results.find(x=>x.capability==='find_person')?.results||[];
  if(!people.length)return{type:'clarification',text:'I could not find a person matching the name you gave me, so I did not change anything.',plan,results};
  if(people.length>1)return{type:'clarification',text:'I found more than one person matching that name. I will not guess which phone number you mean.',matches:people.map(p=>({id:p.id,name:p.display_name||[p.first_name,p.last_name].filter(Boolean).join(' '),phone:p.phone||null})),plan,results};
 }

 return{type:'completed',plan,results,requiresHumanApproval:false,requiresHumanSend:false};
   }

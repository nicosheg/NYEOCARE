// lib/aria/capabilityRegistry.js
const ACTION_TYPES=['SEND_MESSAGE','REQUEST_REVIEW','ESCALATE','DO_NOTHING'];

export const ARIA_CAPABILITIES=Object.freeze({
 find_person:{description:'Find a person known to the organization.',requiresPerson:false,mutates:false,approval:false},
 get_organization_context:{description:'Retrieve safe organization-wide context including people, groups, event semantics, attention needs and known organization facts.',requiresPerson:false,mutates:false,approval:false},
 get_person_context:{description:'Retrieve a person’s current NYEOCARE context and history.',requiresPerson:true,mutates:false,approval:false},
 explain_person:{description:'Explain what ARIA knows about a person and why attention may matter.',requiresPerson:true,mutates:false,approval:false},
 get_care_recommendations:{description:'Retrieve current care recommendations.',requiresPerson:false,mutates:false,approval:false},
 get_pending_actions:{description:'Retrieve actions waiting for human review.',requiresPerson:false,mutates:false,approval:false},
 get_operator_context:{description:'Retrieve organization operator, invitation and recorded activity context with role-aware visibility.',requiresPerson:false,mutates:false,approval:false},
 get_organization_changes:{description:'Retrieve recent organization changes and time-windowed activity deltas without mutating state.',requiresPerson:false,mutates:false,approval:false},
 get_attention_summary:{description:'Retrieve the smallest set of current high-value attention signals with evidence and a safe next-step category.',requiresPerson:false,mutates:false,approval:false},
 get_person_timeline:{description:'Retrieve a unified time-ordered history for one person across participation, communication, care, ARIA observations and actions.',requiresPerson:true,mutates:false,approval:false},
 get_person_evidence:{description:'Retrieve a person’s Living Truth, evidence, unknowns and conflicts without exposing internal identifiers.',requiresPerson:true,mutates:false,approval:false},
 remember_person_fact:{description:'Store an explicitly supplied fact or context about a person with provenance and optional expiry.',requiresPerson:true,mutates:true,approval:false},
 remember_organization_fact:{description:'Store an explicitly supplied organizational rule or convention with provenance and optional expiry. Owner/admin only.',requiresPerson:false,mutates:true,approval:false},
 remember_relationship:{description:'Store an explicitly supplied relationship between two people with provenance. Owner/admin only.',requiresPerson:true,mutates:true,approval:false},
 set_event_semantics:{description:'Store or update the semantics of an organizational service/event. Owner/admin only.',requiresPerson:false,mutates:true,approval:false},
 prepare_message:{description:'Prepare a personalized message for a person for human review and sending.',requiresPerson:true,mutates:true,approval:true},
 prepare_action:{description:'Prepare a NYEOCARE action for explicit human approval.',requiresPerson:true,mutates:true,approval:true}
});

export function getCapability(name){
 const capability=ARIA_CAPABILITIES[name];
 if(!capability)throw Object.assign(new Error(`Unknown ARIA capability: ${name}`),{status:400});
 return capability;
}
export function listCapabilities(){return Object.entries(ARIA_CAPABILITIES).map(([name,value])=>({name,...value}));}
export function isValidActionType(type){return ACTION_TYPES.includes(type);}
export function getActionTypes(){return [...ACTION_TYPES];}
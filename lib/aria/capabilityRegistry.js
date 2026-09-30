const ACTION_TYPES=['SEND_MESSAGE','REQUEST_REVIEW','ESCALATE','DO_NOTHING'];

export const ARIA_CAPABILITIES=Object.freeze({
 current_time:{description:'Read the exact current date and time using the operator timezone when supplied.',requiresPerson:false,mutates:false,approval:false},
 get_latest_attendance:{description:'Read the most recent attendance session, its timing, latest mark and confirmed attendance.',requiresPerson:false,mutates:false,approval:false},
 get_recent_activity:{description:'Read recent verified NYEOCARE API activity, ARIA events and person timeline activity.',requiresPerson:false,mutates:false,approval:false},
 get_today_attention:{description:'Read the current people and signals ARIA considers relevant for human attention today.',requiresPerson:false,mutates:false,approval:false},
 get_workspace_snapshot:{description:'Read a synchronized organization snapshot spanning people, groups, attendance, tasks, communications, scans, operators, ARIA state and recent activity.',requiresPerson:false,mutates:false,approval:false},
 operate_workspace:{description:'Perform an allowlisted NYEOCARE operation: mark_attendance, create_session, close_session, discard_session, join_session, leave_session, create_task, complete_task, add_note, record_feedback, set_lifecycle, archive_person, restore_person, create_group, update_group, delete_group, add_membership, remove_membership, add_person_role, remove_person_role, add_relationship, remove_relationship. Destructive and high-impact operations are server-confirmed.',requiresPerson:false,mutates:true,approval:false},
 find_person:{description:'Find a person known to the organization.',requiresPerson:false,mutates:false,approval:false},
 create_person:{description:'Create a new People record from an explicitly requested name, optional phone number, date of birth and type. Owner/admin only.',requiresPerson:false,mutates:true,approval:false,explicitOnly:true,requiredRole:'owner_or_admin'},
 get_organization_context:{description:'Retrieve safe organization-wide context including people, upcoming birthdays, pending follow-ups, attention needs, and known organization facts.',requiresPerson:false,mutates:false,approval:false},
 get_person_context:{description:'Retrieve a person’s current NYEOCARE context and history.',requiresPerson:true,mutates:false,approval:false},
 explain_person:{description:'Explain what ARIA knows about a person and why attention may matter.',requiresPerson:true,mutates:false,approval:false},
 get_care_recommendations:{description:'Retrieve current care recommendations.',requiresPerson:false,mutates:false,approval:false},
 send_internal_message:{description:'Send an explicit in-app message to another active organization operator. The exact recipient and exact body must be supplied by the current operator; internal only.',requiresPerson:false,mutates:true,approval:false,explicitOnly:true},
 unsend_internal_message:{description:'Unsend one of the current operator\'s own internal NYEOCARE messages. Only the sender may unsend.',requiresPerson:false,mutates:true,approval:false,explicitOnly:true},
 get_internal_messages:{description:'Retrieve the current operator\'s internal NYEOCARE messages and unread count.',requiresPerson:false,mutates:false,approval:false},
 get_pending_actions:{description:'Retrieve actions waiting for human review.',requiresPerson:false,mutates:false,approval:false},
 import_people_roster:{description:'Extract an explicitly supplied list of people and phone numbers from operator text and save safe rows into People, preserving uncertain phone rows for review. Owner/admin only.',requiresPerson:false,mutates:true,approval:false,explicitOnly:true,requiredRole:'owner_or_admin'},
 update_person_record:{description:'Preview and, after explicit human confirmation, update a person name, phone number, or date of birth. Owner/admin only.',requiresPerson:true,mutates:true,approval:false,explicitOnly:true,requiredRole:'owner_or_admin'},
 update_organization_profile:{description:'Update the current operator profile name, owner-controlled organization name, or owner/admin ARIA organization knowledge through the canonical profile mutation path.',requiresPerson:false,mutates:true,approval:false,explicitOnly:true},
 create_organization_invite:{description:'Create an explicit one-use organization invitation link for an admin or user role. Owner/admin only.',requiresPerson:false,mutates:true,approval:false,explicitOnly:true,requiredRole:'owner_or_admin'},
 manage_organization_access:{description:'Read organization users/invitations for the current operator; sensitive access changes such as removal, role changes, ownership transfer and invitation revocation are server-gated to authorized roles and require explicit confirmation.',requiresPerson:false,mutates:true,approval:false,explicitOnly:true},
 get_operator_context:{description:'Retrieve organization operator, invitation and recorded activity context with role-aware visibility.',requiresPerson:false,mutates:false,approval:false},
 get_organization_changes:{description:'Retrieve recent organization changes and time-windowed activity deltas without mutating state.',requiresPerson:false,mutates:false,approval:false},
 get_aria_continuity:{description:'Retrieve durable ARIA continuity across prior conversations, organization memory, historical changes, current state and known future commitments, with operator-aware visibility.',requiresPerson:false,mutates:false,approval:false},
 get_director_briefing:{description:'Retrieve ARIA’s canonical synchronized interpretation of the current organization: priorities, contradictions, operational health, human-care signals, opportunities, learning gaps, and next decisions.',requiresPerson:false,mutates:false,approval:false},
 get_attention_summary:{description:'Retrieve the smallest set of current high-value attention signals with evidence and a safe next-step category.',requiresPerson:false,mutates:false,approval:false},
 get_people_review_summary:{description:'Review live People data quality and identity-review needs, including high-confidence malformed names, parser artifacts, pending scan reviews, duplicate names or phones, phone field inconsistencies and unverified scan-created records.',requiresPerson:false,mutates:false,approval:false},
 get_person_timeline:{description:'Retrieve a unified time-ordered history for one person across participation, communication, care, ARIA observations and actions.',requiresPerson:true,mutates:false,approval:false},
 get_person_evidence:{description:'Retrieve a person’s Living Truth, evidence, unknowns and conflicts without exposing internal identifiers.',requiresPerson:true,mutates:false,approval:false},
 get_observation_context:{description:'Explain one specific ARIA observation, its evidence, current lifecycle and related human-review action.',requiresPerson:false,mutates:false,approval:false},
 resolve_people_cohort:{description:'Resolve a human-friendly organization cohort such as past absentees, current attention or people needing follow-up.',requiresPerson:false,mutates:false,approval:false},
 draft_message:{description:'Draft one short personalized message for one person without sending it.',requiresPerson:true,mutates:true,approval:false},
 draft_message_cohort:{description:'Draft personalized messages for a bounded cohort of people without sending them.',requiresPerson:false,mutates:true,approval:false},
 remember_person_fact:{description:'Store an explicitly supplied person fact or temporary context with provenance.',requiresPerson:true,mutates:true,approval:false},
 remember_organization_fact:{description:'Store an explicit organization rule or convention with provenance. Owner/admin only.',requiresPerson:false,mutates:true,approval:false,requiredRole:'owner_or_admin'},
 remember_relationship:{description:'Store an explicit person-to-person relationship with provenance. Owner/admin only.',requiresPerson:true,mutates:true,approval:false,requiredRole:'owner_or_admin'},
 set_event_semantics:{description:'Store organization-defined semantics for an existing event/session. Owner/admin only.',requiresPerson:false,mutates:true,approval:false,requiredRole:'owner_or_admin'},
 prepare_message:{description:'Prepare a personalized message for a person for human review and sending.',requiresPerson:true,mutates:true,approval:true},
 prepare_action:{description:'Prepare a NYEOCARE action for explicit human approval.',requiresPerson:true,mutates:true,approval:true}
});

export function getCapability(name){
 const capability=ARIA_CAPABILITIES[name];
 if(!capability)throw Object.assign(new Error(`Unknown ARIA capability: ${name}`),{status:400});
 return capability;
}

export function listCapabilities(){
 return Object.entries(ARIA_CAPABILITIES).map(([name,value])=>({name,...value}));
}

export function listCapabilitiesForRole(role){
 const allowedRole=role==='owner'||role==='admin';
 return listCapabilities().map(capability=>({
  ...capability,
  available_to_current_operator:!capability.requiredRole||allowedRole,
  availability_reason:capability.requiredRole&&!allowedRole?'Owner/admin access is required.':null
 }));
}

export function capabilityNames(){
 return Object.keys(ARIA_CAPABILITIES);
}

export function isValidActionType(type){
 return ACTION_TYPES.includes(type);
}

export function getActionTypes(){
 return [...ACTION_TYPES];
}

// scripts/aria-organizational-intelligence-regression.js
import{existsSync,readFileSync}from'node:fs';
const read=p=>readFileSync(p,'utf8');
const f={
 emitter:read('lib/aria/eventEmitter.js'),
 processor:read('lib/aria/eventProcessor.js'),
 memory:read('lib/aria/memoryEngine.js'),
 learning:read('lib/aria/learningEngine.js'),
 truth:read('lib/aria/truthEngine.js'),
 registry:read('lib/aria/capabilityRegistry.js'),
 capability:read('lib/aria/capabilityEngine.js'),
 command:read('lib/aria/commandEngine.js'),
 context:read('lib/aria/organizationContext.js'),
 attendance:read('lib/aria/attendanceProcessor.js'),
 session:read('pages/api/attendance/create-session.js'),
 feedback:read('lib/aria/feedbackEngine.js'),
 outcome:read('lib/aria/outcomeEngine.js'),
 communication:read('lib/aria/communicationOutcome.js'),
 sendWhatsapp:read('pages/api/send-whatsapp.js'),
 spec:read('NYEO_SPEC.md'),
 foundation:read('supabase/migrations/20260925193429_add_aria_organizational_intelligence_foundation_v1.sql'),
 versioning:read('supabase/migrations/20260925193438_harden_aria_memory_versioning_v1.sql'),
 spine:read('supabase/migrations/20260925194116_strengthen_aria_event_spine_v1.sql'),
 dead:read('supabase/migrations/20260925200303_allow_dead_aria_event_status_v1.sql')
};
const checks=[
 ['Canonical emitter is provenance-aware and idempotent',f.emitter.includes('evidence_kind')&&f.emitter.includes('verification_status')&&f.emitter.includes('scope_level')&&f.emitter.includes('ON CONFLICT(organization_id,event_key)')],
 ['Canonical processor uses the claimed event id for provenance',!f.processor.includes('sourceEventId:eventId')&&f.processor.includes('sourceEventId:event.id')],
 ['Canonical processor has retry lifecycle',f.processor.includes("processing_status='processing'")&&f.processor.includes("processing_status='completed'")&&f.processor.includes("processing_status='failed'")&&f.processor.includes("processing_status='dead'")],
 ['Service semantics flow through the shared event/memory spine',f.processor.includes("'SERVICE_CREATED'")&&f.processor.includes("'SERVICE_TYPE_CHANGED'")&&f.session.includes('event_semantics')&&f.session.includes("type:'SERVICE_CREATED'")],
 ['Versioned memory retains provenance and expiry',f.memory.includes('sourceEventId')&&f.memory.includes('evidenceKind')&&f.memory.includes('verificationStatus')&&f.memory.includes('validUntil')],
 ['Learning persists provenance and respects temporal validity',f.learning.includes('evidenceKind')&&f.learning.includes('verificationStatus')&&f.learning.includes('validUntil')&&f.learning.includes('valid_until IS NULL OR valid_until>NOW()')],
 ['Living Truth exposes durable memory provenance',f.truth.includes('m.evidence_kind')&&f.truth.includes('m.verification_status')&&f.truth.includes('source_event_id')&&f.truth.includes('valid_until')],
 ['Explicit memory capabilities are registered',f.registry.includes('remember_person_fact')&&f.registry.includes('remember_organization_fact')&&f.registry.includes('remember_relationship')&&f.registry.includes('set_event_semantics')],
 ['Explicit memory writes use authorization and shared memory engine',f.capability.includes('requireActor')&&f.capability.includes('requireAdmin')&&f.capability.includes('setPersonMemory')&&f.capability.includes('setOrganizationMemory')&&f.capability.includes('upsertPersonRelationship')],
 ['Explicit person facts cannot be blank',f.capability.includes('A fact or context statement is required.')],
 ['Organization context exposes groups and event semantics',f.context.includes('organization_groups')&&f.context.includes('event_semantics')&&f.context.includes('attendance_interpretation')],
 ['Absence remains an observation, not an explanation',f.attendance.includes('absence_is_not_explanation')&&f.attendance.includes('Non-observation is evidence of what was seen, not an explanation for why it happened.')],
 ['Absence care is person-first and event-aware',f.attendance.includes("'kind','care_first_check_in'")&&f.attendance.includes('focused on how they are doing')&&f.attendance.includes('participation_expected')&&f.attendance.includes('absence_meaningful')],
 ['Care feedback has provenance and enters the learning loop',f.feedback.includes('evidence_kind')&&f.feedback.includes('verification_status')&&f.feedback.includes('CARE_FEEDBACK')&&f.feedback.includes('learnFromFeedback')],
 ['Outcomes link back to source events',f.outcome.includes('sourceEventId')&&f.outcome.includes('source_event_id')],
 ['Communication outcomes are structured ARIA events',f.communication.includes('FOLLOW_UP_SENT')&&f.communication.includes('FOLLOW_UP_RECEIVED')&&f.communication.includes('FOLLOW_UP_REQUESTED_HELP')&&f.communication.includes('recordOutcome')],
 ['Legacy WhatsApp path is organization-scoped and no longer hardcodes demo-org',f.sendWhatsapp.includes('withOrg')&&f.sendWhatsapp.includes('createCareDraft')&&!f.sendWhatsapp.includes('demo-org')],
 ['Repository migration history matches applied Supabase migration versions',existsSync('supabase/migrations/20260925193429_add_aria_organizational_intelligence_foundation_v1.sql')&&existsSync('supabase/migrations/20260925193438_harden_aria_memory_versioning_v1.sql')&&existsSync('supabase/migrations/20260925194116_strengthen_aria_event_spine_v1.sql')&&existsSync('supabase/migrations/20260925200303_allow_dead_aria_event_status_v1.sql')&&!existsSync('supabase/migrations/20260925204500_strengthen_aria_event_spine.sql')],
 ['Foundation migration is faithful to its original terminal statuses',f.foundation.includes("CHECK (processing_status IN ('pending','processing','completed','failed','skipped'))")&&!f.foundation.includes("'dead'))")],
 ['Dead-letter migration matches the production repair',f.dead.includes("CHECK (processing_status IN ('pending','processing','completed','failed','skipped','dead'))")],
 ['Spec documents architecture-first organizational intelligence',f.spec.includes('architecture-first')&&f.spec.includes('Provenance contract')&&f.spec.includes('Absence semantics')&&f.spec.includes('Communication outcomes')]
];
const failures=checks.filter(([,ok])=>!ok).map(([name])=>name);
if(failures.length){console.error('[ARIA ORG INTELLIGENCE] FAILED');console.error(failures.join(' | '));process.exit(1)}
console.log('[ARIA ORG INTELLIGENCE] Organizational intelligence regression guards passed.');

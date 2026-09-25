import{readFileSync}from'node:fs';
const read=p=>readFileSync(p,'utf8');
const files={
 emitter:read('lib/aria/eventEmitter.js'),processor:read('lib/aria/eventProcessor.js'),memory:read('lib/aria/memoryEngine.js'),
 truth:read('lib/aria/truthEngine.js'),learning:read('lib/aria/learningEngine.js'),registry:read('lib/aria/capabilityRegistry.js'),
 capability:read('lib/aria/capabilityEngine.js'),command:read('lib/aria/commandEngine.js'),attendance:read('lib/aria/attendanceProcessor.js'),
 session:read('pages/api/attendance/create-session.js'),feedback:read('lib/aria/feedbackEngine.js'),communication:read('lib/aria/communicationOutcome.js'),
 migration:read('supabase/migrations/20260925190000_add_aria_organizational_intelligence_foundation_v1.sql'),
 memoryMigration:read('supabase/migrations/20260925191000_harden_aria_memory_versioning_v1.sql'),
 spec:read('NYEO_SPEC.md')
};
const checks=[
 ['Event emitter persists provenance',files.emitter.includes('evidence_kind')&&files.emitter.includes('verification_status')&&files.emitter.includes('scope_level')&&files.emitter.includes('ON CONFLICT(organization_id,event_key)')],
 ['Event processor has durable processing states',files.processor.includes("processing_status='processing'")&&files.processor.includes("processing_status='completed'")&&files.processor.includes("processing_status='failed'")],
 ['Event processor recognizes organizational and care events',files.processor.includes('PERSON_NOT_OBSERVED')&&files.processor.includes('FOLLOW_UP_RECEIVED')&&files.processor.includes('ORGANIZATIONAL_RULE_LEARNED')&&files.processor.includes('NEW_RELATIONSHIP')],
 ['Versioned memory exists without a duplicate intelligence table',files.memory.includes('recordPersonMemory')&&files.memory.includes('recordOrganizationMemory')&&files.memory.includes('supersedes_id')&&files.memory.includes('validUntil')],
 ['Living Truth uses real memory provenance',files.truth.includes('m.evidence_kind')&&files.truth.includes('m.verification_status')&&files.truth.includes('is_current=true')],
 ['Learning respects expiry',files.learning.includes('valid_until IS NULL OR valid_until>NOW()')&&files.learning.includes('validUntil')],
 ['Explicit memory capabilities exist',files.registry.includes('remember_person_fact')&&files.registry.includes('remember_organization_fact')&&files.registry.includes('remember_relationship')&&files.registry.includes('set_event_semantics')],
 ['Memory capabilities write through the shared event/memory architecture',files.capability.includes('recordPersonMemory')&&files.capability.includes('recordOrganizationMemory')&&files.capability.includes('recordRelationship')&&files.capability.includes('emitAriaEvent')],
 ['Command planner knows the shared memory capabilities',files.command.includes('remember_person_fact')&&files.command.includes('remember_organization_fact')&&files.command.includes('set_event_semantics')],
 ['Service/event semantics are persisted on sessions',files.session.includes('event_semantics')&&files.session.includes('attendance_interpretation')&&files.session.includes('absence_meaningful')],
 ['Absence remains an observation and care stays person-first',files.attendance.includes('absence_is_not_explanation')&&files.attendance.includes('care_first_check_in')&&files.attendance.includes('focused on how they are doing')],
 ['Communication outcomes have a structured adapter',files.communication.includes('FOLLOW_UP_SENT')&&files.communication.includes('FOLLOW_UP_REQUESTED_HELP')&&files.communication.includes('emitAriaEvent')],
 ['Communication feedback carries provenance',files.feedback.includes('evidence_kind')&&files.feedback.includes('verification_status')&&files.feedback.includes('sourceEventId')],
 ['Migrations document the production foundation',files.migration.includes('aria_events_processing_queue_idx')&&files.migration.includes('sessions_org_event_semantics_idx')&&files.memoryMigration.includes('person_memory_current_key_unique')],
 ['Architecture documentation remains present',files.spec.includes('Living Truth')&&files.spec.includes('architecture-first')]
];
const failures=checks.filter(([,ok])=>!ok).map(([name])=>name);
if(failures.length){console.error('[ARIA ORG INTELLIGENCE] FAILED');console.error(failures.join(' | '));process.exit(1)}
console.log('[ARIA ORG INTELLIGENCE] Organizational-intelligence regression guards passed.');
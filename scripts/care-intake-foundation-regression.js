// scripts/care-intake-foundation-regression.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = path => fs.readFileSync(path, 'utf8');

const disableLegacyAttendanceMigration = read('supabase/migrations/20261126040102_disable_legacy_attendance_absence_actions.sql');
const retireAttendanceCareMigration = read('supabase/migrations/20261126040952_retire_remaining_automatic_attendance_care.sql');
const migration = read('supabase/migrations/20261126080910_canonical_care_intake_privacy_foundation.sql');
const privacyFunctionMoveMigration = read('supabase/migrations/20261126093944_harden_care_privacy_function_exposure.sql');
const privatePrivacyGuardMigration = read('supabase/migrations/20261126094045_use_private_definer_care_privacy_guard.sql');
const intake = read('pages/api/aria/intake.js');
const review = read('pages/api/aria/intake-review.js');
const emitter = read('lib/aria/eventEmitter.js');
const processor = read('lib/aria/eventProcessor.js');
const recommendation = read('lib/aria/recommendationEngine.js');
const draft = read('lib/aria/draftEngine.js');
const communication = read('lib/aria/communicationOutcome.js');
const journey = read('pages/api/person/journey.js');
const universal = read('lib/aria/universalWorkspace.js');
const careEngine = read('lib/aria/careEngine.js');
const attendance = read('lib/aria/attendanceProcessor.js');
const contactPreference = read('lib/aria/contactPreference.js');
const temporal = read('lib/aria/temporalEngine.js');
const attendanceIntelligence = read('lib/aria/attendanceIntelligence.js');
const feedbackEngine = read('lib/aria/feedbackEngine.js');
const followUp = read('pages/api/daily-queue/complete-follow-up.js');
const capture = read('components/CareIntakeCapture.js');
const reviewUi = read('components/CareIntakeReview.js');
const workToday = read('components/WorkToday.js');
const personOperatingSystem=read('lib/peopleOperatingSystem.js');
const personOperatingApi=read('pages/api/people/operating-system.js');
const timelineApi=read('pages/api/timeline.js');
const outcomeEngine=read('lib/aria/outcomeEngine.js');
const relationshipScore=read('lib/aria/relationshipScore.js');
const priorityQueue=read('lib/aria/priorityQueue.js');
const careContacts=read('lib/aria/careContacts.js');
const directorEngine=read('lib/aria/directorEngine.js');
const universalWorkspace=read('lib/aria/universalWorkspace.js');

assert.ok(/ALTER TABLE public\.aria_events/.test(migration) &&
  /ADD COLUMN IF NOT EXISTS privacy_class/.test(migration) &&
  /ADD COLUMN IF NOT EXISTS consent_status/.test(migration),
  'privacy and consent must extend the canonical event spine');
assert.ok(/aria_events_privacy_class_check/.test(migration) &&
  /aria_events_consent_status_check/.test(migration) &&
  /OLD\.privacy_class IS DISTINCT FROM NEW\.privacy_class/.test(migration) &&
  /OLD\.consent_status IS DISTINCT FROM NEW\.consent_status/.test(migration),
  'privacy and consent must be constrained and immutable');
assert.ok(!/CREATE TABLE/i.test(migration), 'Phase 1 must not create a duplicate intake, case or task table');
assert.ok(!/AS \$\n/.test(migration) && (migration.match(/AS \$phase1\$/g)||[]).length===4 && (migration.match(/\$phase1\$;/g)||[]).length===4, 'every new SQL function must have a valid matching dollar-quote delimiter');
const feedbackUpdatePolicy=migration.slice(
  migration.indexOf('DROP POLICY IF EXISTS care_feedback_actor_or_admin_update'),
  migration.indexOf('DROP POLICY IF EXISTS care_feedback_insert')
);
assert.ok(feedbackUpdatePolicy.includes('is_admin()') &&
  feedbackUpdatePolicy.includes('actor_id IN') &&
  feedbackUpdatePolicy.includes('can_access_care_privacy'),
  'care feedback updates must retain actor/admin authorization while applying private-record visibility');
assert.ok(migration.includes('can_access_care_privacy') &&
  migration.includes('person_communications_org_select') &&
  migration.includes('timeline_events_select_same_organization') &&
  migration.includes('protect_care_feedback_privacy_trigger') &&
  migration.includes('block_outbound_when_do_not_contact_trigger'),
  'database RLS and triggers must enforce confidentiality and no-contact beyond application UI');

assert.ok(intake.includes("'CARE_INTAKE_RECORDED'") &&
  intake.includes("source: 'care_intake'") &&
  intake.includes("evidenceKind: 'human_report'") &&
  intake.includes("verificationStatus: 'reported'") &&
  intake.includes('eventKey'),
  'intake must preserve source, reporter provenance, evidence type and an idempotent event key');
assert.ok(intake.includes('care_responsibility_created: false') &&
  !intake.includes('planActionFromObservation') &&
  !intake.includes('INSERT INTO aria_actions'),
  'recording a care signal must not silently create a responsibility');
assert.ok(intake.includes('prayer_request') && intake.includes('personal_need') &&
  intake.includes('practical_support') && intake.includes('relationship_request') &&
  intake.includes('complaint') && intake.includes('first_visit') &&
  intake.includes('contact_permission') && intake.includes('consent_status') && intake.includes('review_operators') && intake.includes("r.defer_until::date<=$6::date"),
  'intake must support core care signal categories and consent/contact preferences');
assert.ok(intake.includes("detailsPermitted ? statementInput || null : null") &&
  intake.includes("if (storedEvent.person_id && savedPermission === 'do_not_contact')") &&
  intake.includes("UPDATE person_communications") &&
  intake.includes("UPDATE aria_actions") &&
  intake.includes("UPDATE aria_daily_queue_items"),
  'declined consent must withhold narrative and a no-contact request must suppress drafts, actions and queue items');
assert.ok(intake.includes('isOrganizationOperator(req.user?.role)') &&
  intake.includes("e.privacy_class='standard'") &&
  intake.includes("e.privacy_class='sensitive'") &&
  intake.includes("e.privacy_class='restricted'"),
  'intake read/write must be tenant authenticated and role-filtered');

assert.ok(review.includes("'approved', 'dismissed', 'deferred'") &&
  review.includes("'CARE_INTAKE_REVIEWED'") &&
  review.includes('planActionFromObservation') &&
  review.includes("actionType: 'CARE_FOLLOW_UP'") &&
  review.includes("kind: 'manual_care_responsibility'") &&
  review.includes('getDailyQueue'),
  'human review must append a decision and reuse the canonical action and queue');
assert.ok(review.includes('resolved_person_id') &&
  review.includes('linked_person_id') &&
  review.includes('identity_linked_by'),
  'anonymous intake must be linkable only through an explicit human decision');
assert.ok(review.includes("String(intake.consent_status || 'unknown').toLowerCase() !== 'granted'"), 'identified care work requires explicit recorded consent');
assert.ok(review.includes('assigned_user_id') && review.includes('due_date') &&
  review.includes('Do not create an outreach responsibility'),
  'approved work must have an accountable operator/date and respect contact suppression');

assert.ok(emitter.includes('privacy_class,consent_status,processing_status') &&
  emitter.includes("PRIVACY_CLASSES.has(privacyClass)") &&
  emitter.includes("CONSENT_STATES.has(consentStatus)"),
  'the canonical event emitter must persist and validate privacy and consent');
assert.ok(processor.includes("event.privacy_class!=='standard'") &&
  processor.includes('Do not copy it into shared observations'),
  'non-standard private care events must not flow into shared memory or intelligence');
assert.ok(recommendation.includes('pg_advisory_xact_lock') &&
  recommendation.includes('do_not_contact') &&
  recommendation.includes('DO_NOT_CONTACT') &&
  recommendation.includes('CONTACT_ACTION_TYPES'),
  'action creation, approval and execution must serialize against no-contact preference writes');
assert.ok(draft.includes('getRecordedContactPermission') &&
  draft.includes('No outreach draft can be created') &&
  draft.includes("status='draft'") &&
  draft.includes("whatsappUrl:contactPermission==='allowed'?") &&
  draft.includes('privacy_reporter_id:privacyReporterId'),
  'message drafting must honor recorded permission, suppress no-contact, hide unapproved WhatsApp handoffs and carry privacy metadata');
assert.ok(communication.includes('getRecordedContactPermission') &&
  communication.includes('initiatesContact') &&
  communication.includes('eventPrivacyClass') &&
  communication.includes('permission!==\'allowed\''),
  'new outbound communication must require recorded contact permission and keep private outcomes out of shared ARIA');
assert.ok(contactPreference.includes('aria_care_contexts') &&
  contactPreference.includes('COMMUNICATION_PREFERENCE_CHANGED') &&
  contactPreference.includes("return 'unknown'"),
  'contact permission must resolve from the canonical no-contact context and latest preference event');
assert.ok(followUp.includes('getRecordedContactPermission') &&
  followUp.includes('contactOutcomes') &&
  followUp.includes('const safeNote = privateAction ?') &&
  followUp.includes('COMMUNICATION_PREFERENCE_CHANGED'),
  'follow-up completion must enforce contact permission, redact private notes and persist no-contact changes');
assert.ok(journey.includes("e.privacy_class='standard'") &&
  journey.includes("e.privacy_class='sensitive'") &&
  journey.includes("e.privacy_class='restricted'") &&
  journey.includes('req.user.id'),
  'person history must apply privacy class and actor/role authorization');
assert.ok(universal.includes("e.privacy_class='standard'") &&
  universal.includes("'CARE_INTAKE_RECORDED','CARE_INTAKE_REVIEWED','COMMUNICATION_PREFERENCE_CHANGED'"),
  'organization-wide activity must never expose private intake');
assert.ok(careEngine.includes('pg_advisory_xact_lock') &&
  careEngine.includes('blockedIds') &&
  careEngine.includes('nyeocare:do-not-contact:'),
  'proactive care generation must recheck no-contact atomically before creating responsibilities');
assert.ok(attendance.includes("metadata->>'do_not_contact'='true'") &&
  attendance.includes('aria_care_contexts'),
  'attendance-derived care must continue honoring existing no-contact context');


assert.ok(temporal.includes("e.privacy_class='standard'") &&
  temporal.includes("COALESCE(f.context->>'privacy_class','standard')='standard'") &&
  temporal.includes("COALESCE(te.metadata->>'privacy_class','standard')='standard'") &&
  temporal.includes("COALESCE(pc.metadata->>'privacy_class','standard')='standard'"),
  'shared ARIA timelines and organization change feeds must exclude private care context');
assert.ok(attendanceIntelligence.includes("COALESCE(io.evidence->>'privacy_class','standard')='standard'") &&
  attendanceIntelligence.includes("COALESCE(c.context->>'privacy_class','standard')='standard'"),
  'private care outcomes must not influence shared attendance relationship scores');
assert.ok(feedbackEngine.includes("COALESCE(context->>'privacy_class','standard')='standard'") &&
  feedbackEngine.includes("if(privacyClass==='standard')await learnFromFeedback"),
  'private care feedback must be role-scoped and excluded from shared learning');
assert.ok(capture.includes('consent_status') && capture.includes('contact_permission') &&
  capture.includes('Signal saved for human review. No task or message was created.'),
  'capture UI must communicate consent, contact preference and no automatic task creation');
assert.ok(reviewUi.includes('setCandidates(Array.isArray(body.review_operators)') &&
  reviewUi.includes('(showAll?items:items.slice(0,3)).map(item=>{') && reviewUi.includes('Approve & assign'),
  'review UI must use server-authorized assignees and stay compact by default');
assert.ok(workToday.includes('CareIntakeCapture') && workToday.includes('CareIntakeReview') &&
  workToday.includes("['owner','admin','leader'].includes(role)"),
  'intake and review must live inside the canonical ARIA Today surface');


assert.ok(personOperatingSystem.includes("getPerson360(orgId,personId,{role='user',actorId=null}={})") &&
  personOperatingSystem.includes("COALESCE(metadata->>'privacy_class','standard')='standard'") &&
  personOperatingSystem.includes("COALESCE(action_metadata->>'privacy_class','standard')='standard'") &&
  personOperatingApi.includes("role:req.user?.role,actorId:req.user?.id"),
  'Person 360 must enforce authenticated viewer privacy scope');
assert.ok(timelineApi.includes("t.metadata->>'privacy_reporter_id'=$4::text") &&
  timelineApi.includes('delete safeMetadata.privacy_class') &&
  timelineApi.includes("COALESCE(t.metadata->>'privacy_class','standard')='standard'"),
  'generic timeline endpoint must enforce visibility and reject client-supplied privacy tags');
assert.ok(outcomeEngine.includes("privacyClass,consentStatus:actionMetadata.consent_status||'unknown'") &&
  outcomeEngine.includes("if(privacyClass==='standard')") &&
  outcomeEngine.includes("COALESCE(evidence->>'privacy_class','standard')='standard'"),
  'generic outcome recording must preserve private tags and avoid shared learning');
assert.ok(relationshipScore.includes("COALESCE(evidence->>'privacy_class','standard')='standard'") &&
  careContacts.includes("COALESCE(io.evidence->>'privacy_class','standard')='standard'") &&
  priorityQueue.includes("COALESCE(action_metadata->>'privacy_class','standard')='standard'"),
  'relationship scores, care-contact suggestions and priority queue must exclude private care records');
assert.ok(directorEngine.includes("e.privacy_class='standard'") &&
  directorEngine.includes("COALESCE(action_metadata->>'privacy_class','standard')='standard'") &&
  directorEngine.includes("COALESCE(io.evidence->>'privacy_class','standard')='standard'"),
  'director-level aggregate intelligence must exclude private care evidence');
assert.ok(universalWorkspace.includes("COALESCE(t.metadata->>'privacy_class','standard')='standard'") &&
  universalWorkspace.includes("COALESCE(pc.metadata->>'privacy_class','standard')='standard'"),
  'workspace activity and communication snapshot must exclude private care records');


assert.ok(disableLegacyAttendanceMigration.startsWith('-- supabase/migrations/20261126040102_disable_legacy_attendance_absence_actions.sql') &&
  retireAttendanceCareMigration.startsWith('-- supabase/migrations/20261126040952_retire_remaining_automatic_attendance_care.sql') &&
  migration.startsWith('-- supabase/migrations/20261126080910_canonical_care_intake_privacy_foundation.sql') &&
  privacyFunctionMoveMigration.startsWith('-- supabase/migrations/20261126093944_harden_care_privacy_function_exposure.sql') &&
  privatePrivacyGuardMigration.startsWith('-- supabase/migrations/20261126094045_use_private_definer_care_privacy_guard.sql'),
  'migration filenames and embedded headers must match the applied production versions exactly');

assert.ok(disableLegacyAttendanceMigration.includes('RENAME TO nyeocare_attendance_stage_legacy_20261126') && disableLegacyAttendanceMigration.includes('automatic_attendance_care_paused') && disableLegacyAttendanceMigration.includes('absence_meaningful IS DISTINCT FROM TRUE'), 'legacy attendance SQL stage must preserve observations but suppress unverified absence outreach');
assert.ok(retireAttendanceCareMigration.includes('Attendance observations are evidence') && retireAttendanceCareMigration.includes('attendance_absence_check_in') && retireAttendanceCareMigration.includes('A human may create a new responsibility'), 'legacy attendance-created contact duties must be retired without deleting attendance evidence');

assert.ok(privacyFunctionMoveMigration.includes('CREATE SCHEMA IF NOT EXISTS private') &&
  privacyFunctionMoveMigration.includes('ALTER FUNCTION public.can_access_care_privacy(text,text,text) SET SCHEMA private') &&
  privacyFunctionMoveMigration.includes('ALTER FUNCTION public.block_outbound_when_do_not_contact() SET SCHEMA private') &&
  privacyFunctionMoveMigration.includes('ALTER POLICY timeline_events_select_same_organization') &&
  privacyFunctionMoveMigration.includes('TO authenticated') &&
  !privacyFunctionMoveMigration.includes('GRANT EXECUTE ON FUNCTION private.block_outbound_when_do_not_contact() TO authenticated'),
  'care privacy and trigger functions must be isolated in the private schema and timeline RLS must exclude anonymous users');
assert.ok(privatePrivacyGuardMigration.includes('SECURITY DEFINER') &&
  privatePrivacyGuardMigration.includes('SET search_path = \'\'') &&
  privatePrivacyGuardMigration.includes('auth.uid() IS NOT NULL') &&
  privatePrivacyGuardMigration.includes('FROM public.users') &&
  privatePrivacyGuardMigration.includes('REVOKE ALL ON FUNCTION private.can_access_care_privacy(text,text,text) FROM anon') &&
  privatePrivacyGuardMigration.includes('GRANT EXECUTE ON FUNCTION private.can_access_care_privacy(text,text,text) TO authenticated') &&
  !privatePrivacyGuardMigration.includes('public.can_access_care_privacy'),
  'the RLS helper may use SECURITY DEFINER only in non-exposed private schema, with an auth.uid guard and authenticated-only execution');

console.log('[CARE INTAKE FOUNDATION] canonical intake, human review, provenance, privacy, no-contact serialization and no-duplicate architecture passed.');

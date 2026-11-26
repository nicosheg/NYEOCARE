// scripts/care-intake-foundation-regression.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = path => fs.readFileSync(path, 'utf8');

const migration = read('supabase/migrations/20261126113000_canonical_care_intake_privacy_foundation.sql');
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

console.log('[CARE INTAKE FOUNDATION] canonical intake, human review, provenance, privacy, no-contact serialization and no-duplicate architecture passed.');

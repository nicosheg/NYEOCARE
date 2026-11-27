// scripts/canonical-care-integration-regression.js
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const manual = read('pages/api/care-responsibilities.js');
const review = read('pages/api/aria/intake-review.js');
const writer = read('lib/aria/careResponsibility.js');
const intake = read('pages/api/aria/intake.js');
const intakeService = read('lib/aria/careIntakeService.js');
const followUp = read('pages/api/daily-queue/complete-follow-up.js');
const commandEngine = read('lib/aria/commandEngine.js');
const conversationEngine = read('lib/aria/conversationEngine.js');
const capability = read('lib/aria/capabilityEngine.js');
const registry = read('lib/aria/capabilityRegistry.js');
const processor = read('lib/aria/eventProcessor.js');
const conversationImport = read('pages/api/conversation/import.js');
const personJourney = read('pages/api/person/journey.js');
const intakeApi = read('pages/api/aria/intake.js');
const timelineApi = read('pages/api/timeline.js');
const operatingSystem = read('lib/peopleOperatingSystem.js');
const operatingSystemApi = read('pages/api/people/operating-system.js');
const journeyWriter = read('lib/aria/personJourney.js');
const universalWorkspace = read('lib/aria/universalWorkspace.js');
const feedbackEngine = read('lib/aria/feedbackEngine.js');
const communityPage = read('pages/community.js');
const communityTab = read('components/CommunityTab.js');
const personPage = read('pages/person/[id].js');
const processApi = read('pages/api/aria/process-events.js');
const workerWorkflow = read('.github/workflows/aria-event-worker.yml');
const phaseRunbook = read('docs/CARE_PHASE1_E2E.md');

let passed = 0;
const verify = (name, condition) => {
  assert.ok(condition, '[CANONICAL CARE INTEGRATION] ' + name);
  passed += 1;
  console.log('PASS ' + name);
};

verify(
  'intake review and Person Journey share one care action writer',
  review.includes('createCareResponsibility') && manual.includes('createCareResponsibility') &&
    writer.includes('export async function createCareResponsibility')
);
verify(
  'private action cards never copy private narrative into action summaries or messages',
  writer.includes('summary: isPrivate ? null') && writer.includes('message: isPrivate ? null') &&
    writer.includes('source_intake_event_id: intakeEvent.id')
);
verify(
  'Person Journey manual responsibility uses canonical intake and explicit approval events',
  manual.includes('recordCareIntake({') &&
    manual.includes("type: 'CARE_INTAKE_REVIEWED'") &&
    manual.includes("decision: 'approved'") && intakeService.includes("type: 'CARE_INTAKE_RECORDED'")
);
verify(
  'manual responsibility creation shares explicit consent validation with every other intake channel',
  manual.includes('consentConfirmed: true') &&
    manual.includes("consentStatus: 'granted'") &&
    intakeService.includes("method: consentStatus === 'granted' ? 'operator_attestation'")
);
verify(
  'manual responsibility writes require stable idempotency and reject changed-payload replays',
  manual.includes('uuidPattern.test(idempotencyKey)') &&
    manual.includes('recordCareIntake({') &&
    intakeService.includes("const eventKey = 'care-intake:' + idempotencyKey") &&
    intakeService.includes('request_fingerprint: fingerprint') &&
    intakeService.includes('responsibility_fingerprint') &&
    manual.includes('responsibility_fingerprint: fingerprint') &&
    intakeService.includes('request key was already used for different care details')
);
verify(
  'category minimums cannot be downgraded below restricted care',
  manual.includes("restrictedCategories.has(category)") &&
    manual.includes("requestedPrivacy === 'restricted'") &&
    manual.includes("privacyClass === 'restricted' ? ['owner', 'admin']")
);
verify(
  'manual narrative is stored only inside the classified intake event',
  manual.includes('statement: description || title') &&
    writer.includes('const isPrivate = privacyClass !==') &&
    writer.includes('summary: isPrivate ? null') &&
    !manual.includes('actionMetadata: {')
);
verify(
  'ARIA private care reads validate active actor and apply reporter/role boundaries',
  capability.includes('async function authorizedCareIntakes') &&
    capability.includes('requireActor(organizationId,actorId)') &&
    capability.includes("e.actor_id=$3::uuid OR $4::text IN('owner','admin','leader')") &&
    capability.includes("e.actor_id=$3::uuid OR $4::text IN('owner','admin')")
);
verify(
  'ARIA person context and evidence return the same scoped care records',
  capability.includes('care_intakes:careIntakes') &&
    capability.includes('personContext(organizationId,personId,actorId)') &&
    capability.includes('personEvidenceContext(organizationId,personId,actorId)') &&
    registry.includes('authorized private care records')
);
verify(
  'intake and follow-up no-contact decisions use the same preference, cancellation and queue transaction',
  intakeService.includes('export async function persistDoNotContact') &&
    intakeService.includes('UPDATE person_communications') &&
    intakeService.includes('UPDATE aria_actions') &&
    followUp.includes('persistDoNotContact(client') &&
    !followUp.includes('INSERT INTO aria_care_contexts') &&
    !followUp.includes("type:'COMMUNICATION_PREFERENCE_CHANGED'")
);
verify(
  'ARIA workspace feedback uses the canonical feedback-to-outcome and event lifecycle',
  universalWorkspace.includes("import { recordCareFeedback } from './feedbackEngine'") &&
    universalWorkspace.includes('recordCareFeedback({') &&
    !universalWorkspace.includes('INSERT INTO care_feedback') &&
    feedbackEngine.includes('INSERT INTO intelligence_outcomes') &&
    feedbackEngine.includes("type:'CARE_FEEDBACK'") &&
    feedbackEngine.includes("await client.query('BEGIN')") &&
    feedbackEngine.includes("await client.query('COMMIT')") &&
    feedbackEngine.includes("await client.query('ROLLBACK')") &&
    feedbackEngine.includes('The care feedback event could not be linked safely.') &&
    feedbackEngine.includes('SET source_event_id=$1,updated_at=NOW()')
);
verify(
  'private care remains excluded from shared observation and memory processing',
  processor.includes("if(event.privacy_class&&event.privacy_class!=='standard')return null")
);
verify(
  'care forms, conversation imports, ARIA chat and ARIA private notes share one intake writer',
  intake.includes('recordCareIntake') &&
    manual.includes('recordCareIntake') &&
    conversationImport.includes('recordCareIntake') &&
    capability.includes('recordCareIntake') &&
    universalWorkspace.includes('recordCareIntake') &&
    intakeService.includes('export async function recordCareIntake')
);
verify(
  'shared intake writer binds idempotency to the exact tenant, person, actor, content and privacy payload',
  intakeService.includes("createHash('sha256')") &&
    intakeService.includes('request_fingerprint: fingerprint') &&
    intakeService.includes('source: clean(source || \'aria\', 80)') &&
    intakeService.includes('event.metadata?.request_fingerprint !== fingerprint') &&
    intakeService.includes('nyeocare:care-intake:')
);
verify(
  'follow-up outcome feedback and intelligence records link back to the immutable ARIA event',
  followUp.includes('UPDATE care_feedback') &&
    followUp.includes('SET source_event_id=$1,updated_at=NOW()') &&
    followUp.includes('UPDATE intelligence_outcomes') &&
    followUp.includes('SET source_event_id=$1') &&
    followUp.includes('[event.id, feedback.id, req.org.id]')
);
verify(
  'event processor rolls back failed work before persisting a retryable failure state',
  processor.includes("await db.query('ROLLBACK').catch(()=>{});") &&
    processor.includes('let the caller roll it back and the durable worker retry later') &&
    processor.includes('processing_attempts=processing_attempts+1') &&
    processor.includes('processing_attempts+1>=8') &&
    processor.indexOf("await db.query('ROLLBACK').catch(()=>{});") < processor.indexOf('UPDATE aria_events SET processing_status=CASE WHEN processing_attempts>=8')
);
verify(
  'global event worker recovers expired processing leases after a crashed worker',
  processor.includes("processing_status='processing'") &&
    processor.includes("processing_started_at<NOW()-INTERVAL '5 minutes'") &&
    processor.includes('processing_attempts<8') &&
    processor.includes("processing_status='dead'") &&
    processor.includes('Worker lease expired after the maximum processing attempts') &&
    processor.includes('processPendingAriaEvents')
);
verify(
  'ARIA chat requires explicit operator instruction, named person, explicit consent and a stable key',
  registry.includes('record_care_intake:') &&
    capability.includes("case'record_care_intake'") &&
    capability.includes('parameters.explicit!==true') &&
    capability.includes('parameters.consent_confirmed!==true') &&
    capability.includes('parameters.idempotency_key') &&
    commandEngine.includes('record_care_intake') &&
    commandEngine.includes('never infer consent')
);
verify(
  'ARIA chat records evidence only and never creates contact or a responsibility',
  capability.includes("contactPermission:parameters.contact_permission||'unknown'") &&
    capability.includes('care_responsibility_created:false') &&
    capability.includes('No responsibility has been assigned') &&
    conversationEngine.includes("item.capability==='record_care_intake'")
);
verify(
  'shared intake writer applies confidentiality minimums and keeps contact permission independent',
  intakeService.includes("prayer_request: 'restricted'") &&
    intakeService.includes("personal_need: 'restricted'") &&
    intakeService.includes("complaint: 'restricted'") &&
    intakeService.includes("contactPermission = clean(contactPermission || 'unknown'") &&
    intakeService.includes('Contact permission must be unknown, allowed or do_not_contact')
);
verify(
  'conversation imports require consent and idempotency and write one private canonical event',
  conversationImport.includes('recordCareIntake({') &&
    intakeService.includes("type: 'CARE_INTAKE_RECORDED'") &&
    conversationImport.includes('body.consent_confirmed !== true') &&
    conversationImport.includes('UUID.test(idempotencyKey)') &&
    conversationImport.includes("privacyClass,") &&
    !conversationImport.includes('INSERT INTO timeline_events') &&
    !conversationImport.includes('INSERT INTO person_communications') &&
    !conversationImport.includes('GROQ_API_KEY')
);
verify(
  'Person Journey conversation transcripts are limited to their creator or owner/admin',
  personJourney.includes('c.user_id=$4::uuid OR $3::text IN(\'owner\',\'admin\')')
);
verify(
  'context notes are canonical sensitive evidence and never enter the leader review queue',
  intakeApi.includes('recordCareIntake({') &&
    intakeService.includes("'context_note'") &&
    intakeService.includes("context_note: 'sensitive'") &&
    intakeService.includes('if (PRIVACY_RANK[minimum] > PRIVACY_RANK[privacyClass]) privacyClass = minimum') &&
    !intakeService.includes("if (category === 'context_note') privacyClass = 'sensitive'") &&
    intakeService.includes("requires_human_review: category !== 'context_note'") &&
    intakeApi.includes('review_required: result.reviewRequired') &&
    intakeService.includes("category === 'context_note' && personId && consentStatus !== 'granted'")
);
verify(
  'Person Journey and Community pastoral notes use private intake with consent and stable keys',
  personPage.includes("category:'context_note'") &&
    communityPage.includes("category: 'context_note'") &&
    communityTab.includes("category: 'context_note'") &&
    communityPage.includes('noteConsent') && communityTab.includes('noteConsent')
);
verify(
  'ARIA workspace add_note uses the canonical private intake service and cannot write to a shared timeline',
  universalWorkspace.includes("if(op==='add_note')") &&
    universalWorkspace.includes("parameters.consent_confirmed!==true") &&
    universalWorkspace.includes('recordCareIntake({') &&
    universalWorkspace.includes("category:'context_note'") &&
    intakeService.includes("type: 'CARE_INTAKE_RECORDED'") &&
    intakeService.includes("requires_human_review: category !== 'context_note'") &&
    !universalWorkspace.includes("event_type:'NOTE'") &&
    !universalWorkspace.includes('INSERT INTO timeline_events')
);
verify(
  'legacy note writes are rejected at every shared timeline adapter',
  timelineApi.includes("['note','pastoral_note'].includes") &&
    operatingSystem.includes("['note','pastoral_note'].includes") &&
    operatingSystemApi.includes('Person notes must be recorded through private ARIA care intake') &&
    journeyWriter.includes("['note','pastoral_note'].includes")
);
verify(
  'Person Journey displays only authorized context notes returned through its privacy-filtered event query',
  personJourney.includes("e.privacy_class='sensitive'") &&
    personJourney.includes("e.privacy_class='restricted'") &&
    personPage.includes("careNotes:(a.aria_events||[]).filter(e=>e.type==='CARE_INTAKE_RECORDED'&&e.metadata?.intake?.category==='context_note')") &&
    personPage.includes('Private care context')
);
verify(
  'Community conversation import UI sends consent, confidentiality and idempotency',
  communityPage.includes('convConsent') &&
    communityTab.includes('convConsent') &&
    communityPage.includes('consent_confirmed: true') &&
    communityTab.includes('consent_confirmed: true') &&
    communityPage.includes('privacy_class: convPrivacyClass') &&
    communityTab.includes('privacy_class: convPrivacyClass')
);
verify(
  'Person Journey UI requires consent and displays care confidentiality controls',
  personPage.includes('careConsentConfirmed') &&
    personPage.includes('conversationConsent') &&
    personPage.includes('conversationPrivacyClass') &&
    personPage.includes('consent_confirmed:conversationConsent')
);
verify(
  'cron worker processes one shared event queue rather than looping a capped organization list',
  processApi.includes('processPendingAriaEvents({limit})') &&
    !processApi.includes('SELECT id FROM organizations')
);
verify(
  'scheduled runner is opt-in, protected by a shared secret and invokes the authenticated worker route',
  workerWorkflow.includes('cron: "*/5 * * * *"') &&
    workerWorkflow.includes("vars.NYEOCARE_ENABLE_EVENT_WORKER == 'true'") &&
    workerWorkflow.includes('secrets.NYEOCARE_CRON_SECRET') &&
    workerWorkflow.includes('/api/aria/process-events?limit=100')
);
verify(
  'runbook explicitly prevents live Havilah write-tests and documents worker activation',
  phaseRunbook.includes('Do not seed fake people or care reports in Havilah production') &&
    phaseRunbook.includes('NYEOCARE_CRON_SECRET')
);

console.log('[CANONICAL CARE INTEGRATION] ' + passed + ' cross-system source contracts passed.');

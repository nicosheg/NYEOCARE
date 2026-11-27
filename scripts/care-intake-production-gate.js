// scripts/care-intake-production-gate.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const files = {
  intake: read('pages/api/aria/intake.js'),
  review: read('pages/api/aria/intake-review.js'),
  manualCare: read('pages/api/care-responsibilities.js'),
  careWriter: read('lib/aria/careResponsibility.js'),
  intakeService: read('lib/aria/careIntakeService.js'),
  conversationImport: read('pages/api/conversation/import.js'),
  capability: read('lib/aria/capabilityEngine.js'),
  registry: read('lib/aria/capabilityRegistry.js'),
  processApi: read('pages/api/aria/process-events.js'),
  workerWorkflow: read('.github/workflows/aria-event-worker.yml'),
  timelineApi: read('pages/api/timeline.js'),
  peopleOperatingSystem: read('lib/peopleOperatingSystem.js'),
  peopleOperatingApi: read('pages/api/people/operating-system.js'),
  journeyWriter: read('lib/aria/personJourney.js'),
  universalWorkspace: read('lib/aria/universalWorkspace.js'),
  communityPage: read('pages/community.js'),
  communityTab: read('components/CommunityTab.js'),
  personPage: read('pages/person/[id].js'),
  emitter: read('lib/aria/eventEmitter.js'),
  processor: read('lib/aria/eventProcessor.js'),
  contact: read('lib/aria/contactPreference.js'),
  recommendation: read('lib/aria/recommendationEngine.js'),
  draft: read('lib/aria/draftEngine.js'),
  communication: read('lib/aria/communicationOutcome.js'),
  followUp: read('pages/api/daily-queue/complete-follow-up.js'),
  journey: read('pages/api/person/journey.js'),
  timeline: read('pages/api/timeline.js'),
  capture: read('components/CareIntakeCapture.js'),
  reviewUi: read('components/CareIntakeReview.js'),
  eventMigration: read('supabase/migrations/20260925194116_strengthen_aria_event_spine_v1.sql'),
  careMigration: read('supabase/migrations/20261126080910_canonical_care_intake_privacy_foundation.sql'),
  moveMigration: read('supabase/migrations/20261126093944_harden_care_privacy_function_exposure.sql'),
  guardMigration: read('supabase/migrations/20261126094045_use_private_definer_care_privacy_guard.sql'),
  spec: read('NYEO_SPEC.md')
};

let passed = 0;
const verify = (name, condition) => {
  assert.ok(condition, '[CARE PRODUCTION GATE] ' + name);
  passed += 1;
  console.log('PASS ' + name);
};

const observationMap = files.processor.split('const OBSERVATION_MAP={')[1]?.split('};')[0] || '';

verify('all care intake routes use one immutable canonical event writer', files.intake.includes('recordCareIntake({') && files.manualCare.includes('recordCareIntake({') && files.conversationImport.includes('recordCareIntake({') && files.intakeService.includes("type: 'CARE_INTAKE_RECORDED'") && files.intakeService.includes("const eventKey = 'care-intake:' + idempotencyKey") && files.emitter.includes('ON CONFLICT(organization_id,event_key) DO NOTHING'));
verify('intake cannot create an action, responsibility or message', !files.intake.includes('planActionFromObservation') && !files.intake.includes('INSERT INTO aria_actions') && files.intake.includes('care_responsibility_created: false'));
verify('canonical intake preserves authenticated reporter and evidence provenance', files.intakeService.includes("evidenceKind: 'human_report'") && files.intakeService.includes("verificationStatus: 'reported'") && files.intakeService.includes('reporter_user_id') && files.intakeService.includes('captured_by') && files.intakeService.includes('active=true'));
verify('all care categories enforce minimum confidentiality in the shared writer', files.intakeService.includes('CATEGORY_MINIMUM') && files.intakeService.includes("prayer_request: 'restricted'") && files.intakeService.includes("personal_need: 'restricted'") && files.intakeService.includes("complaint: 'restricted'") && files.intakeService.includes("first_visit: 'sensitive'"));
verify('unknown, declined and withdrawn consent withhold narrative details in every intake channel', files.intakeService.includes("consentStatus === 'granted'") && files.intakeService.includes("['declined', 'withdrawn']") && files.intakeService.includes('detailsPermitted ? statement || null : null') && files.intakeService.includes('details_withheld: !detailsPermitted'));
verify('intake entry point and canonical writer enforce tenant and active-actor scope', files.intake.includes('isOrganizationOperator(req.user?.role)') && files.intake.includes('organizationId: req.org.id') && files.intakeService.includes('organization_id=$2') && files.intakeService.includes('active=true'));
verify('all intake channels share payload-bound idempotency and a database uniqueness boundary', files.intakeService.includes('nyeocare:care-intake:') && files.intakeService.includes('request_fingerprint: fingerprint') && files.intakeService.includes('let event =') && files.intakeService.includes('event.metadata?.request_fingerprint !== fingerprint') && files.emitter.includes('ON CONFLICT(organization_id,event_key) DO NOTHING') && files.capture.includes('submissionRef.current.fingerprint !== fingerprint'));
verify('human review is leader-gated and independently audited', files.review.includes("['owner', 'admin', 'leader']") && files.review.includes("'CARE_INTAKE_REVIEWED'") && files.review.includes('eventKey: duplicateKey'));
verify('review serializes competing decisions and prevents a second decision', files.review.includes('nyeocare:care-intake-review:') && files.review.includes('FOR SHARE') && files.review.includes('This care signal already has a recorded decision'));
verify('only explicit approval creates a named, dated care responsibility through the shared writer', files.review.includes("decision === 'approved'") && files.review.includes('createCareResponsibility') && files.careWriter.includes("kind: 'manual_care_responsibility'") && files.careWriter.includes('assigned_user_id: assigneeId') && files.careWriter.includes('due_date: dueDate'));
verify('identifiable care responsibility requires explicit consent', files.review.includes("String(intake.consent_status || 'unknown').toLowerCase() !== 'granted'"));
verify('restricted and sensitive responsibilities cannot be assigned to unauthorized roles', files.review.includes("intake.privacy_class === 'restricted'") && files.review.includes("intake.privacy_class === 'sensitive'") && files.review.includes('assignee.role'));
verify('one stable action key prevents duplicate responsibilities per intake', files.careWriter.includes("'care-intake:' + intakeEvent.id") && files.careWriter.includes("action_key=$2") && files.review.includes('createCareResponsibility'));
verify('queue remains a projection of canonical aria_actions', files.review.includes('getDailyQueue') && !files.review.includes('CREATE TABLE'));
verify('no-contact restriction is checked before any permission allowance', files.contact.indexOf("if(restriction.rows.length)return 'do_not_contact'") >= 0 && files.contact.indexOf("if(restriction.rows.length)return 'do_not_contact'") < files.contact.indexOf("if(actionMetadata?.contact_permission==='allowed'"));
verify('no-contact suppresses drafts and outbound communication outcomes', files.draft.includes('getRecordedContactPermission') && files.draft.includes('No outreach draft can be created') && files.communication.includes('getRecordedContactPermission') && files.communication.includes("permission!=='allowed'"));
verify('no-contact preference, cancellation and queue projection are centralized and transaction-bound', files.intakeService.includes('async function persistDoNotContact') && files.intakeService.includes('COMMUNICATION_PREFERENCE_CHANGED') && files.intakeService.includes('UPDATE person_communications') && files.intakeService.includes('UPDATE aria_actions') && files.intakeService.includes('UPDATE aria_daily_queue_items') && files.intake.includes('recordCareIntake({'));
verify('database trigger blocks outbound messages after no-contact', files.careMigration.includes('block_outbound_when_do_not_contact_trigger') && files.careMigration.includes('Outbound communication blocked'));
verify('event history blocks deletion and evidence/provenance mutation', files.eventMigration.includes('protect_aria_event_history_trigger') && files.eventMigration.includes('ARIA historical events are immutable') && files.careMigration.includes('OLD.privacy_class IS DISTINCT FROM NEW.privacy_class') && files.careMigration.includes('OLD.consent_status IS DISTINCT FROM NEW.consent_status'));
verify('private care never becomes a shared ARIA observation or memory', files.processor.includes("if(event.privacy_class&&event.privacy_class!=='standard')return null") && !observationMap.includes('CARE_INTAKE_RECORDED'));
verify('private timeline and person journey reads apply privacy scope', files.journey.includes("e.privacy_class='restricted'") && files.journey.includes("e.privacy_class='sensitive'") && files.timeline.includes("COALESCE(t.metadata->>'privacy_class','standard')='standard'") && files.timeline.includes('delete safeMetadata.privacy_class'));
verify('browser retries reuse the same intake and review idempotency keys', files.capture.includes('submissionRef = useRef') && files.reviewUi.includes('reviewSubmissionRef = useRef') && files.reviewUi.includes('previous.fingerprint!==fingerprint'));
verify('private RLS helper is isolated outside the exposed public schema', files.moveMigration.includes('ALTER FUNCTION public.can_access_care_privacy(text,text,text) SET SCHEMA private') && files.moveMigration.includes('REVOKE ALL ON SCHEMA private FROM anon'));
verify('private helper is authenticated-only, guarded and search-path hardened', files.guardMigration.includes('SECURITY DEFINER') && files.guardMigration.includes("SET search_path = ''") && files.guardMigration.includes('auth.uid() IS NOT NULL') && files.guardMigration.includes('REVOKE ALL ON FUNCTION private.can_access_care_privacy(text,text,text) FROM anon'));
verify('Phase 1 creates no parallel care, case or task table', !/CREATE\s+TABLE/i.test(files.careMigration) && files.spec.includes('Do not create care-intake, care-case, or second task tables.'));
verify('similar-looking reports remain separate; only request replay is deduplicated', files.spec.includes('Similar-looking reports are not automatically merged or discarded') && files.spec.includes('semantic duplicate candidates'));

verify('Person Journey manual care uses canonical intake, explicit review approval and shared responsibility writer', files.manualCare.includes('recordCareIntake({') && files.manualCare.includes("type: 'CARE_INTAKE_REVIEWED'") && files.manualCare.includes('createCareResponsibility') && files.intakeService.includes("type: 'CARE_INTAKE_RECORDED'"));
verify('manual care consent, privacy and replay checks are enforced by the shared writer', files.manualCare.includes('consentConfirmed: true') && files.manualCare.includes("consentStatus: 'granted'") && files.intakeService.includes('request_fingerprint: fingerprint') && files.intakeService.includes('A UUID idempotency key is required'));
verify('sensitive action text is withheld from shared action metadata', files.careWriter.includes('summary: isPrivate ? null') && files.careWriter.includes('message: isPrivate ? null'));
verify('ARIA person context exposes only role-scoped private care events', files.capability.includes('authorizedCareIntakes') && files.capability.includes('requireActor(organizationId,actorId)') && files.capability.includes("e.actor_id=$3::uuid OR $4::text IN('owner','admin','leader')") && files.capability.includes("e.actor_id=$3::uuid OR $4::text IN('owner','admin')"));
verify('person journey ARIA transcripts are not exposed to unrelated operators', files.journey.includes("c.user_id=$4::uuid OR $3::text IN('owner','admin')"));
verify('conversation import cannot write transcript content into ordinary shared history', files.conversationImport.includes('recordCareIntake({') && files.intakeService.includes("type: 'CARE_INTAKE_RECORDED'") && files.conversationImport.includes('body.consent_confirmed !== true') && !files.conversationImport.includes('INSERT INTO timeline_events') && !files.conversationImport.includes('INSERT INTO person_communications'));
verify('global ARIA queue can be invoked by an authenticated server worker', files.processApi.includes('processPendingAriaEvents({limit})') && files.processApi.includes('cronAuthorized'));
verify('scheduled worker is gated until matching GitHub and Vercel secrets are configured', files.workerWorkflow.includes('NYEOCARE_ENABLE_EVENT_WORKER') && files.workerWorkflow.includes('NYEOCARE_CRON_SECRET') && files.spec.includes('NYEOCARE_CRON_SECRET'));
verify('private context notes are first-class sensitive evidence, not assigned care responsibilities', files.intakeService.includes("'context_note'") && files.intakeService.includes("context_note: 'sensitive'") && files.intakeService.includes("requires_human_review: category !== 'context_note'") && files.intakeService.includes("category === 'context_note' && personId && consentStatus !== 'granted'"));
verify('context notes stay out of the leader intake-review queue while reviewable intake remains visible', files.intake.includes("COALESCE((e.metadata #>> '{intake,requires_human_review}')::boolean,true)=true") && files.intakeService.includes('requires_human_review: category !== \'context_note\'') && files.intake.includes('review_required: result.reviewRequired'));
verify('Person Journey and Community write private context rather than shared timeline notes', files.personPage.includes("category:'context_note'") && files.communityPage.includes("category: 'context_note'") && files.communityTab.includes("category: 'context_note'") && files.communityPage.includes('noteConsent') && files.communityTab.includes('noteConsent'));
verify('ARIA workspace notes require consent and append one canonical private evidence event', files.universalWorkspace.includes("parameters.consent_confirmed!==true") && files.universalWorkspace.includes("type:'CARE_INTAKE_RECORDED'") && files.universalWorkspace.includes("category:'context_note'") && files.universalWorkspace.includes('requires_human_review:false'));
verify('shared timeline adapters reject direct pastoral notes', files.timelineApi.includes("['note','pastoral_note'].includes") && files.peopleOperatingSystem.includes("['note','pastoral_note'].includes") && files.peopleOperatingApi.includes('Person notes must be recorded through private ARIA care intake') && files.journeyWriter.includes("['note','pastoral_note'].includes"));
verify('Person Journey returns authorized context notes from the privacy-filtered event query', files.journey.includes("e.privacy_class='sensitive'") && files.journey.includes("e.privacy_class='restricted'") && files.personPage.includes("careNotes:(a.aria_events||[]).filter(e=>e.type==='CARE_INTAKE_RECORDED'&&e.metadata?.intake?.category==='context_note')"));
verify('Community conversation import requires consent and confidentiality', files.communityPage.includes('consent_confirmed: true') && files.communityTab.includes('consent_confirmed: true') && files.communityPage.includes('privacy_class: convPrivacyClass') && files.communityTab.includes('privacy_class: convPrivacyClass'));


console.log('[CARE PRODUCTION GATE] ' + passed + ' source-contract checks passed.');

async function runLiveDatabaseAudit() {
  const connectionString = process.env.CARE_PRODUCTION_GATE_DATABASE_URL;
  if (!connectionString) {
    console.log('SKIP live database audit: CARE_PRODUCTION_GATE_DATABASE_URL is not configured. No database write was attempted.');
    return;
  }

  const { Client } = require('pg');
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10000,
    statement_timeout: 15000
  });

  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const result = await client.query([
      'SELECT jsonb_build_object(',
      " 'event_key_unique', EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='aria_events' AND indexdef ILIKE '%UNIQUE%organization_id, event_key%'),",
      " 'action_key_unique', EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='aria_actions' AND indexdef ILIKE '%UNIQUE%organization_id, action_key%'),",
      " 'queue_projection_unique', EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='aria_daily_queue_items' AND indexdef ILIKE '%UNIQUE%organization_id, task_kind, source_id%'),",
      " 'event_history_immutable', EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid='public.aria_events'::regclass AND t.tgname='protect_aria_event_history_trigger' AND NOT t.tgisinternal AND pg_get_functiondef(p.oid) LIKE '%OLD.privacy_class IS DISTINCT FROM NEW.privacy_class%' AND pg_get_functiondef(p.oid) LIKE '%OLD.consent_status IS DISTINCT FROM NEW.consent_status%'),",
      " 'private_privacy_helper', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname='can_access_care_privacy' AND p.prosecdef AND array_to_string(p.proconfig, ',') LIKE '%search_path=%' AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND has_function_privilege('authenticated',p.oid,'EXECUTE')),",
      " 'care_tables_rls', (SELECT count(*)=8 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relname=ANY(ARRAY['aria_events','aria_actions','aria_daily_queue_items','aria_observations','care_feedback','person_communications','timeline_events','aria_care_contexts']) AND c.relrowsecurity),",
      " 'timeline_requires_authenticated', NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='timeline_events' AND (roles @> ARRAY['anon']::name[] OR roles @> ARRAY['public']::name[])),",
      " 'care_context_server_only', EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='aria_care_contexts' AND policyname='aria_care_contexts_server_only_deny' AND qual='false' AND with_check='false'),",
      " 'outbound_no_contact_trigger', EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.person_communications'::regclass AND tgname='block_outbound_when_do_not_contact_trigger' AND NOT tgisinternal),",
      " 'consent_narrative_violations', (SELECT count(*)::int FROM public.aria_events WHERE type='CARE_INTAKE_RECORDED' AND ((person_id IS NOT NULL AND consent_status<>'granted') OR consent_status IN ('declined','withdrawn')) AND (NULLIF(metadata->'intake'->>'statement','') IS NOT NULL OR NULLIF(metadata->'intake'->>'summary','') IS NOT NULL)),",
      " 'duplicate_intake_responsibilities', (SELECT count(*)::int FROM (SELECT organization_id,action_metadata->>'source_intake_event_id' intake_id FROM public.aria_actions WHERE action_metadata->>'kind'='manual_care_responsibility' GROUP BY organization_id,action_metadata->>'source_intake_event_id' HAVING count(*)>1) d),",
      " 'care_actions_missing_provenance', (SELECT count(*)::int FROM public.aria_actions WHERE action_metadata->>'kind'='manual_care_responsibility' AND (NULLIF(action_metadata->>'source_intake_event_id','') IS NULL OR NULLIF(action_metadata->>'assigned_user_id','') IS NULL OR NULLIF(action_metadata->>'due_date','') IS NULL)),",
      " 'private_event_observation_leaks', (SELECT count(*)::int FROM public.aria_events e JOIN public.aria_observations o ON o.organization_id=e.organization_id AND (o.evidence->>'source_id'=e.id::text OR o.metadata->>'source_event_id'=e.id::text) WHERE e.type='CARE_INTAKE_RECORDED' AND e.privacy_class<>'standard'),",
      " 'no_contact_open_drafts', (SELECT count(*)::int FROM public.aria_care_contexts c JOIN public.person_communications pc ON pc.organization_id=c.organization_id AND pc.person_id=c.person_id WHERE c.kind='other' AND c.metadata->>'do_not_contact'='true' AND (c.ends_on IS NULL OR c.ends_on>=CURRENT_DATE) AND pc.direction='outbound' AND pc.status='draft'),",
      " 'intake_count', (SELECT count(*)::int FROM public.aria_events WHERE type='CARE_INTAKE_RECORDED'),",
      " 'review_count', (SELECT count(*)::int FROM public.aria_events WHERE type='CARE_INTAKE_REVIEWED'),",
      " 'manual_action_count', (SELECT count(*)::int FROM public.aria_actions WHERE action_metadata->>'kind'='manual_care_responsibility')",
      ') AS audit'
    ].join('\n'));

    const audit = result.rows[0]?.audit || {};
    const booleanChecks = [
      'event_key_unique',
      'action_key_unique',
      'queue_projection_unique',
      'event_history_immutable',
      'private_privacy_helper',
      'care_tables_rls',
      'timeline_requires_authenticated',
      'care_context_server_only',
      'outbound_no_contact_trigger'
    ];
    for (const name of booleanChecks) {
      assert.equal(audit[name], true, '[CARE PRODUCTION GATE] live database guard failed: ' + name);
      console.log('PASS live database: ' + name);
    }

    const zeroChecks = [
      'consent_narrative_violations',
      'duplicate_intake_responsibilities',
      'care_actions_missing_provenance',
      'private_event_observation_leaks',
      'no_contact_open_drafts'
    ];
    for (const name of zeroChecks) {
      assert.equal(Number(audit[name]), 0, '[CARE PRODUCTION GATE] live data violation: ' + name);
      console.log('PASS live data: ' + name + ' = 0');
    }

    console.log('LIVE CARE COUNTS ' + JSON.stringify({
      intake: Number(audit.intake_count),
      reviews: Number(audit.review_count),
      responsibilities: Number(audit.manual_action_count)
    }));
    console.log('[CARE PRODUCTION GATE] live database audit passed. Read-only transaction; no production records were changed.');
    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

runLiveDatabaseAudit().catch(error => {
  console.error('[CARE PRODUCTION GATE] FAILED:', error.message);
  process.exitCode = 1;
});

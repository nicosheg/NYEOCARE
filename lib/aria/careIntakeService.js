// lib/aria/careIntakeService.js
import crypto from 'node:crypto';
import { emitAriaEvent } from './eventEmitter';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATEGORIES = new Set([
  'first_visit', 'prayer_request', 'personal_need', 'practical_support',
  'relationship_request', 'complaint', 'check_in', 'general', 'context_note'
]);
const CONSENT = new Set(['unknown', 'granted', 'declined', 'withdrawn', 'not_required']);
const PRIVACY_RANK = { standard: 0, sensitive: 1, restricted: 2 };
const CHANNELS = new Set(['in_person', 'phone', 'whatsapp', 'email', 'form', 'operator_note', 'other']);
const CATEGORY_MINIMUM = {
  first_visit: 'sensitive',
  prayer_request: 'restricted',
  personal_need: 'restricted',
  practical_support: 'sensitive',
  relationship_request: 'sensitive',
  complaint: 'restricted',
  check_in: 'sensitive',
  general: 'sensitive',
  context_note: 'sensitive'
};
const CONTACT_ACTION_TYPES = ['SEND_MESSAGE', 'CARE_FOLLOW_UP', 'FOLLOW_UP', 'CHECK_IN', 'CALL', 'VISIT', 'CARE_CONTACT'];
const clean = (value, max = 1800) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);

function normalizeExtras(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const extras = {};
  if (value.requested_action_title) extras.requested_action_title = clean(value.requested_action_title, 100);
  if (value.imported_conversation === true) extras.imported_conversation = true;
  if (typeof value.responsibility_fingerprint === 'string' && /^[0-9a-f]{64}$/i.test(value.responsibility_fingerprint)) {
    extras.responsibility_fingerprint = value.responsibility_fingerprint.toLowerCase();
  }
  return extras;
}

export async function persistDoNotContact(client, {
  organizationId,
  personId,
  actorId,
  actorRole,
  source = 'care_intake',
  sourceType = 'intake',
  sourceId,
  excludeActionId = null,
  privacyClass = 'sensitive',
  consentStatus = 'unknown'
}) {
  if (!client || !organizationId || !personId || !actorId || !sourceId) {
    throw Object.assign(new Error('A transaction, person, actor and source are required to record a no-contact restriction.'), { status: 400 });
  }
  const sourceMetadata = sourceType === 'action'
    ? { source_action_id: sourceId }
    : { source_intake_event_id: sourceId };

  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('nyeocare:daily-queue:'||$1,0))",
    [organizationId]
  );
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
    ['nyeocare:do-not-contact:' + organizationId + ':' + personId]
  );

  const existing = await client.query(
    `SELECT id FROM aria_care_contexts
     WHERE organization_id=$1 AND person_id=$2 AND kind='other'
       AND metadata->>'do_not_contact'='true'
       AND (ends_on IS NULL OR ends_on>=CURRENT_DATE)
     ORDER BY created_at DESC LIMIT 1`,
    [organizationId, personId]
  );

  if (!existing.rows.length) {
    await client.query(
      `INSERT INTO aria_care_contexts(
        organization_id,person_id,kind,starts_on,ends_on,service_type,note,metadata,created_by
      ) VALUES($1,$2,'other',CURRENT_DATE,NULL,NULL,$3,$4::jsonb,$5)`,
      [
        organizationId,
        personId,
        'Person asked the organization not to initiate further contact.',
        JSON.stringify({
          do_not_contact: true,
          source,
          ...sourceMetadata,
          human_reported: true
        }),
        actorId
      ]
    );
  }

  await emitAriaEvent({
    organizationId,
    personId,
    type: 'COMMUNICATION_PREFERENCE_CHANGED',
    source,
    actorId,
    actorRole,
    evidenceKind: 'human_report',
    verificationStatus: 'reported',
    confidence: 1,
    privacyClass: privacyClass === 'restricted' ? 'restricted' : 'sensitive',
    consentStatus,
    eventKey: 'care-contact-preference:' + sourceId,
    metadata: {
      contact_preference: 'do_not_contact',
      ...sourceMetadata,
      summary: 'Person asked the organization not to initiate further contact.'
    }
  }, client);

  await client.query(
    `UPDATE person_communications
     SET status='cancelled',
         metadata=COALESCE(metadata,'{}'::jsonb)||jsonb_build_object('cancelled_by_do_not_contact',true),
         updated_at=NOW()
     WHERE organization_id=$1 AND person_id=$2 AND direction='outbound' AND status='draft'`,
    [organizationId, personId]
  );

  await client.query(
    `UPDATE aria_actions
     SET status='cancelled',
         failure_reason='Person requested no further organization-initiated contact.',
         updated_at=NOW()
     WHERE organization_id=$1 AND person_id=$2
       AND status IN('proposed','approved','executing')
       AND upper(type)=ANY($3::text[])
       AND ($4::uuid IS NULL OR id<>$4::uuid)`,
    [organizationId, personId, CONTACT_ACTION_TYPES, excludeActionId]
  );

  await client.query(
    `UPDATE aria_daily_queue_items q
     SET status='dismissed',
         completed_at=COALESCE(q.completed_at,NOW()),
         updated_at=NOW()
     FROM aria_actions a
     WHERE q.organization_id=a.organization_id
       AND q.source_id=a.id::text
       AND q.task_kind IN('follow_up','action')
       AND q.status IN('pending','deferred')
       AND a.organization_id=$1 AND a.person_id=$2
       AND a.status='cancelled'
       AND upper(a.type)=ANY($3::text[])`,
    [organizationId, personId, CONTACT_ACTION_TYPES]
  );
}

export async function recordCareIntake({
  client,
  organizationId,
  personId = null,
  actorId,
  actorRole = null,
  source = 'aria',
  category,
  statement = '',
  summary = '',
  channel = 'operator_note',
  privacyClass = 'sensitive',
  consentConfirmed = false,
  consentStatus = null,
  contactPermission = 'unknown',
  idempotencyKey,
  additionalIntakeMetadata = {}
}) {
  if (!client || !organizationId || !actorId) {
    throw Object.assign(new Error('Organization, operator and transaction are required.'), { status: 400 });
  }

  personId = personId ? String(personId).trim() : null;
  actorId = String(actorId).trim();
  category = clean(category, 60).toLowerCase();
  statement = clean(statement, 1800);
  summary = clean(summary || statement.slice(0, 260), 260);
  channel = clean(channel || 'operator_note', 30).toLowerCase();
  privacyClass = clean(privacyClass || 'sensitive', 30).toLowerCase();
  contactPermission = clean(contactPermission || 'unknown', 30).toLowerCase();
  idempotencyKey = clean(idempotencyKey, 100);
  consentStatus = clean(consentStatus || (consentConfirmed === true ? 'granted' : 'unknown'), 30).toLowerCase();

  if (personId && !UUID.test(personId)) throw Object.assign(new Error('A valid person identifier is required.'), { status: 400 });
  if (!UUID.test(actorId)) throw Object.assign(new Error('A valid authenticated operator is required.'), { status: 403 });
  if (!CATEGORIES.has(category)) throw Object.assign(new Error('Choose a valid care category.'), { status: 400 });
  if (!UUID.test(idempotencyKey)) throw Object.assign(new Error('A UUID idempotency key is required.'), { status: 400 });
  if (!CONSENT.has(consentStatus)) throw Object.assign(new Error('Choose a valid consent status.'), { status: 400 });
  if (!['standard', 'sensitive', 'restricted'].includes(privacyClass)) throw Object.assign(new Error('Choose a valid confidentiality level.'), { status: 400 });
  if (!CHANNELS.has(channel)) throw Object.assign(new Error('Choose a valid care intake channel.'), { status: 400 });
  if (!['unknown', 'allowed', 'do_not_contact'].includes(contactPermission)) {
    throw Object.assign(new Error('Contact permission must be unknown, allowed or do_not_contact.'), { status: 400 });
  }
  if (contactPermission === 'do_not_contact' && !personId) {
    throw Object.assign(new Error('A person must be identified before a no-contact restriction can be enforced.'), { status: 400 });
  }
  if (personId && consentStatus === 'not_required') {
    throw Object.assign(new Error('Identified-person care records cannot be marked as consent-not-required.'), { status: 400 });
  }
  if (consentStatus === 'granted' && consentConfirmed !== true) {
    throw Object.assign(new Error('Explicit consent must be confirmed before recording identified care information.'), { status: 409 });
  }
  if (consentConfirmed === true && consentStatus !== 'granted') {
    throw Object.assign(new Error('Consent confirmation and consent status do not match.'), { status: 400 });
  }
  if (contactPermission === 'allowed' && ['declined', 'withdrawn'].includes(consentStatus)) {
    throw Object.assign(new Error('Contact cannot be marked allowed after consent was declined or withdrawn.'), { status: 409 });
  }
  if (category === 'context_note' && personId && consentStatus !== 'granted') {
    throw Object.assign(new Error('Explicit consent is required before recording private person context.'), { status: 409 });
  }

  const actor = (await client.query(
    'SELECT id::text,role FROM users WHERE id=$1::uuid AND organization_id=$2 AND active=true LIMIT 1 FOR SHARE',
    [actorId, organizationId]
  )).rows[0];
  if (!actor) throw Object.assign(new Error('The authenticated operator is no longer active in this organization.'), { status: 403 });
  const role = String(actor.role || actorRole || '').toLowerCase();
  if (!['owner', 'admin', 'leader', 'worker', 'user'].includes(role)) {
    throw Object.assign(new Error('Only active organization operators can record care information.'), { status: 403 });
  }

  if (personId) {
    const person = (await client.query(
      "SELECT id FROM people WHERE id=$1::uuid AND organization_id=$2 AND COALESCE(status,'active')='active' LIMIT 1 FOR SHARE",
      [personId, organizationId]
    )).rows[0];
    if (!person) throw Object.assign(new Error('The selected active person could not be found in this organization.'), { status: 404 });
  }

  const extras = normalizeExtras(additionalIntakeMetadata);
  const detailsPermitted = consentStatus === 'granted' || (!personId && consentStatus === 'not_required');
  const storedStatement = detailsPermitted ? statement || null : null;
  const storedSummary = detailsPermitted ? summary || null : null;
  if (consentStatus === 'granted' && !storedStatement && !storedSummary && contactPermission !== 'do_not_contact') {
    throw Object.assign(new Error('Add the care details before saving this report.'), { status: 400 });
  }

  const minimum = CATEGORY_MINIMUM[category];
  if (PRIVACY_RANK[minimum] > PRIVACY_RANK[privacyClass]) privacyClass = minimum;
  if (personId && consentStatus !== 'granted') privacyClass = 'restricted';
  if (['declined', 'withdrawn'].includes(consentStatus)) privacyClass = 'restricted';
  if (!personId && (storedStatement || storedSummary)) privacyClass = 'restricted';

  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    organizationId, personId, actorId, source: clean(source || 'aria', 80), category,
    statement: storedStatement, summary: storedSummary, channel, privacyClass,
    contactPermission, consentStatus, extras
  })).digest('hex');
  const eventKey = 'care-intake:' + idempotencyKey;

  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
    'nyeocare:care-intake:' + organizationId + ':' + idempotencyKey
  ]);

  let event = (await client.query(
    "SELECT * FROM aria_events WHERE organization_id=$1 AND event_key=$2 AND type='CARE_INTAKE_RECORDED' LIMIT 1 FOR UPDATE",
    [organizationId, eventKey]
  )).rows[0] || null;
  let duplicate = Boolean(event);

  if (event && event.metadata?.request_fingerprint !== fingerprint) {
    throw Object.assign(new Error('This request key was already used for different care details. Start a new request.'), { status: 409 });
  }

  if (!event) {
    event = await emitAriaEvent({
      organizationId,
      personId,
      type: 'CARE_INTAKE_RECORDED',
      actorId,
      actorRole: role,
      source: clean(source || 'aria', 80),
      evidenceKind: 'human_report',
      verificationStatus: 'reported',
      confidence: 1,
      privacyClass,
      consentStatus,
      eventKey,
      metadata: {
        request_fingerprint: fingerprint,
        intake: {
          category,
          statement: storedStatement,
          summary: storedSummary,
          channel,
          contact_permission: contactPermission,
          ...extras,
          requires_human_review: category !== 'context_note',
          details_withheld: !detailsPermitted
        },
        provenance: {
          reporter_user_id: actorId,
          reporter_role: role,
          captured_by: 'authenticated_operator'
        },
        consent_capture: {
          confirmed: consentStatus === 'granted',
          status: consentStatus,
          method: consentStatus === 'granted' ? 'operator_attestation' : 'operator_recorded_status',
          confirmed_by: actorId,
          confirmed_at: new Date().toISOString()
        }
      }
    }, client);
    if (!event) throw new Error('The care report could not be saved safely.');
  }

  if (contactPermission === 'do_not_contact' && personId) {
    await persistDoNotContact(client, {
      organizationId,
      personId,
      actorId,
      actorRole: role,
      source: 'care_intake',
      sourceType: 'intake',
      sourceId: event.id,
      privacyClass: event.privacy_class || privacyClass,
      consentStatus: event.consent_status || consentStatus
    });
  }

  return {
    event,
    duplicate,
    privacyClass: event.privacy_class || privacyClass,
    reviewRequired: event.metadata?.intake?.requires_human_review !== false,
    contactRestrictionSaved: contactPermission === 'do_not_contact'
  };
}
